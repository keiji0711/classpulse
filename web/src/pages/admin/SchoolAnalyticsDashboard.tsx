import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear } from '../../contexts/AcademicYearContext';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import { useCachedState, hasCached } from '../../lib/pageCache';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';
import {
  TrendingUp, TrendingDown, AlertTriangle, BookOpen, Target,
  Calendar, Download, FileSpreadsheet, Filter, Clock, Zap,
  CheckCircle, XCircle, AlertCircle, Award, BarChart3, Users,
  LayoutDashboard, GraduationCap, Search, Activity,
  Sparkles,
} from 'lucide-react';
import { downloadCsv, downloadExcel, type ExportColumn } from '../../lib/export';
import { downloadDashboardWorkbook, type DashboardMetric } from '../../lib/dashboardExport';
import { computeRiskScore } from '../../lib/riskScore';
import { mapEnrollmentRoster } from '../../lib/academicYearRoster';

/* ─── Types ─── */
interface AttendanceRecord {
  id: string;
  student_id: string;
  status: 'present' | 'absent' | 'late' | 'excused';
  date: string;
  recorded_at: string;
  schedule: {
    school_id: string;
    academic_year_id: string | null;
    instructor_id: string;
    section_id: string;
    subject_id: string;
  } | null;
}

interface StudentRow {
  id: string;
  first_name: string;
  last_name: string;
  lrn: string;
  section_id: string;
  section: { name: string; grade_level: string } | null;
}

interface SectionRow { id: string; name: string; grade_level: string; }
interface InstructorRow { id: string; full_name: string; }
interface GradeRow {
  id: string;
  student_id: string;
  grade: number;
  quarter: number;
  subject_id: string;
  subject: { id: string; name: string; code: string } | null;
}
interface SubjectRow { id: string; name: string; code: string; grade_level: string; }

interface DailyAttendance {
  date: string;
  present: number;
  absent: number;
  late: number;
  excused: number;
  total: number;
  rate: number;
}

interface WeeklyTrend { week: string; rate: number; absences: number; total: number; }

interface SectionRate {
  id: string;
  name: string;
  grade_level: string;
  rate: number;
  total: number;
  present: number;
  absent: number;
  late: number;
  students: number;
}

interface InstructorActivity {
  name: string;
  records_logged: number;
  days_active: number;
  last_active: string;
  daysSinceActive: number;
}

interface AtRiskStudent {
  id: string;
  name: string;
  lrn: string;
  section: string;
  absences: number;
  lates: number;
  total: number;
  rate: number;
  risk_score: number;
  status: 'critical' | 'warning';
  maxConsecutive: number;
  trendWorsening: boolean;
}

interface GradeStats {
  totalStudents: number;
  averageGpa: number;
  excellentCount: number;
  goodCount: number;
  satisfactoryCount: number;
  needsImprovementCount: number;
  failingCount: number;
  medianGpa: number;
}

interface SubjectPerformance {
  id: string;
  name: string;
  code: string;
  averageGrade: number;
  totalGrades: number;
  passingCount: number;
  studentCount: number;
  passRate: number;
}

interface GradeDistribution { range: string; count: number; percentage: number; }
interface DayOfWeekStat { day: string; rate: number; total: number; absent: number; }
interface GradeLevelSummary { grade_level: string; sections: number; students: number; rate: number; avgGpa: number; atRisk: number; }
interface QuarterTrend { quarter: string; average: number; count: number; }

type Tab = 'overview' | 'attendance' | 'academics' | 'at-risk';

/* ─── Helpers ─── */
const STATUS_COLORS = { present: '#10b981', late: '#f59e0b', excused: '#6366f1', absent: '#ef4444' };
const PIE_COLORS = [STATUS_COLORS.present, STATUS_COLORS.absent, STATUS_COLORS.late, STATUS_COLORS.excused];
const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

const formatDate = (d: unknown) =>
  new Date(String(d) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const isoWeekKey = (dateStr: string): string => {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay() === 0 ? 7 : d.getDay();
  d.setDate(d.getDate() - day + 1);
  return d.toISOString().split('T')[0];
};

function daysBetween(a: Date, b: Date) {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function rateTone(rate: number) {
  if (rate >= 90) return { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200', fill: '#10b981' };
  if (rate >= 75) return { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200', fill: '#f59e0b' };
  return { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200', fill: '#ef4444' };
}

/* ─── Skeleton ─── */
function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-slate-200/70 rounded-lg animate-pulse ${className}`} />;
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-48" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Skeleton className="h-80 lg:col-span-2" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}

/* ─── Sub components ─── */
function KpiCard({ icon, label, value, sub, accent }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  accent: string;
}) {
  return (
    <div className={`rounded-lg border-l-4 ${accent} bg-white border border-slate-200 p-4`}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <span className="text-slate-300">{icon}</span>
      </div>
      <p className="text-2xl font-bold text-slate-900 leading-none">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

function SectionCard({ title, subtitle, icon, action, children, className = '' }: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white overflow-hidden ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <div className="flex items-center gap-2">
          {icon && <span className="text-slate-400">{icon}</span>}
          <div>
            <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-slate-400">
      <BarChart3 size={28} className="mb-2 opacity-50" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

/* ─── Component ─── */
export default function SchoolAnalyticsDashboard() {
  const { user } = useAuth();
  const { activeYear } = useAcademicYear();
  const [loading, setLoading] = useState(!hasCached('admin-analytics'));
  const [range, setRange] = useState<'7' | '30' | '90'>('30');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [gradeLevelFilter, setGradeLevelFilter] = useState('all');
  const [tab, setTab] = useState<Tab>('overview');
  const [riskSearch, setRiskSearch] = useState('');

  // Raw data
  const [records, setRecords] = useCachedState<AttendanceRecord[]>('admin-analytics', []);
  const [recordsPrevious, setRecordsPrevious] = useCachedState<AttendanceRecord[]>('admin-analytics-prev', []);
  const [students, setStudents] = useCachedState<StudentRow[]>('admin-analytics-students', []);
  const [sections, setSections] = useCachedState<SectionRow[]>('admin-analytics-sections', []);
  const [instructors, setInstructors] = useCachedState<InstructorRow[]>('admin-analytics-instructors', []);
  const [grades, setGrades] = useCachedState<GradeRow[]>('admin-analytics-grades', []);
  const [subjects, setSubjects] = useCachedState<SubjectRow[]>('admin-analytics-subjects', []);

  const dateFrom = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(range));
    return d.toISOString().split('T')[0];
  }, [range]);

  const dateTo = useMemo(() => new Date().toISOString().split('T')[0], []);

  const dateFromPrevious = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(range) * 2);
    return d.toISOString().split('T')[0];
  }, [range]);

  const dateToPrevious = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(range) - 1);
    return d.toISOString().split('T')[0];
  }, [range]);

  /* ─── Fetch ─── */
  useEffect(() => {
    if (!user?.school_id) return;
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, range, activeYear]);

  useRealtimeRefresh(
    ['attendance_records', 'students', 'sections', 'users', 'grades'],
    fetchAll,
    { column: 'school_id', value: user?.school_id },
  );

  async function fetchAll() {
    const schoolId = user!.school_id!;
    const yearId = activeYear?.id;

    let recQuery = supabase
      .from('attendance_records')
      .select('id, student_id, status, date, recorded_at, schedule:schedules!inner(school_id, academic_year_id, instructor_id, section_id, subject_id)')
      .eq('schedule.school_id', schoolId)
      .gte('date', dateFrom)
      .lte('date', dateTo);
    if (yearId) recQuery = recQuery.eq('schedule.academic_year_id', yearId);

    let recQueryPrev = supabase
      .from('attendance_records')
      .select('id, student_id, status, date, recorded_at, schedule:schedules!inner(school_id, academic_year_id, instructor_id, section_id, subject_id)')
      .eq('schedule.school_id', schoolId)
      .gte('date', dateFromPrevious)
      .lte('date', dateToPrevious);
    if (yearId) recQueryPrev = recQueryPrev.eq('schedule.academic_year_id', yearId);

    let gradQuery = supabase
      .from('grades')
      .select('id, student_id, grade, quarter, subject_id, subject:subjects!inner(id, name, code)')
      .eq('school_id', schoolId)
      .lte('quarter', 3);
    if (yearId) gradQuery = gradQuery.eq('academic_year_id', yearId);

    const [recRes, recResPrev, stuRes, secRes, insRes, gradRes, subRes] = await Promise.all([
      recQuery,
      recQueryPrev,
      supabase
        .from('student_enrollments')
        .select('student_id, section_id, student:students!inner(id, first_name, last_name, lrn, section_id), section:sections!inner(name, grade_level)')
        .eq('school_id', schoolId)
        .eq('academic_year_id', yearId ?? '00000000-0000-0000-0000-000000000000'),
      supabase
        .from('sections')
        .select('id, name, grade_level')
        .eq('school_id', schoolId)
        .order('grade_level')
        .order('name'),
      supabase
        .from('users')
        .select('id, full_name')
        .eq('school_id', schoolId)
        .eq('role', 'instructor'),
      gradQuery,
      supabase
        .from('subjects')
        .select('id, name, code, grade_level')
        .eq('school_id', schoolId),
    ]);

    setRecords((recRes.data as unknown as AttendanceRecord[]) ?? []);
    setRecordsPrevious((recResPrev.data as unknown as AttendanceRecord[]) ?? []);
    setStudents(mapEnrollmentRoster((stuRes.data ?? []) as any) as StudentRow[]);
    setSections((secRes.data as unknown as SectionRow[]) ?? []);
    setInstructors((insRes.data as unknown as InstructorRow[]) ?? []);
    setGrades((gradRes.data as unknown as GradeRow[]) ?? []);
    setSubjects((subRes.data as unknown as SubjectRow[]) ?? []);
    setLoading(false);
  }

  /* ─── Filtered records ─── */
  const filteredRecords = useMemo(() => {
    let filtered = records;
    if (sectionFilter !== 'all') {
      filtered = filtered.filter(r => r.schedule?.section_id === sectionFilter);
    }
    if (gradeLevelFilter !== 'all') {
      const ids = new Set(sections.filter(s => s.grade_level === gradeLevelFilter).map(s => s.id));
      filtered = filtered.filter(r => r.schedule && ids.has(r.schedule.section_id));
    }
    return filtered;
  }, [records, sectionFilter, gradeLevelFilter, sections]);

  const filteredStudents = useMemo(() => {
    let list = students;
    if (sectionFilter !== 'all') list = list.filter(s => s.section_id === sectionFilter);
    if (gradeLevelFilter !== 'all') {
      const ids = new Set(sections.filter(s => s.grade_level === gradeLevelFilter).map(s => s.id));
      list = list.filter(s => ids.has(s.section_id));
    }
    return list;
  }, [students, sectionFilter, gradeLevelFilter, sections]);

  /* ─── KPIs ─── */
  const kpis = useMemo(() => {
    const total = filteredRecords.length;
    const present = filteredRecords.filter(r => r.status === 'present').length;
    const absent = filteredRecords.filter(r => r.status === 'absent').length;
    const late = filteredRecords.filter(r => r.status === 'late').length;
    const excused = filteredRecords.filter(r => r.status === 'excused').length;
    const rate = pct(present + late + excused, total);
    const absentRate = pct(absent, total);
    const uniqueDays = new Set(filteredRecords.map(r => r.date)).size;
    return { total, present, absent, late, excused, rate, absentRate, uniqueDays };
  }, [filteredRecords]);

  /* ─── Period Comparison ─── */
  const periodComparison = useMemo(() => {
    const prevTotal = recordsPrevious.length;
    const prevAbsent = recordsPrevious.filter(r => r.status === 'absent').length;
    const prevRate = pct(prevTotal - prevAbsent, prevTotal);
    const rateChange = kpis.rate - prevRate;
    const rateChangePercent = prevRate > 0 ? Math.round(((rateChange / prevRate) * 100) * 10) / 10 : 0;
    return {
      previousRate: prevRate,
      currentRate: kpis.rate,
      rateChange,
      rateChangePercent,
      trend: (Math.abs(rateChange) < 0.5 ? 'flat' : rateChange > 0 ? 'up' : 'down') as 'up' | 'down' | 'flat',
    };
  }, [kpis, recordsPrevious]);

  /* ─── Daily Trend ─── */
  const dailyTrend: DailyAttendance[] = useMemo(() => {
    const map = new Map<string, { present: number; absent: number; late: number; excused: number }>();
    for (const r of filteredRecords) {
      if (!map.has(r.date)) map.set(r.date, { present: 0, absent: 0, late: 0, excused: 0 });
      const day = map.get(r.date)!;
      day[r.status as keyof typeof day]++;
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => {
        const total = counts.present + counts.absent + counts.late + counts.excused;
        return { date, ...counts, total, rate: pct(counts.present + counts.late + counts.excused, total) };
      });
  }, [filteredRecords]);

  /* ─── Weekly Trend ─── */
  const weeklyTrend: WeeklyTrend[] = useMemo(() => {
    const map = new Map<string, { present: number; absent: number; late: number; excused: number; total: number }>();
    for (const r of filteredRecords) {
      const key = isoWeekKey(r.date);
      if (!map.has(key)) map.set(key, { present: 0, absent: 0, late: 0, excused: 0, total: 0 });
      const w = map.get(key)!;
      w[r.status as 'present' | 'absent' | 'late' | 'excused']++;
      w.total++;
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, w]) => ({
        week: formatDate(week),
        rate: pct(w.present + w.late + w.excused, w.total),
        absences: w.absent,
        total: w.total,
      }));
  }, [filteredRecords]);

  /* ─── Day of Week Pattern ─── */
  const dayOfWeekStats: DayOfWeekStat[] = useMemo(() => {
    const buckets = DAYS_OF_WEEK.map(d => ({ day: d, total: 0, absent: 0, present: 0 }));
    for (const r of filteredRecords) {
      const dow = new Date(r.date + 'T00:00:00').getDay();
      const idx = dow === 0 ? 6 : dow - 1;
      buckets[idx].total++;
      if (r.status === 'absent') buckets[idx].absent++;
      else buckets[idx].present++;
    }
    return buckets
      .filter(b => b.total > 0)
      .map(b => ({ day: b.day, total: b.total, absent: b.absent, rate: pct(b.total - b.absent, b.total) }));
  }, [filteredRecords]);

  /* ─── Status Breakdown (Pie) ─── */
  const statusPie = useMemo(() => [
    { name: 'Present', value: kpis.present, color: STATUS_COLORS.present },
    { name: 'Absent', value: kpis.absent, color: STATUS_COLORS.absent },
    { name: 'Late', value: kpis.late, color: STATUS_COLORS.late },
    { name: 'Excused', value: kpis.excused, color: STATUS_COLORS.excused },
  ].filter(s => s.value > 0), [kpis]);

  /* ─── Section Rates ─── */
  const sectionRates: SectionRate[] = useMemo(() => {
    return sections.map(sec => {
      const secRecords = records.filter(r => r.schedule?.section_id === sec.id);
      const total = secRecords.length;
      const present = secRecords.filter(r => r.status === 'present').length;
      const absent = secRecords.filter(r => r.status === 'absent').length;
      const late = secRecords.filter(r => r.status === 'late').length;
      const studentCount = students.filter(s => s.section_id === sec.id).length;
      return {
        id: sec.id,
        name: sec.name,
        grade_level: sec.grade_level,
        rate: pct(total - absent, total),
        total,
        present,
        absent,
        late,
        students: studentCount,
      };
    }).filter(s => s.total > 0).sort((a, b) => b.rate - a.rate);
  }, [records, sections, students]);

  /* ─── Instructor Activity ─── */
  const instructorActivity: InstructorActivity[] = useMemo(() => {
    const today = new Date();
    return instructors.map(ins => {
      const insRecords = records.filter(r => r.schedule?.instructor_id === ins.id);
      const days = new Set(insRecords.map(r => r.date));
      const lastDate = insRecords.length > 0
        ? insRecords.slice().sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0].date
        : 'N/A';
      const daysSinceActive = lastDate === 'N/A' ? Infinity : daysBetween(today, new Date(lastDate + 'T00:00:00'));
      return {
        name: ins.full_name,
        records_logged: insRecords.length,
        days_active: days.size,
        last_active: lastDate,
        daysSinceActive,
      };
    }).sort((a, b) => b.records_logged - a.records_logged);
  }, [records, instructors]);

  /* ─── At-Risk Students (per-student attendance + grades) ─── */
  const atRiskStudents: AtRiskStudent[] = useMemo(() => {
    // Pre-aggregate grades per student for efficiency
    const gradesByStudent = new Map<string, GradeRow[]>();
    for (const g of grades) {
      if (!gradesByStudent.has(g.student_id)) gradesByStudent.set(g.student_id, []);
      gradesByStudent.get(g.student_id)!.push(g);
    }

    return filteredStudents.map(stu => {
      const stuRecords = records.filter(r => r.student_id === stu.id);

      const dayMap = new Map<string, string>();
      const statusPriority: Record<string, number> = { present: 3, late: 2, excused: 1, absent: 0 };
      for (const r of stuRecords) {
        const existing = dayMap.get(r.date);
        if (!existing || (statusPriority[r.status] ?? 0) > (statusPriority[existing] ?? 0)) {
          dayMap.set(r.date, r.status);
        }
      }

      const dailyEntries = [...dayMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, status]) => ({ date, status }));

      const total = dailyEntries.length;
      const absences = dailyEntries.filter(d => d.status === 'absent').length;
      const lates = dailyEntries.filter(d => d.status === 'late').length;
      const rate = pct(absences, total);

      // Grade signals
      const stuGrades = gradesByStudent.get(stu.id) ?? [];
      const subjectAvgs = new Map<string, number[]>();
      const quarterAvgs = new Map<number, number[]>();
      for (const g of stuGrades) {
        if (typeof g.grade === 'number' && g.grade > 0) {
          if (!subjectAvgs.has(g.subject_id)) subjectAvgs.set(g.subject_id, []);
          subjectAvgs.get(g.subject_id)!.push(g.grade);
          if (!quarterAvgs.has(g.quarter)) quarterAvgs.set(g.quarter, []);
          quarterAvgs.get(g.quarter)!.push(g.grade);
        }
      }
      let failingSubjectCount = 0;
      subjectAvgs.forEach(list => {
        const avg = list.reduce((a, b) => a + b, 0) / list.length;
        if (avg < 75) failingSubjectCount++;
      });
      const allGrades = stuGrades.map(g => g.grade).filter(v => typeof v === 'number' && v > 0);
      const averageGrade = allGrades.length > 0 ? allGrades.reduce((a, b) => a + b, 0) / allGrades.length : null;
      const quarterAverages = new Map<number, number>();
      quarterAvgs.forEach((list, q) => quarterAverages.set(q, list.reduce((a, b) => a + b, 0) / list.length));

      const risk = computeRiskScore({
        dailyStatuses: dailyEntries,
        absenceRate: total > 0 ? (absences / total) * 100 : 0,
        totalSessions: total,
        absences,
        lates,
        failingSubjectCount,
        averageGrade,
        quarterAverages,
      });

      return {
        id: stu.id,
        name: `${stu.last_name}, ${stu.first_name}`,
        lrn: stu.lrn,
        section: stu.section?.name ?? '',
        absences,
        lates,
        total,
        rate,
        risk_score: risk.score,
        status: (risk.status === 'critical' ? 'critical' : 'warning') as 'critical' | 'warning',
        maxConsecutive: risk.maxConsecutiveAbsences,
        trendWorsening: risk.trendWorsening,
      };
    }).filter(s => s.risk_score >= 20).sort((a, b) => b.risk_score - a.risk_score);
  }, [records, filteredStudents, grades]);

  /* ─── Chronic Absenteeism (DOE metric: >=20% absence rate across period) ─── */
  const chronicStats = useMemo(() => {
    let chronic = 0;
    let perfect = 0;
    let anyAttendance = 0;
    for (const stu of filteredStudents) {
      const stuRecs = records.filter(r => r.student_id === stu.id);
      const dayMap = new Map<string, string>();
      const statusPriority: Record<string, number> = { present: 3, late: 2, excused: 1, absent: 0 };
      for (const r of stuRecs) {
        const existing = dayMap.get(r.date);
        if (!existing || (statusPriority[r.status] ?? 0) > (statusPriority[existing] ?? 0)) {
          dayMap.set(r.date, r.status);
        }
      }
      const total = dayMap.size;
      if (total === 0) continue;
      anyAttendance++;
      const absences = [...dayMap.values()].filter(s => s === 'absent').length;
      const absenceRate = (absences / total) * 100;
      if (absenceRate >= 20) chronic++;
      if (absences === 0) perfect++;
    }
    return { chronic, perfect, anyAttendance };
  }, [filteredStudents, records]);

  /* ─── Grade Statistics ─── */
  const gradeStats: GradeStats = useMemo(() => {
    const studentGrades = new Map<string, number[]>();
    grades.forEach(g => {
      if (typeof g.grade === 'number' && g.grade > 0) {
        if (!studentGrades.has(g.student_id)) studentGrades.set(g.student_id, []);
        studentGrades.get(g.student_id)!.push(g.grade);
      }
    });
    const gpas: number[] = [];
    studentGrades.forEach(list => {
      if (list.length > 0) gpas.push(list.reduce((a, b) => a + b, 0) / list.length);
    });
    const excellentCount = gpas.filter(g => g >= 90).length;
    const goodCount = gpas.filter(g => g >= 85 && g < 90).length;
    const satisfactoryCount = gpas.filter(g => g >= 75 && g < 85).length;
    const needsImprovementCount = gpas.filter(g => g >= 60 && g < 75).length;
    const failingCount = gpas.filter(g => g < 60).length;
    const averageGpa = gpas.length > 0 ? Math.round((gpas.reduce((a, b) => a + b, 0) / gpas.length) * 10) / 10 : 0;
    return {
      totalStudents: gpas.length,
      averageGpa,
      medianGpa: Math.round(median(gpas) * 10) / 10,
      excellentCount,
      goodCount,
      satisfactoryCount,
      needsImprovementCount,
      failingCount,
    };
  }, [grades]);

  /* ─── Subject Performance ─── */
  const subjectPerformance: SubjectPerformance[] = useMemo(() => {
    return subjects.map(subject => {
      const subjectGrades = grades.filter(g => g.subject_id === subject.id);
      const validGrades = subjectGrades.filter(g => typeof g.grade === 'number' && g.grade > 0);
      const averageGrade = validGrades.length > 0
        ? Math.round((validGrades.reduce((a, b) => a + b.grade, 0) / validGrades.length) * 10) / 10
        : 0;
      const passingCount = validGrades.filter(g => g.grade >= 75).length;
      const studentCount = new Set(subjectGrades.map(g => g.student_id)).size;
      const passRate = validGrades.length > 0 ? Math.round((passingCount / validGrades.length) * 1000) / 10 : 0;
      return {
        id: subject.id,
        name: subject.name,
        code: subject.code,
        averageGrade,
        totalGrades: validGrades.length,
        passingCount,
        studentCount,
        passRate,
      };
    }).filter(s => s.totalGrades > 0).sort((a, b) => b.averageGrade - a.averageGrade);
  }, [grades, subjects]);

  /* ─── Grade Distribution ─── */
  const gradeDistribution: GradeDistribution[] = useMemo(() => {
    const validGrades = grades.filter(g => typeof g.grade === 'number' && g.grade > 0).map(g => g.grade);
    if (validGrades.length === 0) return [];
    const ranges = [
      { range: '90-100', min: 90, max: 100 },
      { range: '85-89', min: 85, max: 89 },
      { range: '75-84', min: 75, max: 84 },
      { range: '60-74', min: 60, max: 74 },
      { range: 'Below 60', min: 0, max: 59 },
    ];
    return ranges.map(r => {
      const count = validGrades.filter(g => g >= r.min && g <= r.max).length;
      return { range: r.range, count, percentage: Math.round((count / validGrades.length) * 1000) / 10 };
    }).filter(d => d.count > 0);
  }, [grades]);

  /* ─── Quarter Grade Trend ─── */
  const quarterTrend: QuarterTrend[] = useMemo(() => {
    const byQuarter = new Map<number, number[]>();
    for (const g of grades) {
      if (typeof g.grade === 'number' && g.grade > 0) {
        if (!byQuarter.has(g.quarter)) byQuarter.set(g.quarter, []);
        byQuarter.get(g.quarter)!.push(g.grade);
      }
    }
    return [...byQuarter.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([q, list]) => ({
        quarter: `Q${q}`,
        average: Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10,
        count: list.length,
      }));
  }, [grades]);

  /* ─── Attendance vs Grades Correlation ─── */
  const attendanceGradeCorrelation = useMemo(() => {
    const out: { attendance: number; averageGrade: number; name: string }[] = [];
    for (const stu of students) {
      const stuRecords = records.filter(r => r.student_id === stu.id);
      const dayMap = new Map<string, string>();
      const statusPriority: Record<string, number> = { present: 3, late: 2, excused: 1, absent: 0 };
      for (const r of stuRecords) {
        const existing = dayMap.get(r.date);
        if (!existing || (statusPriority[r.status] ?? 0) > (statusPriority[existing] ?? 0)) {
          dayMap.set(r.date, r.status);
        }
      }
      const total = dayMap.size;
      const present = [...dayMap.values()].filter(s => s !== 'absent').length;
      const attendanceRate = total > 0 ? (present / total) * 100 : 0;
      const stuGrades = grades.filter(g => g.student_id === stu.id && typeof g.grade === 'number' && g.grade > 0).map(g => g.grade);
      const averageGrade = stuGrades.length > 0 ? stuGrades.reduce((a, b) => a + b, 0) / stuGrades.length : 0;
      if (attendanceRate > 0 && averageGrade > 0) {
        out.push({
          attendance: Math.round(attendanceRate * 10) / 10,
          averageGrade: Math.round(averageGrade * 10) / 10,
          name: `${stu.last_name}, ${stu.first_name}`.substring(0, 20),
        });
      }
    }
    return out;
  }, [students, records, grades]);

  /* ─── Grade Level Summary ─── */
  const gradeLevelSummary: GradeLevelSummary[] = useMemo(() => {
    const levels = [...new Set(sections.map(s => s.grade_level))].sort();
    return levels.map(level => {
      const sectionsHere = sections.filter(s => s.grade_level === level);
      const sectionIds = new Set(sectionsHere.map(s => s.id));
      const stuHere = students.filter(s => sectionIds.has(s.section_id));
      const recsHere = records.filter(r => r.schedule && sectionIds.has(r.schedule.section_id));
      const present = recsHere.filter(r => r.status !== 'absent').length;
      const rate = pct(present, recsHere.length);

      // GPA
      const stuIds = new Set(stuHere.map(s => s.id));
      const gradesHere = grades.filter(g => stuIds.has(g.student_id) && typeof g.grade === 'number' && g.grade > 0);
      const perStu = new Map<string, number[]>();
      for (const g of gradesHere) {
        if (!perStu.has(g.student_id)) perStu.set(g.student_id, []);
        perStu.get(g.student_id)!.push(g.grade);
      }
      const gpas: number[] = [];
      perStu.forEach(list => { if (list.length > 0) gpas.push(list.reduce((a, b) => a + b, 0) / list.length); });
      const avgGpa = gpas.length > 0 ? Math.round((gpas.reduce((a, b) => a + b, 0) / gpas.length) * 10) / 10 : 0;

      const atRisk = atRiskStudents.filter(ar => {
        const stu = students.find(s => s.id === ar.id);
        return stu && sectionIds.has(stu.section_id);
      }).length;

      return {
        grade_level: level,
        sections: sectionsHere.length,
        students: stuHere.length,
        rate,
        avgGpa,
        atRisk,
      };
    });
  }, [sections, students, records, grades, atRiskStudents]);

  /* ─── Insights ─── */
  const insights = useMemo(() => {
    const alerts: { type: 'warning' | 'critical' | 'info' | 'success'; msg: string }[] = [];

    if (kpis.rate < 80 && kpis.total > 0) {
      alerts.push({ type: 'critical', msg: `Attendance rate at ${kpis.rate}% — below the 80% threshold. Schedule a parent-teacher engagement push.` });
    } else if (kpis.rate >= 95) {
      alerts.push({ type: 'success', msg: `Outstanding attendance at ${kpis.rate}% across ${kpis.uniqueDays} school days.` });
    }

    if (periodComparison.rateChange <= -2 && recordsPrevious.length > 0) {
      alerts.push({ type: 'warning', msg: `Attendance dropped ${Math.abs(periodComparison.rateChange).toFixed(1)}pp vs previous ${range} days — investigate contributing sections.` });
    } else if (periodComparison.rateChange >= 2 && recordsPrevious.length > 0) {
      alerts.push({ type: 'success', msg: `Attendance improved ${periodComparison.rateChange.toFixed(1)}pp vs previous ${range} days.` });
    }

    if (chronicStats.chronic > 0 && chronicStats.anyAttendance > 0) {
      const chronicPct = Math.round((chronicStats.chronic / chronicStats.anyAttendance) * 100);
      if (chronicPct >= 15) {
        alerts.push({ type: 'critical', msg: `${chronicStats.chronic} students (${chronicPct}%) are chronically absent (≥20% days missed). DepEd CPD trigger threshold.` });
      } else if (chronicStats.chronic > 0) {
        alerts.push({ type: 'warning', msg: `${chronicStats.chronic} student(s) chronically absent. Consider home visits.` });
      }
    }

    if (gradeStats.totalStudents > 0) {
      const failureRate = Math.round((gradeStats.failingCount / gradeStats.totalStudents) * 100);
      if (failureRate >= 15) {
        alerts.push({ type: 'critical', msg: `${failureRate}% of students are failing. Escalate to academic committee.` });
      } else if (gradeStats.failingCount > 0) {
        alerts.push({ type: 'warning', msg: `${gradeStats.failingCount} student(s) failing across subjects. Review grade recovery options.` });
      }
    }

    if (atRiskStudents.length > 0 && filteredStudents.length > 0) {
      const riskRate = Math.round((atRiskStudents.length / filteredStudents.length) * 100);
      if (riskRate >= 25) {
        alerts.push({ type: 'critical', msg: `${riskRate}% of students flagged at-risk — review intervention workflow.` });
      }
    }

    const inactive = instructorActivity.filter(i => i.daysSinceActive >= 7 && i.daysSinceActive !== Infinity).length;
    if (inactive > 0) {
      alerts.push({ type: 'warning', msg: `${inactive} teacher(s) haven't logged attendance in 7+ days.` });
    }

    const lowSections = sectionRates.filter(s => s.rate < 75 && s.total >= 10);
    if (lowSections.length > 0) {
      alerts.push({ type: 'warning', msg: `${lowSections.length} section(s) below 75% attendance: ${lowSections.slice(0, 3).map(s => s.name).join(', ')}${lowSections.length > 3 ? '…' : ''}` });
    }

    if (dayOfWeekStats.length > 0) {
      const worst = [...dayOfWeekStats].sort((a, b) => a.rate - b.rate)[0];
      if (worst.rate < kpis.rate - 5) {
        alerts.push({ type: 'info', msg: `${worst.day} attendance averages ${worst.rate}% — ${(kpis.rate - worst.rate).toFixed(1)}pp below overall. Consider schedule review.` });
      }
    }

    if (alerts.length === 0 && kpis.rate >= 90) {
      alerts.push({ type: 'success', msg: 'All indicators green. No action required.' });
    }
    return alerts;
  }, [kpis, gradeStats, atRiskStudents, filteredStudents, instructorActivity, periodComparison, chronicStats, sectionRates, dayOfWeekStats, recordsPrevious, range]);

  /* ─── Export Columns ─── */
  const summaryData = useMemo(() => [
    { metric: 'Attendance Rate', value: `${kpis.rate}%` },
    { metric: 'Previous Period Rate', value: `${periodComparison.previousRate}%` },
    { metric: 'Rate Change', value: `${periodComparison.rateChange > 0 ? '+' : ''}${periodComparison.rateChange.toFixed(1)}%` },
    { metric: 'Total Records', value: kpis.total.toLocaleString() },
    { metric: 'Present', value: kpis.present.toLocaleString() },
    { metric: 'Absent', value: kpis.absent.toLocaleString() },
    { metric: 'Late', value: kpis.late.toLocaleString() },
    { metric: 'Excused', value: kpis.excused.toLocaleString() },
    { metric: 'Chronic Absentees (≥20%)', value: chronicStats.chronic },
    { metric: 'Perfect Attendance', value: chronicStats.perfect },
    { metric: 'At-Risk Students', value: atRiskStudents.length },
    { metric: 'Avg GPA', value: gradeStats.averageGpa.toFixed(2) },
    { metric: 'Median GPA', value: gradeStats.medianGpa.toFixed(2) },
    { metric: 'Failing Students', value: gradeStats.failingCount },
  ], [kpis, atRiskStudents, gradeStats, periodComparison, chronicStats]);

  const summaryColumns: ExportColumn<{ metric: string; value: string | number }>[] = [
    { header: 'Metric', value: r => r.metric },
    { header: 'Value', value: r => String(r.value) },
  ];

  const sectionRatesColumns: ExportColumn<SectionRate>[] = [
    { header: 'Section Name', value: r => r.name },
    { header: 'Grade Level', value: r => r.grade_level },
    { header: 'Students', value: r => r.students },
    { header: 'Attendance Rate %', value: r => r.rate.toFixed(1) },
    { header: 'Present', value: r => r.present },
    { header: 'Late', value: r => r.late },
    { header: 'Absent', value: r => r.absent },
    { header: 'Total Records', value: r => r.total },
  ];

  const subjectColumns: ExportColumn<SubjectPerformance>[] = [
    { header: 'Subject Name', value: r => r.name },
    { header: 'Code', value: r => r.code },
    { header: 'Average Grade', value: r => r.averageGrade.toFixed(1) },
    { header: 'Pass Rate %', value: r => r.passRate.toFixed(1) },
    { header: 'Grades Recorded', value: r => r.totalGrades },
    { header: 'Students Graded', value: r => r.studentCount },
  ];

  const atRiskColumns: ExportColumn<AtRiskStudent>[] = [
    { header: 'Student Name', value: r => r.name },
    { header: 'LRN', value: r => r.lrn },
    { header: 'Section', value: r => r.section },
    { header: 'Absences', value: r => r.absences },
    { header: 'Lates', value: r => r.lates },
    { header: 'Max Consecutive Absences', value: r => r.maxConsecutive },
    { header: 'Total Records', value: r => r.total },
    { header: 'Absence Rate %', value: r => r.rate.toFixed(1) },
    { header: 'Trend Worsening', value: r => r.trendWorsening ? 'Yes' : 'No' },
    { header: 'Risk Score', value: r => r.risk_score },
    { header: 'Status', value: r => r.status === 'critical' ? 'CRITICAL' : 'AT-RISK' },
  ];

  async function downloadDesignedAnalyticsReport() {
    const attendanceTone: DashboardMetric['tone'] = kpis.rate >= 95 ? 'green' : kpis.rate >= 80 ? 'amber' : 'red';
    const metrics: DashboardMetric[] = [
      { label: 'Attendance Rate', value: `${kpis.rate}%`, tone: attendanceTone, progress: kpis.rate },
      { label: 'Present Records', value: kpis.present.toLocaleString(), tone: 'green', progress: kpis.total ? kpis.present / kpis.total * 100 : 0 },
      { label: 'Absent Records', value: kpis.absent.toLocaleString(), tone: kpis.absent ? 'red' : 'green', progress: kpis.total ? kpis.absent / kpis.total * 100 : 0 },
      { label: 'Previous Period', value: `${periodComparison.previousRate}%`, tone: 'slate', progress: periodComparison.previousRate },
      { label: 'Rate Change', value: `${periodComparison.rateChange > 0 ? '+' : ''}${periodComparison.rateChange.toFixed(1)} pp`, tone: periodComparison.rateChange >= 0 ? 'green' : 'red' },
      { label: 'Total Attendance Records', value: kpis.total.toLocaleString(), tone: 'blue' },
      { label: 'Late Records', value: kpis.late.toLocaleString(), tone: kpis.late ? 'amber' : 'green' },
      { label: 'Excused Records', value: kpis.excused.toLocaleString(), tone: 'blue' },
      { label: 'Perfect Attendance', value: chronicStats.perfect.toLocaleString(), tone: 'green' },
      { label: 'Chronic Absentees', value: chronicStats.chronic.toLocaleString(), tone: chronicStats.chronic ? 'red' : 'green' },
      { label: 'At-Risk Students', value: atRiskStudents.length.toLocaleString(), tone: atRiskStudents.length ? 'amber' : 'green' },
      { label: 'Average GPA', value: gradeStats.averageGpa.toFixed(1), tone: gradeStats.averageGpa >= 90 ? 'green' : gradeStats.averageGpa >= 75 ? 'amber' : 'red', progress: gradeStats.averageGpa },
      { label: 'Median GPA', value: gradeStats.medianGpa.toFixed(1), tone: 'blue', progress: gradeStats.medianGpa },
      { label: 'Failing Students', value: gradeStats.failingCount.toLocaleString(), tone: gradeStats.failingCount ? 'red' : 'green' },
    ];
    const selectedSection = sections.find(section => section.id === sectionFilter);
    await downloadDashboardWorkbook('classpulse-school-analytics', {
      title: 'ClassPulse School Analytics Report',
      subtitle: `${activeYear?.name ?? 'Selected academic year'} · ${range}-day performance overview`,
      generatedBy: user?.full_name,
      metadata: [
        { label: 'Report period', value: `${dateFrom} to ${dateTo}` },
        { label: 'Grade filter', value: gradeLevelFilter === 'all' ? 'All grade levels' : gradeLevelFilter },
        { label: 'Section filter', value: selectedSection ? `${selectedSection.grade_level} - ${selectedSection.name}` : 'All sections' },
        { label: 'Students included', value: filteredStudents.length },
      ],
      metrics,
      insights: insights.map(insight => ({ type: insight.type, message: insight.msg })),
      sheets: [
        {
          name: 'Attendance Trend',
          title: 'Daily Attendance Trend',
          headers: ['Date', 'Present', 'Absent', 'Late', 'Excused', 'Total Records', 'Attendance Rate'],
          rows: dailyTrend.map(day => [day.date, day.present, day.absent, day.late, day.excused, day.total, day.rate]),
          widths: [16, 13, 13, 12, 13, 16, 19],
        },
        {
          name: 'Sections',
          title: 'Section Performance',
          headers: ['Section', 'Grade Level', 'Students', 'Present', 'Absent', 'Late', 'Total Records', 'Attendance Rate'],
          rows: sectionRates.map(section => [section.name, section.grade_level, section.students, section.present, section.absent, section.late, section.total, section.rate]),
          widths: [24, 17, 13, 13, 13, 12, 16, 19],
        },
        ...(subjectPerformance.length ? [{
          name: 'Subjects',
          title: 'Subject Performance',
          headers: ['Subject', 'Code', 'Average Grade', 'Pass Rate', 'Grades Recorded', 'Students Graded'],
          rows: subjectPerformance.map(subject => [subject.name, subject.code, subject.averageGrade, subject.passRate, subject.totalGrades, subject.studentCount]),
          widths: [30, 16, 18, 16, 18, 18],
        }] : []),
        ...(atRiskStudents.length ? [{
          name: 'At-Risk Students',
          title: 'Students Requiring Attention',
          headers: ['Student', 'LRN', 'Section', 'Absences', 'Lates', 'Consecutive Absences', 'Total Records', 'Absence Rate', 'Risk Score', 'Status'],
          rows: atRiskStudents.map(student => [student.name, student.lrn, student.section, student.absences, student.lates, student.maxConsecutive, student.total, student.rate, student.risk_score, student.status === 'critical' ? 'CRITICAL' : 'AT-RISK']),
          widths: [30, 16, 24, 14, 12, 22, 16, 17, 14, 14],
        }] : []),
      ],
    });
  }

  /* ─── Filtered at-risk students (for search) ─── */
  const visibleAtRisk = useMemo(() => {
    const q = riskSearch.trim().toLowerCase();
    if (!q) return atRiskStudents;
    return atRiskStudents.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.lrn.toLowerCase().includes(q) ||
      s.section.toLowerCase().includes(q),
    );
  }, [atRiskStudents, riskSearch]);

  /* ─── Render ─── */
  if (loading) {
    return <LoadingState />;
  }

  const insightIcon = (type: 'critical' | 'warning' | 'info' | 'success') => {
    if (type === 'critical') return <XCircle size={18} className="text-red-600" />;
    if (type === 'warning') return <AlertTriangle size={18} className="text-amber-600" />;
    if (type === 'success') return <CheckCircle size={18} className="text-emerald-600" />;
    return <Activity size={18} className="text-blue-600" />;
  };

  const insightBg = (type: 'critical' | 'warning' | 'info' | 'success') => {
    if (type === 'critical') return 'bg-red-50 border-red-200';
    if (type === 'warning') return 'bg-amber-50 border-amber-200';
    if (type === 'success') return 'bg-emerald-50 border-emerald-200';
    return 'bg-blue-50 border-blue-200';
  };

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">School Analytics</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {activeYear?.name ? `${activeYear.name} · ` : ''}
            {filteredStudents.length} students · {sections.length} sections · {kpis.total.toLocaleString()} records
          </p>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-slate-900">{kpis.rate}%</span>
          <span className="text-sm text-slate-400">attendance</span>
          {recordsPrevious.length > 0 && periodComparison.trend !== 'flat' && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
              periodComparison.trend === 'up' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
            }`}>
              {periodComparison.rateChange > 0 ? '+' : ''}{periodComparison.rateChange.toFixed(1)}pp
            </span>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-sm text-slate-600">
          <Filter size={13} className="text-slate-400" />
          <select
            value={gradeLevelFilter}
            onChange={e => setGradeLevelFilter(e.target.value)}
            className="bg-transparent outline-none cursor-pointer text-sm"
          >
            <option value="all">All Grade Levels</option>
            {[...new Set(sections.map(s => s.grade_level))].sort().map(level => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-sm text-slate-600">
          <Users size={13} className="text-slate-400" />
          <select
            value={sectionFilter}
            onChange={e => setSectionFilter(e.target.value)}
            className="bg-transparent outline-none cursor-pointer text-sm"
          >
            <option value="all">All Sections</option>
            {sections.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.grade_level})</option>
            ))}
          </select>
        </div>

        <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden">
          {(['7', '30', '90'] as const).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                range === r ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          icon={<CheckCircle size={16} />}
          label="Present"
          value={kpis.present.toLocaleString()}
          sub={`${pct(kpis.present, kpis.total)}% of records`}
          accent="border-l-emerald-500"
        />
        <KpiCard
          icon={<XCircle size={16} />}
          label="Absent"
          value={kpis.absent.toLocaleString()}
          sub={`${kpis.absentRate}% of records`}
          accent="border-l-rose-500"
        />
        <KpiCard
          icon={<Clock size={16} />}
          label="Late"
          value={kpis.late.toLocaleString()}
          sub={`${pct(kpis.late, kpis.total)}% of records`}
          accent="border-l-amber-500"
        />
        <KpiCard
          icon={<AlertTriangle size={16} />}
          label="At-Risk"
          value={atRiskStudents.length}
          sub={`${filteredStudents.length > 0 ? Math.round((atRiskStudents.length / filteredStudents.length) * 100) : 0}% of cohort`}
          accent="border-l-orange-500"
        />
        <KpiCard
          icon={<Award size={16} />}
          label="Avg GPA"
          value={gradeStats.totalStudents > 0 ? gradeStats.averageGpa.toFixed(1) : '—'}
          sub={gradeStats.totalStudents > 0 ? `median ${gradeStats.medianGpa.toFixed(1)}` : 'no grades yet'}
          accent="border-l-sky-500"
        />
        <KpiCard
          icon={<GraduationCap size={16} />}
          label="Failing"
          value={gradeStats.failingCount}
          sub={gradeStats.totalStudents > 0 ? `${pct(gradeStats.failingCount, gradeStats.totalStudents)}% of graded` : '—'}
          accent="border-l-red-500"
        />
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <SectionCard
          title="Key Insights"
          subtitle="Automated flags across attendance and academics"
          icon={<Zap size={18} className="text-amber-500" />}
        >
          <ul className="space-y-2">
            {insights.map((a, idx) => (
              <li key={idx} className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border ${insightBg(a.type)}`}>
                <span className="mt-0.5 shrink-0">{insightIcon(a.type)}</span>
                <span className="text-sm text-slate-700">{a.msg}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* Tab nav */}
      <div className="flex items-center gap-0.5 border-b border-slate-200 overflow-x-auto scrollbar-hide">
        {([
          { key: 'overview' as Tab, label: 'Overview', icon: <LayoutDashboard size={14} /> },
          { key: 'attendance' as Tab, label: 'Attendance', icon: <Calendar size={14} /> },
          { key: 'academics' as Tab, label: 'Academics', icon: <BookOpen size={14} /> },
          { key: 'at-risk' as Tab, label: `At-Risk (${atRiskStudents.length})`, icon: <AlertTriangle size={14} /> },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap border-b-2 -mb-px ${
              tab === t.key
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Overview */}
      {tab === 'overview' && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <SectionCard
              title="Attendance Trend"
              subtitle={`Daily breakdown · last ${range} days`}
              icon={<TrendingUp size={18} className="text-emerald-500" />}
              className="lg:col-span-2"
            >
              {dailyTrend.length === 0 ? (
                <EmptyState message="No data in this period" />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={dailyTrend}>
                    <defs>
                      <linearGradient id="gradPresent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="gradAbsent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" tickFormatter={formatDate} fontSize={11} stroke="#94a3b8" />
                    <YAxis fontSize={11} stroke="#94a3b8" />
                    <Tooltip
                      contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                      labelFormatter={formatDate}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="present" stackId="1" stroke="#10b981" strokeWidth={1.5} fill="url(#gradPresent)" name="Present" />
                    <Area type="monotone" dataKey="late" stackId="1" stroke="#f59e0b" strokeWidth={1.5} fill="#f59e0b" fillOpacity={0.25} name="Late" />
                    <Area type="monotone" dataKey="excused" stackId="1" stroke="#6366f1" strokeWidth={1.5} fill="#6366f1" fillOpacity={0.25} name="Excused" />
                    <Area type="monotone" dataKey="absent" stackId="1" stroke="#ef4444" strokeWidth={1.5} fill="url(#gradAbsent)" name="Absent" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </SectionCard>

            <SectionCard
              title="Status Breakdown"
              subtitle="Distribution of records"
              icon={<PieIcon />}
            >
              {statusPie.length === 0 ? (
                <EmptyState message="No data" />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={statusPie}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={95}
                      paddingAngle={3}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                    >
                      {statusPie.map((entry, i) => (
                        <Cell key={i} fill={entry.color ?? PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </SectionCard>
          </div>

          {/* Grade Level Summary */}
          {gradeLevelSummary.length > 0 && (
            <SectionCard
              title="Grade Level Summary"
              subtitle="Cross-section performance snapshot"
              icon={<GraduationCap size={18} className="text-indigo-500" />}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Grade Level</th>
                      <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Sections</th>
                      <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Students</th>
                      <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Attendance</th>
                      <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Avg GPA</th>
                      <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase text-right">At-Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gradeLevelSummary.map(row => {
                      const tone = rateTone(row.rate);
                      return (
                        <tr key={row.grade_level} className="border-b border-slate-100 hover:bg-slate-50/50">
                          <td className="px-5 py-3 text-sm font-semibold text-slate-800">{row.grade_level}</td>
                          <td className="px-5 py-3 text-sm text-slate-600 text-right">{row.sections}</td>
                          <td className="px-5 py-3 text-sm text-slate-600 text-right">{row.students}</td>
                          <td className="px-5 py-3 text-right">
                            <div className="inline-flex items-center gap-2">
                              <div className="w-20 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                <div
                                  className="h-1.5 rounded-full"
                                  style={{ width: `${Math.min(100, row.rate)}%`, background: tone.fill }}
                                />
                              </div>
                              <span className={`text-xs font-semibold ${tone.text}`}>{row.rate}%</span>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-sm text-slate-600 text-right">
                            {row.avgGpa > 0 ? row.avgGpa.toFixed(1) : '—'}
                          </td>
                          <td className="px-5 py-3 text-sm text-right">
                            {row.atRisk > 0 ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-700">
                                {row.atRisk}
                              </span>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}

          {/* Period Comparison */}
          <SectionCard
            title="Period Comparison"
            subtitle={`Current vs previous ${range}-day window`}
            icon={<Activity size={18} className="text-sky-500" />}
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div className="bg-slate-50 rounded-lg p-4">
                <p className="text-xs text-slate-500 uppercase font-medium mb-1">Previous Period</p>
                <p className="text-3xl font-bold text-slate-700">{periodComparison.previousRate}%</p>
                <p className="text-xs text-slate-400 mt-1">{recordsPrevious.length.toLocaleString()} records</p>
              </div>
              <div className="bg-primary/5 rounded-lg p-4 border border-primary/20">
                <p className="text-xs text-primary uppercase font-medium mb-1">Current Period</p>
                <p className="text-3xl font-bold text-primary">{periodComparison.currentRate}%</p>
                <p className="text-xs text-slate-500 mt-1">{kpis.total.toLocaleString()} records</p>
              </div>
              <div className={`rounded-lg p-4 border ${
                periodComparison.trend === 'up' ? 'bg-emerald-50 border-emerald-200' :
                periodComparison.trend === 'down' ? 'bg-red-50 border-red-200' :
                'bg-slate-50 border-slate-200'
              }`}>
                <p className="text-xs uppercase font-medium mb-1 text-slate-500">Change</p>
                <div className="flex items-baseline gap-2">
                  <p className={`text-3xl font-bold ${
                    periodComparison.trend === 'up' ? 'text-emerald-700' :
                    periodComparison.trend === 'down' ? 'text-red-700' :
                    'text-slate-700'
                  }`}>
                    {periodComparison.rateChange > 0 ? '+' : ''}{periodComparison.rateChange.toFixed(1)}
                  </p>
                  <span className="text-sm text-slate-500">pp</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {periodComparison.rateChangePercent > 0 ? '+' : ''}{periodComparison.rateChangePercent}% relative
                </p>
              </div>
            </div>
          </SectionCard>

          {/* Export card */}
          <SectionCard
            title="Export Data"
            subtitle="Download a presentation-ready Excel workbook or raw CSV data"
            icon={<Download size={18} className="text-emerald-500" />}
          >
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => downloadCsv('analytics_summary', summaryData, summaryColumns)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Download size={14} /> Raw Summary CSV
              </button>
              <button
                onClick={() => void downloadDesignedAnalyticsReport()}
                className="bg-sky-600 hover:bg-sky-700 text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <FileSpreadsheet size={14} /> Designed Excel Report
              </button>
              <button
                onClick={() => downloadCsv('section_rates', sectionRates, sectionRatesColumns)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Download size={14} /> Sections CSV
              </button>
              {subjectPerformance.length > 0 && (
                <button
                  onClick={() => downloadCsv('subject_performance', subjectPerformance, subjectColumns)}
                  className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Download size={14} /> Subjects CSV
                </button>
              )}
              {atRiskStudents.length > 0 && (
                <button
                  onClick={() => downloadCsv('at_risk_students', atRiskStudents, atRiskColumns)}
                  className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Download size={14} /> At-Risk CSV
                </button>
              )}
            </div>
          </SectionCard>
        </>
      )}

      {/* Tab: Attendance */}
      {tab === 'attendance' && (
        <>
          {/* Weekly trend + day of week */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SectionCard
              title="Weekly Trend"
              subtitle="Attendance rate aggregated by ISO week"
              icon={<Calendar size={18} className="text-sky-500" />}
            >
              {weeklyTrend.length === 0 ? (
                <EmptyState message="Not enough data" />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={weeklyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="week" fontSize={11} stroke="#94a3b8" />
                    <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} fontSize={11} stroke="#94a3b8" />
                    <Tooltip
                      contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                      formatter={(value: unknown) => [`${value}%`, 'Rate']}
                    />
                    <Line type="monotone" dataKey="rate" stroke="#0ea5e9" strokeWidth={2.5} dot={{ r: 4, fill: '#0ea5e9' }} name="Attendance Rate" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </SectionCard>

            <SectionCard
              title="Day of Week Pattern"
              subtitle="Where's the drop-off?"
              icon={<BarChart3 size={18} className="text-indigo-500" />}
            >
              {dayOfWeekStats.length === 0 ? (
                <EmptyState message="Not enough data" />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={dayOfWeekStats}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="day" fontSize={11} stroke="#94a3b8" />
                    <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} fontSize={11} stroke="#94a3b8" />
                    <Tooltip
                      contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                      formatter={(value: unknown) => [`${value}%`, 'Rate']}
                    />
                    <Bar dataKey="rate" radius={[6, 6, 0, 0]}>
                      {dayOfWeekStats.map((entry, i) => (
                        <Cell key={i} fill={rateTone(entry.rate).fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </SectionCard>
          </div>

          {/* Daily rate line */}
          <SectionCard
            title="Daily Attendance Rate"
            subtitle="Point-in-time detail"
            icon={<Activity size={18} className="text-primary" />}
          >
            {dailyTrend.length === 0 ? (
              <EmptyState message="No data" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={dailyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tickFormatter={formatDate} fontSize={11} stroke="#94a3b8" />
                  <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} fontSize={11} stroke="#94a3b8" />
                  <Tooltip
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                    labelFormatter={formatDate}
                    formatter={(value: unknown) => [`${value}%`, 'Rate']}
                  />
                  <Line type="monotone" dataKey="rate" stroke="#0ea5e9" strokeWidth={2.5} dot={{ r: 3 }} name="Attendance Rate" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </SectionCard>

          {/* Section rates */}
          <SectionCard
            title="Attendance Rate by Section"
            subtitle="Ranked top to bottom"
            icon={<Target size={18} className="text-sky-500" />}
            action={sectionRates.length > 0 ? (
              <button
                onClick={() => downloadCsv('section_rates', sectionRates, sectionRatesColumns)}
                className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Download size={12} /> Export
              </button>
            ) : undefined}
          >
            {sectionRates.length === 0 ? (
              <EmptyState message="No section data" />
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(250, sectionRates.length * 36)}>
                <BarChart data={sectionRates} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} fontSize={11} stroke="#94a3b8" />
                  <YAxis type="category" dataKey="name" width={140} fontSize={11} stroke="#94a3b8" />
                  <Tooltip
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                    formatter={(value: unknown) => [`${value}%`, 'Attendance Rate']}
                  />
                  <Bar dataKey="rate" name="Attendance Rate" radius={[0, 6, 6, 0]}>
                    {sectionRates.map((entry, i) => (
                      <Cell key={i} fill={rateTone(entry.rate).fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </SectionCard>

          {/* Instructor activity */}
          <SectionCard
            title="Teacher Activity"
            subtitle="Who's logging attendance regularly"
            icon={<Users size={18} className="text-indigo-500" />}
          >
            <div className="overflow-x-auto -mx-5 -my-5">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Teacher</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Records</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Active Days</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Last Active</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {instructorActivity.length === 0 ? (
                    <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-400">No activity</td></tr>
                  ) : instructorActivity.map(ins => {
                    const status = ins.daysSinceActive === Infinity
                      ? { bg: 'bg-slate-100', text: 'text-slate-500', label: 'Never' }
                      : ins.daysSinceActive <= 1
                        ? { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Active' }
                        : ins.daysSinceActive <= 7
                          ? { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Recent' }
                          : ins.daysSinceActive <= 14
                            ? { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Idle' }
                            : { bg: 'bg-red-100', text: 'text-red-700', label: 'Inactive' };
                    return (
                      <tr key={ins.name} className="border-b border-slate-100 hover:bg-slate-50/50">
                        <td className="px-5 py-3 text-sm font-medium text-slate-800">{ins.name}</td>
                        <td className="px-5 py-3 text-sm text-slate-600 text-right">{ins.records_logged.toLocaleString()}</td>
                        <td className="px-5 py-3 text-sm text-slate-600 text-right">{ins.days_active}</td>
                        <td className="px-5 py-3 text-sm text-slate-500 text-right">
                          {ins.last_active === 'N/A' ? '—' : `${formatDate(ins.last_active)}`}
                        </td>
                        <td className="px-5 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${status.bg} ${status.text}`}>
                            {status.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </>
      )}

      {/* Tab: Academics */}
      {tab === 'academics' && (
        <>
          {gradeStats.totalStudents === 0 ? (
            <SectionCard title="No grades recorded" icon={<BookOpen size={18} />}>
              <p className="text-sm text-slate-500">Once teachers enter grades for this academic year, analytics will show here.</p>
            </SectionCard>
          ) : (
            <>
              {/* Grade KPI band */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <KpiCard icon={<Award size={16} />} label="Excellent (90+)" value={gradeStats.excellentCount}
                  sub={`${pct(gradeStats.excellentCount, gradeStats.totalStudents)}%`} accent="border-l-emerald-500" />
                <KpiCard icon={<Sparkles size={16} />} label="Good (85-89)" value={gradeStats.goodCount}
                  sub={`${pct(gradeStats.goodCount, gradeStats.totalStudents)}%`} accent="border-l-blue-500" />
                <KpiCard icon={<CheckCircle size={16} />} label="Satisfactory (75-84)" value={gradeStats.satisfactoryCount}
                  sub={`${pct(gradeStats.satisfactoryCount, gradeStats.totalStudents)}%`} accent="border-l-teal-500" />
                <KpiCard icon={<AlertTriangle size={16} />} label="Needs Help (60-74)" value={gradeStats.needsImprovementCount}
                  sub={`${pct(gradeStats.needsImprovementCount, gradeStats.totalStudents)}%`} accent="border-l-amber-500" />
                <KpiCard icon={<XCircle size={16} />} label="Failing (<60)" value={gradeStats.failingCount}
                  sub={`${pct(gradeStats.failingCount, gradeStats.totalStudents)}%`} accent="border-l-red-500" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <SectionCard
                  title="Grade Distribution"
                  subtitle={`${grades.length.toLocaleString()} grades recorded`}
                  icon={<BarChart3 size={18} className="text-purple-500" />}
                >
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={gradeDistribution}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="range" fontSize={11} stroke="#94a3b8" />
                      <YAxis fontSize={11} stroke="#94a3b8" />
                      <Tooltip
                        contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                        formatter={(value: unknown) => [`${value} grades`, 'Count']}
                      />
                      <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                        {gradeDistribution.map((entry, i) => (
                          <Cell key={i} fill={
                            entry.range === '90-100' ? '#10b981' :
                              entry.range === '85-89' ? '#3b82f6' :
                                entry.range === '75-84' ? '#14b8a6' :
                                  entry.range === '60-74' ? '#f59e0b' :
                                    '#ef4444'
                          } />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </SectionCard>

                <SectionCard
                  title="Quarterly Trend"
                  subtitle="Average grade by quarter"
                  icon={<TrendingUp size={18} className="text-indigo-500" />}
                >
                  {quarterTrend.length === 0 ? (
                    <EmptyState message="No quarterly data" />
                  ) : quarterTrend.length === 1 ? (
                    <div className="py-12 text-center">
                      <p className="text-slate-500 text-sm mb-3">Only {quarterTrend[0].quarter} has grades so far.</p>
                      <p className="text-4xl font-bold text-indigo-600">{quarterTrend[0].average.toFixed(1)}</p>
                      <p className="text-xs text-slate-400 mt-2">{quarterTrend[0].count.toLocaleString()} grades recorded</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={quarterTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="quarter" fontSize={11} stroke="#94a3b8" />
                        <YAxis domain={[60, 100]} fontSize={11} stroke="#94a3b8" />
                        <Tooltip
                          contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                        />
                        <Line type="monotone" dataKey="average" stroke="#6366f1" strokeWidth={3} dot={{ r: 5, fill: '#6366f1' }} name="Avg Grade" />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </SectionCard>
              </div>

              {/* Subject performance */}
              <SectionCard
                title="Subject Performance"
                subtitle="Ranked by average grade"
                icon={<BookOpen size={18} className="text-blue-500" />}
                action={subjectPerformance.length > 0 ? (
                  <button
                    onClick={() => downloadCsv('subject_performance', subjectPerformance, subjectColumns)}
                    className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Download size={12} /> Export
                  </button>
                ) : undefined}
              >
                {subjectPerformance.length === 0 ? (
                  <EmptyState message="No subject grades" />
                ) : (
                  <div className="overflow-x-auto -mx-5 -my-5">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Subject</th>
                          <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Avg Grade</th>
                          <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Pass Rate</th>
                          <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Students</th>
                          <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Grades</th>
                        </tr>
                      </thead>
                      <tbody>
                        {subjectPerformance.map(sub => (
                          <tr key={sub.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                            <td className="px-5 py-3">
                              <p className="text-sm font-medium text-slate-800">{sub.name}</p>
                              <p className="text-xs text-slate-400">{sub.code}</p>
                            </td>
                            <td className="px-5 py-3 text-right">
                              <span className={`inline-flex items-center justify-center min-w-[48px] px-2 py-1 rounded text-xs font-bold ${
                                sub.averageGrade >= 90 ? 'bg-emerald-100 text-emerald-700' :
                                  sub.averageGrade >= 85 ? 'bg-blue-100 text-blue-700' :
                                    sub.averageGrade >= 75 ? 'bg-teal-100 text-teal-700' :
                                      sub.averageGrade >= 60 ? 'bg-amber-100 text-amber-700' :
                                        'bg-red-100 text-red-700'
                              }`}>
                                {sub.averageGrade}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-right">
                              <div className="inline-flex items-center gap-2">
                                <div className="w-16 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                  <div
                                    className="h-1.5 rounded-full"
                                    style={{ width: `${Math.min(100, sub.passRate)}%`, background: rateTone(sub.passRate).fill }}
                                  />
                                </div>
                                <span className="text-xs font-semibold text-slate-700 min-w-[42px] text-right">{sub.passRate}%</span>
                              </div>
                            </td>
                            <td className="px-5 py-3 text-sm text-slate-600 text-right">{sub.studentCount}</td>
                            <td className="px-5 py-3 text-sm text-slate-500 text-right">{sub.totalGrades}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>

              {/* Correlation scatter */}
              {attendanceGradeCorrelation.length > 0 && (
                <SectionCard
                  title="Attendance vs Academic Performance"
                  subtitle={`${attendanceGradeCorrelation.length} students plotted — upper right is ideal`}
                  icon={<BarChart3 size={18} className="text-sky-500" />}
                >
                  <ResponsiveContainer width="100%" height={300}>
                    <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis type="number" dataKey="attendance" name="Attendance %" unit="%" fontSize={11} stroke="#94a3b8" domain={[0, 100]} />
                      <YAxis type="number" dataKey="averageGrade" name="Average Grade" fontSize={11} stroke="#94a3b8" domain={[50, 100]} />
                      <Tooltip
                        cursor={{ strokeDasharray: '3 3' }}
                        contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                        formatter={(value) => typeof value === 'number' ? value.toFixed(1) : value}
                      />
                      <Scatter name="Students" data={attendanceGradeCorrelation} fill="#0ea5e9" fillOpacity={0.65} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </SectionCard>
              )}
            </>
          )}
        </>
      )}

      {/* Tab: At-Risk */}
      {tab === 'at-risk' && (
        <SectionCard
          title="At-Risk Students"
          subtitle={`${atRiskStudents.length} flagged · weighted risk score across attendance and grades`}
          icon={<AlertTriangle size={18} className="text-rose-500" />}
          action={atRiskStudents.length > 0 ? (
            <div className="flex gap-2">
              <button
                onClick={() => downloadCsv('at_risk_students', atRiskStudents, atRiskColumns)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Download size={12} /> CSV
              </button>
              <button
                onClick={() => downloadExcel('at_risk_students', 'At-Risk', atRiskStudents, atRiskColumns)}
                className="bg-sky-600 hover:bg-sky-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <FileSpreadsheet size={12} /> Excel
              </button>
            </div>
          ) : undefined}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 flex-1 max-w-md">
              <Search size={14} className="text-slate-400" />
              <input
                type="text"
                value={riskSearch}
                onChange={e => setRiskSearch(e.target.value)}
                placeholder="Search by name, LRN, or section..."
                className="bg-transparent outline-none text-sm flex-1"
              />
            </div>
            <div className="hidden sm:flex items-center gap-3 text-xs text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500" /> Critical ≥ 40
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500" /> At-Risk 20-39
              </span>
            </div>
          </div>

          {visibleAtRisk.length === 0 ? (
            <EmptyState message={riskSearch ? 'No students match your search' : 'No at-risk students — great job!'} />
          ) : (
            <div className="overflow-x-auto -mx-5 -mb-5">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Student</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Section</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Absences</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Lates</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Max Streak</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Absence %</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Trend</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Risk</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleAtRisk.map(stu => (
                    <tr key={stu.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                      <td className="px-5 py-3">
                        <p className="text-sm font-medium text-slate-800">{stu.name}</p>
                        <p className="text-xs text-slate-400">{stu.lrn}</p>
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-600">{stu.section}</td>
                      <td className="px-5 py-3 text-sm text-slate-600 text-right">{stu.absences}/{stu.total}</td>
                      <td className="px-5 py-3 text-sm text-slate-600 text-right">{stu.lates}</td>
                      <td className="px-5 py-3 text-sm text-slate-600 text-right">
                        {stu.maxConsecutive > 0 ? (
                          <span className={`font-semibold ${stu.maxConsecutive >= 3 ? 'text-red-600' : 'text-slate-600'}`}>
                            {stu.maxConsecutive}
                          </span>
                        ) : '0'}
                      </td>
                      <td className="px-5 py-3 text-sm font-semibold text-right">{stu.rate.toFixed(1)}%</td>
                      <td className="px-5 py-3 text-center">
                        {stu.trendWorsening ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600">
                            <TrendingDown size={12} /> Worsening
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">Stable</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <div className="w-14 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="h-1.5 rounded-full"
                              style={{
                                width: `${Math.min(100, stu.risk_score)}%`,
                                background: stu.risk_score >= 40 ? '#ef4444' : '#f59e0b',
                              }}
                            />
                          </div>
                          <span className={`text-xs font-bold w-6 text-right ${
                            stu.risk_score >= 40 ? 'text-red-600' : 'text-amber-700'
                          }`}>
                            {stu.risk_score}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                          stu.status === 'critical' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {stu.status === 'critical' ? <XCircle size={10} /> : <AlertCircle size={10} />}
                          {stu.status === 'critical' ? 'Critical' : 'At-Risk'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}

function PieIcon() {
  return (
    <div className="relative">
      <div className="w-[18px] h-[18px] rounded-full bg-gradient-to-tr from-emerald-500 via-amber-500 to-red-500" />
    </div>
  );
}
