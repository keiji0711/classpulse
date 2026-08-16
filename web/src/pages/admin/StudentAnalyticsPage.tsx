import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear } from '../../contexts/AcademicYearContext';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import { useCachedState, hasCached } from '../../lib/pageCache';
import {
  Activity, AlertTriangle, ArrowDownUp, BookOpen, CalendarCheck,
  ChevronLeft, ChevronRight, Download, FileSpreadsheet, Filter,
  RefreshCw, Search, ShieldCheck, TrendingDown, Users,
} from 'lucide-react';
import { downloadCsv, downloadExcel, type ExportColumn } from '../../lib/export';
import { computeRiskScore, type RiskResult } from '../../lib/riskScore';
import StudentInterventionModal from '../../components/StudentInterventionModal';
import { mapEnrollmentRoster } from '../../lib/academicYearRoster';
import type { Student, Section } from '../../types';

interface StudentAnalytics {
  id: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  lrn: string;
  section_name: string;
  grade_level: string;
  total_records: number;
  absences: number;
  lates: number;
  absence_rate: number;
  average_grade: number | null;
  failing_subjects: string[];
  status: 'critical' | 'at-risk' | 'good';
  risk_score: number;
  risk_breakdown: RiskResult['breakdown'];
  max_consecutive_absences: number;
  trend_worsening: boolean;
}

type SortOption = 'risk' | 'absence' | 'grade' | 'name';
const PAGE_SIZE = 50;

function primaryRiskFactor(student: StudentAnalytics) {
  const factors = [
    { label: 'Consecutive absences', score: student.risk_breakdown.consecutiveAbsences },
    { label: 'High absence rate', score: student.risk_breakdown.absenceRate },
    { label: 'Failing subjects', score: student.risk_breakdown.failingSubjects },
    { label: 'Attendance worsening', score: student.risk_breakdown.absenceTrend },
    { label: 'Frequent lateness', score: student.risk_breakdown.lateFrequency },
    { label: 'Low grade average', score: student.risk_breakdown.lowAverage },
    { label: 'Grades declining', score: student.risk_breakdown.gradeDecline },
  ].sort((a, b) => b.score - a.score);
  return factors[0]?.score > 0 ? factors[0].label : 'No risk factors';
}

function recommendedAction(student: StudentAnalytics) {
  if (student.max_consecutive_absences >= 3) return 'Contact guardian today';
  if (student.failing_subjects.length >= 2) return 'Plan academic support';
  if (student.trend_worsening) return 'Review recent attendance';
  if (student.absence_rate >= 10) return 'Check attendance pattern';
  if (student.average_grade !== null && student.average_grade < 78) return 'Coordinate with teachers';
  return 'Continue monitoring';
}

export default function StudentAnalyticsPage() {
  const { user } = useAuth();
  const { activeYear } = useAcademicYear();
  const [analytics, setAnalytics] = useCachedState<StudentAnalytics[]>('admin-student-analytics', []);
  const [loading, setLoading] = useState(!hasCached('admin-student-analytics'));
  const [filterStatus, setFilterStatus] = useState<'all' | 'critical' | 'at-risk' | 'good'>('all');
  const [filterSection, setFilterSection] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<StudentAnalytics | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('risk');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user?.school_id) return;
    fetchAnalytics();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeYear]);

  useRealtimeRefresh(['students', 'attendance_records', 'grades'], fetchAnalytics, { column: 'school_id', value: user?.school_id });

  async function fetchAnalytics() {
    const schoolId = user!.school_id!;
    const yearId = activeYear?.id;
    setError('');
    setLoading(true);

    try {
    if (!yearId) {
      setAnalytics([]);
      return;
    }

    // PostgreSQL performs the attendance de-duplication, grade aggregation,
    // streak/trend analysis, and risk scoring. This avoids downloading an
    // entire school's raw attendance and grades into the browser and avoids
    // PostgREST row-cap truncation for large schools.
    const { data: serverAnalytics, error: serverAnalyticsError } = await supabase
      .rpc('get_school_student_risk_analytics', { p_academic_year_id: yearId });
    if (serverAnalyticsError) throw serverAnalyticsError;
    setAnalytics((Array.isArray(serverAnalytics) ? serverAnalytics : []) as StudentAnalytics[]);
    return;

    // Fetch only students enrolled in the selected year, with the historical section.
    const { data: enrollmentRows, error: enrollmentError } = await supabase
      .from('student_enrollments')
      .select('student_id, section_id, student:students!inner(*), section:sections!inner(*)')
      .eq('school_id', schoolId)
      .eq('academic_year_id', yearId ?? '00000000-0000-0000-0000-000000000000')
      .order('last_name', { foreignTable: 'student' });
    if (enrollmentError) throw enrollmentError;
    const students = mapEnrollmentRoster(enrollmentRows ?? []) as unknown as (Student & { section: Section })[];

    // Fetch all attendance records for this school (filtered by year via schedule)
    let attendanceQuery = supabase
      .from('attendance_records')
      .select('student_id, status, date, schedule:schedules!inner(school_id, academic_year_id)')
      .eq('schedule.school_id', schoolId);
    if (yearId) attendanceQuery = attendanceQuery.eq('schedule.academic_year_id', yearId);
    const { data: attendanceRecords, error: attendanceError } = await attendanceQuery;
    if (attendanceError) throw attendanceError;

    // Deduplicate attendance per student per day — keep best status.
    // A student with multiple subjects counted present in ANY means they were at school.
    // Only count as absent if absent from ALL subjects that day.
    // Priority: present > late > excused > absent
    const statusPriority: Record<string, number> = { present: 3, late: 2, excused: 1, absent: 0 };

    // Group: student_id -> date -> best status
    const dailyAttendanceMap = new Map<string, Map<string, string>>();
    for (const r of (attendanceRecords ?? [])) {
      if (!dailyAttendanceMap.has(r.student_id)) dailyAttendanceMap.set(r.student_id, new Map());
      const dayMap = dailyAttendanceMap.get(r.student_id)!;
      const existing = dayMap.get(r.date);
      const status = r.status ?? 'absent';
      if (!existing || (statusPriority[status] ?? 0) > (statusPriority[existing ?? ''] ?? 0)) {
        dayMap.set(r.date, status);
      }
    }

    // Fetch all grades for this school
    let gradesQuery = supabase
      .from('grades')
      .select('student_id, subject_id, quarter, grade, subject:subjects(name)')
      .eq('school_id', schoolId)
      .lte('quarter', 3);
    if (yearId) gradesQuery = gradesQuery.eq('academic_year_id', yearId);
    const { data: gradesData, error: gradesError } = await gradesQuery;
    if (gradesError) throw gradesError;

    // Index once instead of scanning every grade for every student. This keeps the
    // analytics transformation responsive for large schools.
    const gradesByStudent = new Map<string, NonNullable<typeof gradesData>>();
    for (const grade of gradesData ?? []) {
      const list = gradesByStudent.get(grade.student_id) ?? [];
      list.push(grade);
      gradesByStudent.set(grade.student_id, list);
    }

    // Build analytics per student
    const result: StudentAnalytics[] = students.map(student => {
      // Use deduplicated daily attendance (one status per day)
      const dayMap = dailyAttendanceMap.get(student.id);
      const dailyEntries = dayMap
        ? [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, status]) => ({ date, status }))
        : [];
      const total = dailyEntries.length;
      const absences = dailyEntries.filter(d => d.status === 'absent').length;
      const lates = dailyEntries.filter(d => d.status === 'late').length;
      const absenceRate = total > 0 ? (absences / total) * 100 : 0;

      const studentGrades = gradesByStudent.get(student.id) ?? [];
      let avgGrade: number | null = null;
      const failingSubjects: string[] = [];

      // Per-quarter averages for grade trend detection
      const quarterMap = new Map<number, number[]>();
      if (studentGrades.length > 0) {
        avgGrade = studentGrades.reduce((sum, g) => sum + g.grade, 0) / studentGrades.length;

        // Group by subject and check if any subject average is below 75
        const subjectMap = new Map<string, { grades: number[]; name: string }>();
        for (const g of studentGrades) {
          const subject = Array.isArray(g.subject) ? g.subject[0] : g.subject;
          const subName = subject?.name ?? 'Unknown';
          if (!subjectMap.has(g.subject_id)) {
            subjectMap.set(g.subject_id, { grades: [], name: subName });
          }
          subjectMap.get(g.subject_id)!.grades.push(g.grade);

          // Collect per-quarter grades
          if (!quarterMap.has(g.quarter)) quarterMap.set(g.quarter, []);
          quarterMap.get(g.quarter)!.push(g.grade);
        }
        for (const [, data] of subjectMap) {
          const avg = data.grades.reduce((a, b) => a + b, 0) / data.grades.length;
          if (avg < 75) failingSubjects.push(data.name);
        }
      }

      // Compute per-quarter averages
      const quarterAverages = new Map<number, number>();
      for (const [q, grades] of quarterMap) {
        quarterAverages.set(q, grades.reduce((a, b) => a + b, 0) / grades.length);
      }

      // Run weighted risk score engine
      const risk = computeRiskScore({
        dailyStatuses: dailyEntries,
        absenceRate,
        totalSessions: total,
        absences,
        lates,
        failingSubjectCount: failingSubjects.length,
        averageGrade: avgGrade,
        quarterAverages,
      });

      const section = student.section;

      return {
        id: student.id,
        first_name: student.first_name,
        middle_name: student.middle_name,
        last_name: student.last_name,
        lrn: student.lrn,
        section_name: section?.name ?? '',
        grade_level: section?.grade_level ?? '',
        total_records: total,
        absences,
        lates,
        absence_rate: absenceRate,
        average_grade: avgGrade,
        failing_subjects: failingSubjects,
        status: risk.status,
        risk_score: risk.score,
        risk_breakdown: risk.breakdown,
        max_consecutive_absences: risk.maxConsecutiveAbsences,
        trend_worsening: risk.trendWorsening,
      };
    });

    // Sort by risk score descending (highest risk first)
    result.sort((a, b) => b.risk_score - a.risk_score);

    setAnalytics(result);
    } catch (cause) {
      console.error('Failed to load student analytics', cause);
      setError(cause instanceof Error ? cause.message : 'Student analytics could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  const sections = useMemo(() => {
    const set = new Map<string, { grade_level: string; section_name: string }>();
    for (const s of analytics) {
      const key = `${s.grade_level} - ${s.section_name}`;
      if (!set.has(key)) set.set(key, { grade_level: s.grade_level, section_name: s.section_name });
    }
    return [...set.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [analytics]);

  const filtered = useMemo(() => {
    let list = [...analytics];
    if (filterStatus !== 'all') list = list.filter(s => s.status === filterStatus);
    if (filterSection !== 'all') list = list.filter(s => `${s.grade_level} - ${s.section_name}` === filterSection);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(s =>
        s.last_name.toLowerCase().includes(q) ||
        s.first_name.toLowerCase().includes(q) ||
        s.lrn.toLowerCase().includes(q) ||
        s.section_name.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      if (sortBy === 'absence') return b.absence_rate - a.absence_rate || b.risk_score - a.risk_score;
      if (sortBy === 'grade') return (a.average_grade ?? 101) - (b.average_grade ?? 101) || b.risk_score - a.risk_score;
      if (sortBy === 'name') return `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`);
      return b.risk_score - a.risk_score || b.absence_rate - a.absence_rate;
    });
    return list;
  }, [analytics, filterStatus, filterSection, searchQuery, sortBy]);

  const overview = useMemo(() => {
    const critical = analytics.filter(s => s.status === 'critical').length;
    const atRisk = analytics.filter(s => s.status === 'at-risk').length;
    const good = analytics.filter(s => s.status === 'good').length;
    const attendanceRows = analytics.filter(s => s.total_records > 0);
    const gradeRows = analytics.filter(s => s.average_grade !== null);
    const attendanceTotal = attendanceRows.reduce((sum, s) => sum + s.total_records, 0);
    const absenceTotal = attendanceRows.reduce((sum, s) => sum + s.absences, 0);
    const averageAttendance = attendanceTotal > 0 ? 100 - (absenceTotal / attendanceTotal) * 100 : null;
    const averageGrade = gradeRows.length > 0
      ? gradeRows.reduce((sum, s) => sum + (s.average_grade ?? 0), 0) / gradeRows.length
      : null;

    const sectionMap = new Map<string, { students: number; flagged: number }>();
    for (const student of analytics) {
      const key = `${student.grade_level} - ${student.section_name}`;
      const entry = sectionMap.get(key) ?? { students: 0, flagged: 0 };
      entry.students++;
      if (student.status !== 'good') entry.flagged++;
      sectionMap.set(key, entry);
    }
    const hotspots = [...sectionMap.entries()]
      .map(([name, value]) => ({ name, ...value, rate: value.students ? value.flagged / value.students * 100 : 0 }))
      .filter(section => section.flagged > 0)
      .sort((a, b) => b.rate - a.rate || b.flagged - a.flagged)
      .slice(0, 4);

    return {
      critical, atRisk, good, averageAttendance, averageGrade,
      needsAttention: critical + atRisk,
      attendanceCoverage: attendanceRows.length,
      gradeCoverage: gradeRows.length,
      noEvidence: analytics.filter(s => s.total_records === 0 && s.average_grade === null).length,
      hotspots,
    };
  }, [analytics]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);
  const priorityStudents = useMemo(() => analytics.filter(s => s.status !== 'good').slice(0, 5), [analytics]);

  useEffect(() => { setPage(1); }, [filterStatus, filterSection, searchQuery, sortBy]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const exportColumns: ExportColumn<StudentAnalytics>[] = [
    { header: 'Last Name', value: (row) => row.last_name },
    { header: 'First Name', value: (row) => row.first_name },
    { header: 'Middle Name', value: (row) => row.middle_name ?? '' },
    { header: 'LRN', value: (row) => row.lrn },
    { header: 'Grade Level', value: (row) => row.grade_level },
    { header: 'Section', value: (row) => row.section_name },
    { header: 'Absences', value: (row) => row.absences },
    { header: 'Total Records', value: (row) => row.total_records },
    { header: 'Absence Rate (%)', value: (row) => row.absence_rate.toFixed(1) },
    { header: 'Consecutive Absences', value: (row) => row.max_consecutive_absences },
    { header: 'Lates', value: (row) => row.lates },
    { header: 'Average Grade', value: (row) => (row.average_grade !== null ? row.average_grade.toFixed(1) : '') },
    { header: 'Failing Subjects', value: (row) => row.failing_subjects.join(', ') },
    { header: 'Risk Score', value: (row) => row.risk_score },
    { header: 'Status', value: (row) => row.status },
  ];

  function exportCsv() {
    downloadCsv('student_analytics', filtered, exportColumns);
  }

  function exportExcel() {
    downloadExcel('student_analytics', 'Student Analytics', filtered, exportColumns);
  }

  if (loading) return (
    <div className="space-y-5 animate-pulse">
      <div className="h-9 w-64 rounded-lg bg-slate-200" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 rounded-2xl bg-slate-200/70" />)}
      </div>
      <div className="h-72 rounded-2xl bg-slate-200/70" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary mb-1"><Activity size={14} /> Student intelligence</div>
          <h2 className="text-2xl font-bold text-slate-900">Student Analytics</h2>
          <p className="text-sm text-slate-500 mt-1">Prioritize learners who need support and understand exactly why they were flagged.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={fetchAnalytics} className="bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors cursor-pointer"><RefreshCw size={15} /> Refresh</button>
          <button onClick={exportCsv} disabled={filtered.length === 0} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer">
            <Download size={16} /> Export CSV
          </button>
          <button onClick={exportExcel} disabled={filtered.length === 0} className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer">
            <FileSpreadsheet size={16} /> Export Excel
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div><p className="font-semibold">Analytics could not be refreshed</p><p className="text-xs mt-0.5">{error}</p></div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-center gap-4">
          <div className="bg-red-500 text-white p-3 rounded-lg"><AlertTriangle size={24} /></div>
          <div>
            <p className="text-2xl font-bold text-red-700">{overview.critical}</p>
            <p className="text-sm text-red-600">Critical Students</p>
            <p className="text-xs text-red-400 mt-0.5">Risk score ≥ 40</p>
          </div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-center gap-4">
          <div className="bg-amber-500 text-white p-3 rounded-lg"><TrendingDown size={24} /></div>
          <div>
            <p className="text-2xl font-bold text-amber-700">{overview.atRisk}</p>
            <p className="text-sm text-amber-600">At-Risk Students</p>
            <p className="text-xs text-amber-400 mt-0.5">Risk score 20–39</p>
          </div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 flex items-center gap-4">
          <div className="bg-green-500 text-white p-3 rounded-lg"><ShieldCheck size={24} /></div>
          <div>
            <p className="text-2xl font-bold text-green-700">{overview.good}</p>
            <p className="text-sm text-green-600">Good Standing</p>
            <p className="text-xs text-green-400 mt-0.5">Risk score &lt; 20</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Enrolled</span><Users size={18} className="text-slate-300" /></div><p className="text-2xl font-bold text-slate-900 mt-2">{analytics.length.toLocaleString()}</p><p className="text-xs text-slate-500 mt-1">{overview.noEvidence} awaiting records</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Need attention</span><AlertTriangle size={18} className="text-rose-400" /></div><p className="text-2xl font-bold text-slate-900 mt-2">{overview.needsAttention.toLocaleString()}</p><p className="text-xs text-slate-500 mt-1">Critical and watchlist</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Attendance</span><CalendarCheck size={18} className="text-teal-500" /></div><p className="text-2xl font-bold text-slate-900 mt-2">{overview.averageAttendance === null ? '—' : `${overview.averageAttendance.toFixed(1)}%`}</p><p className="text-xs text-slate-500 mt-1">{overview.attendanceCoverage} students covered</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Academic average</span><BookOpen size={18} className="text-sky-500" /></div><p className="text-2xl font-bold text-slate-900 mt-2">{overview.averageGrade === null ? '—' : overview.averageGrade.toFixed(1)}</p><p className="text-xs text-slate-500 mt-1">{overview.gradeCoverage} students covered</p></div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3"><div><h3 className="font-bold text-slate-800">Priority action queue</h3><p className="text-xs text-slate-400 mt-0.5">Highest-risk students and the suggested next step</p></div><button onClick={() => setFilterStatus('critical')} className="text-xs font-semibold text-primary hover:underline cursor-pointer">View urgent</button></div>
          {priorityStudents.length === 0 ? <div className="py-10 text-center"><ShieldCheck size={30} className="mx-auto text-emerald-500 mb-2" /><p className="text-sm font-semibold text-slate-700">No students currently need intervention</p></div> : (
            <div className="divide-y divide-slate-100">{priorityStudents.map((student, index) => (
              <div key={student.id} className="px-5 py-3 flex items-center gap-3 hover:bg-slate-50/70">
                <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 text-xs font-bold grid place-items-center shrink-0">{index + 1}</span>
                <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-800 truncate">{student.last_name}, {student.first_name}</p><p className="text-xs text-slate-400 truncate">{student.grade_level} - {student.section_name} · {primaryRiskFactor(student)}</p></div>
                <div className="hidden sm:block text-right"><p className="text-xs font-semibold text-slate-700">{recommendedAction(student)}</p><p className="text-[11px] text-slate-400">Risk {student.risk_score}/100</p></div>
                <button onClick={() => setSelectedStudent(student)} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark cursor-pointer">Intervene</button>
              </div>
            ))}</div>
          )}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100"><h3 className="font-bold text-slate-800">Section hotspots</h3><p className="text-xs text-slate-400 mt-0.5">Students needing attention by section</p></div>
          <div className="p-5 space-y-4">{overview.hotspots.length === 0 ? <p className="text-sm text-slate-400 py-6 text-center">No hotspots detected.</p> : overview.hotspots.map(section => (
            <button key={section.name} onClick={() => setFilterSection(section.name)} className="block w-full text-left cursor-pointer group"><div className="flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-slate-700 truncate group-hover:text-primary">{section.name}</span><span className="font-bold text-slate-600">{section.rate.toFixed(0)}%</span></div><div className="mt-1.5 h-2 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${section.rate >= 30 ? 'bg-rose-500' : 'bg-amber-400'}`} style={{ width: `${Math.min(section.rate, 100)}%` }} /></div><p className="text-[11px] text-slate-400 mt-1">{section.flagged} of {section.students} students flagged</p></button>
          ))}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-slate-400" />
          <span className="text-sm font-medium text-slate-600">Filter:</span>
        </div>
        {([
          { value: 'all', label: 'All Students', color: 'bg-slate-100 text-slate-700 hover:bg-slate-200' },
          { value: 'critical', label: 'Critical', color: 'bg-red-100 text-red-700 hover:bg-red-200' },
          { value: 'at-risk', label: 'At-Risk', color: 'bg-amber-100 text-amber-700 hover:bg-amber-200' },
          { value: 'good', label: 'Good', color: 'bg-green-100 text-green-700 hover:bg-green-200' },
        ] as const).map(f => (
          <button
            key={f.value}
            onClick={() => setFilterStatus(f.value)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors cursor-pointer ${filterStatus === f.value ? f.color + ' ring-2 ring-offset-1 ring-slate-300' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
          >
            {f.label}
          </button>
        ))}
        <div className="flex-1" />
        <select
          value={filterSection}
          onChange={e => setFilterSection(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none bg-white cursor-pointer"
        >
          <option value="all">All Sections</option>
          {sections.map(([key]) => (
            <option key={key} value={key}>{key}</option>
          ))}
        </select>
        <div className="relative">
          <ArrowDownUp size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <select value={sortBy} onChange={e => setSortBy(e.target.value as SortOption)} className="pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm outline-none bg-white cursor-pointer">
            <option value="risk">Highest risk</option>
            <option value="absence">Highest absence</option>
            <option value="grade">Lowest grade</option>
            <option value="name">Student name</option>
          </select>
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search students..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none w-60"
          />
        </div>
      </div>

      {/* Student List */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Users size={40} className="text-slate-300 mx-auto mb-2" />
          <p className="text-slate-500 font-medium">No students found</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
            <div><p className="text-sm font-bold text-slate-800">Student roster</p><p className="text-xs text-slate-400">Showing {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(page * PAGE_SIZE, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()}</p></div>
            <p className="text-xs text-slate-400">Risk combines attendance and academic signals</p>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Student</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Section</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Absences</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Absence Rate</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Avg Grade</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Failing Subjects</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Risk Score</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((student, idx) => {
                const b = student.risk_breakdown;
                const scoreColor = student.risk_score >= 40 ? 'text-red-600' : student.risk_score >= 20 ? 'text-amber-600' : 'text-green-600';
                const barColor = student.risk_score >= 40 ? 'bg-red-500' : student.risk_score >= 20 ? 'bg-amber-500' : 'bg-emerald-500';
                return (
                <tr key={student.id} className={`border-b border-slate-100 hover:bg-slate-50/50 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-slate-800">{student.last_name}, {student.first_name}{student.middle_name ? ` ${student.middle_name.charAt(0)}.` : ''}</div>
                    <div className="text-xs text-slate-400">{student.lrn}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{student.grade_level} - {student.section_name}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-sm font-semibold ${student.absences > 0 ? 'text-red-600' : 'text-slate-400'}`}>{student.absences}</span>
                    <span className="text-xs text-slate-400"> / {student.total_records}</span>
                    {student.max_consecutive_absences >= 3 && (
                      <div className="text-[10px] text-red-500 mt-0.5">{student.max_consecutive_absences} consecutive</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-sm font-semibold ${student.absence_rate >= 20 ? 'text-red-600' : student.absence_rate >= 10 ? 'text-amber-600' : 'text-green-600'}`}>
                      {student.absence_rate.toFixed(1)}%
                    </span>
                    {student.trend_worsening && (
                      <div className="text-[10px] text-red-500 mt-0.5 flex items-center justify-center gap-0.5">
                        <TrendingDown size={10} /> worsening
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {student.average_grade !== null ? (
                      <span className={`text-sm font-semibold ${student.average_grade >= 75 ? 'text-green-600' : 'text-red-600'}`}>
                        {student.average_grade.toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-sm text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {student.failing_subjects.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {student.failing_subjects.map(s => (
                          <span key={s} className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded">{s}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">None</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="group relative inline-block">
                      <div className="flex flex-col items-center gap-1">
                        <span className={`text-sm font-bold ${scoreColor}`}>{student.risk_score}</span>
                        <div className="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full ${barColor} rounded-full`} style={{ width: `${Math.min(student.risk_score, 100)}%` }} />
                        </div>
                      </div>
                      {/* Breakdown tooltip */}
                      <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-52 bg-slate-800 text-white text-xs rounded-lg p-3 shadow-xl">
                        <p className="font-semibold mb-2 border-b border-slate-600 pb-1">Risk Score Breakdown</p>
                        <div className="space-y-1">
                          {b.absenceRate > 0 && <div className="flex justify-between"><span>Absence Rate</span><span className="font-semibold">+{b.absenceRate}</span></div>}
                          {b.consecutiveAbsences > 0 && <div className="flex justify-between"><span>Consecutive Absences</span><span className="font-semibold">+{b.consecutiveAbsences}</span></div>}
                          {b.absenceTrend > 0 && <div className="flex justify-between"><span>Worsening Trend</span><span className="font-semibold">+{b.absenceTrend}</span></div>}
                          {b.lateFrequency > 0 && <div className="flex justify-between"><span>Late Frequency</span><span className="font-semibold">+{b.lateFrequency}</span></div>}
                          {b.failingSubjects > 0 && <div className="flex justify-between"><span>Failing Subjects</span><span className="font-semibold">+{b.failingSubjects}</span></div>}
                          {b.lowAverage > 0 && <div className="flex justify-between"><span>Low Average</span><span className="font-semibold">+{b.lowAverage}</span></div>}
                          {b.gradeDecline > 0 && <div className="flex justify-between"><span>Grade Decline</span><span className="font-semibold">+{b.gradeDecline}</span></div>}
                          {student.risk_score === 0 && <div className="text-slate-400">No risk factors detected</div>}
                        </div>
                        <div className="mt-2 pt-1 border-t border-slate-600 flex justify-between font-semibold">
                          <span>Total</span><span>{student.risk_score}/100</span>
                        </div>
                        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full">
                          <div className="w-2 h-2 bg-slate-800 rotate-45 -mt-1"></div>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                      student.status === 'critical' ? 'bg-red-100 text-red-700' :
                      student.status === 'at-risk' ? 'bg-amber-100 text-amber-700' :
                      'bg-green-100 text-green-700'
                    }`}>
                      {student.status === 'at-risk' ? 'At-Risk' : student.status.charAt(0).toUpperCase() + student.status.slice(1)}
                    </span>
                    {(student.status === 'critical' || student.status === 'at-risk') && (
                      <button
                        className="ml-2 px-2 py-1 text-xs bg-primary text-white rounded hover:bg-primary-dark transition-colors"
                        onClick={() => setSelectedStudent(student)}
                        title="Log/View Interventions"
                      >
                        Intervene
                      </button>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
              <p className="text-xs text-slate-400">Page {page} of {totalPages}</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(value => Math.max(1, value - 1))} disabled={page === 1} className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"><ChevronLeft size={16} /></button>
                <button onClick={() => setPage(value => Math.min(totalPages, value + 1))} disabled={page === totalPages} className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"><ChevronRight size={16} /></button>
              </div>
            </div>
          )}
        </div>
      )}
      {selectedStudent && (
        <StudentInterventionModal
          student={{
            id: selectedStudent.id,
            school_id: user!.school_id!,
            section_id: '', // Not needed for modal
            lrn: selectedStudent.lrn,
            first_name: selectedStudent.first_name,
            middle_name: selectedStudent.middle_name,
            last_name: selectedStudent.last_name,
            created_at: '', // Not needed for modal
          }}
          studentAbsenceRate={selectedStudent.absence_rate}
          onClose={() => setSelectedStudent(null)}
          schoolId={user!.school_id!}
          userId={user!.id!}
        />
      )}
    </div>
  );
}
