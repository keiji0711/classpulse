import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear } from '../../contexts/AcademicYearContext';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import { useCachedState, hasCached } from '../../lib/pageCache';
import { mapEnrollmentRoster } from '../../lib/academicYearRoster';
import type { Student, Section } from '../../types';
import { TrendingDown, Filter, Search } from 'lucide-react';

interface StudentRisk {
  id: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  lrn: string;
  section_name: string;
  grade_level: string;
  total_absences: number;
  total_records: number;
  absence_rate: number;
  status: 'critical' | 'at-risk' | 'good';
}

export default function StudentAnalyticsPage() {
  const { user } = useAuth();
  const { activeYear } = useAcademicYear();
  const [students, setStudents] = useCachedState<StudentRisk[]>('inst-student-analytics', []);
  const [loading, setLoading] = useState(!hasCached('inst-student-analytics'));
  const [filterStatus, setFilterStatus] = useState<'all' | 'critical' | 'at-risk' | 'good'>('all');
  const [filterSection, setFilterSection] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!user?.id) return;
    fetchStudents();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeYear?.id]);

  useRealtimeRefresh(['students', 'attendance_records'], fetchStudents);

  async function fetchStudents() {
    const instructorId = user!.id;
    const yearId = activeYear?.id;

    // Get all sections this instructor teaches
    const { data: schedules } = await supabase
      .from('schedules')
      .select('section_id')
      .eq('instructor_id', instructorId)
      .eq('academic_year_id', yearId ?? '00000000-0000-0000-0000-000000000000');

    const sectionIds = [...new Set((schedules ?? []).map(s => s.section_id))];
    if (sectionIds.length === 0) {
      setStudents([]);
      setLoading(false);
      return;
    }

    // Get students in those sections
    const { data: enrollmentRows } = await supabase
      .from('student_enrollments')
      .select('student_id, section_id, student:students!inner(*), section:sections!inner(*)')
      .eq('school_id', user!.school_id!)
      .eq('academic_year_id', yearId ?? '00000000-0000-0000-0000-000000000000')
      .in('section_id', sectionIds)
      .order('last_name', { foreignTable: 'student' });
    const studentsData = mapEnrollmentRoster((enrollmentRows ?? []) as any) as (Student & { section: Section })[];

    // Get instructor's attendance records  
    const { data: attendanceRecords } = await supabase
      .from('attendance_records')
      .select('student_id, status, date, schedule:schedules!inner(instructor_id, academic_year_id)')
      .eq('schedule.instructor_id', instructorId)
      .eq('schedule.academic_year_id', yearId ?? '00000000-0000-0000-0000-000000000000');

    // Deduplicate per student per day — best status wins
    // If present in ANY of the instructor's subjects that day, count as present
    const statusPriority: Record<string, number> = { present: 3, late: 2, excused: 1, absent: 0 };
    const dailyAttendanceMap = new Map<string, Map<string, string>>();
    for (const r of (attendanceRecords ?? [])) {
      if (!dailyAttendanceMap.has(r.student_id)) dailyAttendanceMap.set(r.student_id, new Map());
      const dayMap = dailyAttendanceMap.get(r.student_id)!;
      const existing = dayMap.get(r.date);
      if (!existing || (statusPriority[r.status] ?? 0) > (statusPriority[existing] ?? 0)) {
        dayMap.set(r.date, r.status);
      }
    }

    // Build analytics per student
    const result: StudentRisk[] = studentsData.map(student => {
      const dayMap = dailyAttendanceMap.get(student.id);
      const dailyStatuses = dayMap ? [...dayMap.values()] : [];
      const total = dailyStatuses.length;
      const absences = dailyStatuses.filter(s => s === 'absent').length;
      const absenceRate = total > 0 ? (absences / total) * 100 : 0;

      // Determine status
      let status: 'critical' | 'at-risk' | 'good' = 'good';
      if (absenceRate >= 20) {
        status = 'critical';
      } else if (absenceRate >= 10) {
        status = 'at-risk';
      }

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
        total_absences: absences,
        absence_rate: absenceRate,
        status,
      };
    });

    // Sort: critical first
    result.sort((a, b) => {
      const order = { critical: 0, 'at-risk': 1, good: 2 };
      return order[a.status] - order[b.status];
    });

    setStudents(result);
    setLoading(false);
  }

  const sections = useMemo(() => {
    const set = new Map<string, { grade_level: string; section_name: string }>();
    for (const s of students) {
      const key = `${s.grade_level} - ${s.section_name}`;
      if (!set.has(key)) set.set(key, { grade_level: s.grade_level, section_name: s.section_name });
    }
    return [...set.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [students]);

  const filtered = useMemo(() => {
    let list = students;
    if (filterStatus !== 'all') list = list.filter(s => s.status === filterStatus);
    if (filterSection !== 'all') list = list.filter(s => `${s.grade_level} - ${s.section_name}` === filterSection);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(s =>
        s.last_name.toLowerCase().includes(q) ||
        s.first_name.toLowerCase().includes(q) ||
        s.lrn.toLowerCase().includes(q)
      );
    }
    return list;
  }, [students, filterStatus, filterSection, searchQuery]);

  const counts = useMemo(() => ({
    critical: students.filter(s => s.status === 'critical').length,
    atRisk: students.filter(s => s.status === 'at-risk').length,
    good: students.filter(s => s.status === 'good').length,
  }), [students]);

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Student Attendance Overview</h2>
        <p className="text-sm text-slate-500 mt-1">Monitor your students' attendance and identify those who are falling behind.</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-red-50 border border-red-200 rounded-xl p-5">
          <p className="text-2xl font-bold text-red-700">{counts.critical}</p>
          <p className="text-sm text-red-600 mt-1">Critical</p>
          <p className="text-xs text-red-400 mt-0.5">≥20% absence rate</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <p className="text-2xl font-bold text-amber-700">{counts.atRisk}</p>
          <p className="text-sm text-amber-600 mt-1">At-Risk</p>
          <p className="text-xs text-amber-400 mt-0.5">≥10% absence rate</p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-xl p-5">
          <p className="text-2xl font-bold text-green-700">{counts.good}</p>
          <p className="text-sm text-green-600 mt-1">Good Standing</p>
          <p className="text-xs text-green-400 mt-0.5">Normal attendance</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-4">
        <Filter size={16} className="text-slate-400" />
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

      {/* Students Table */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <TrendingDown size={40} className="text-slate-300 mx-auto mb-2" />
          <p className="text-slate-500 font-medium">No students found</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Student</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Section</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Absences</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Absence Rate</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((student, idx) => (
                <tr key={student.id} className={`border-b border-slate-100 hover:bg-slate-50/50 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-slate-800">{student.last_name}, {student.first_name}{student.middle_name ? ` ${student.middle_name.charAt(0)}.` : ''}</div>
                    <div className="text-xs text-slate-400">{student.lrn}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{student.grade_level} - {student.section_name}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-sm font-semibold ${student.total_absences > 0 ? 'text-red-600' : 'text-slate-400'}`}>{student.total_absences}</span>
                    <span className="text-xs text-slate-400"> / {student.total_records}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-sm font-semibold ${student.absence_rate >= 20 ? 'text-red-600' : student.absence_rate >= 10 ? 'text-amber-600' : 'text-green-600'}`}>
                      {student.absence_rate.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                      student.status === 'critical' ? 'bg-red-100 text-red-700' :
                      student.status === 'at-risk' ? 'bg-amber-100 text-amber-700' :
                      'bg-green-100 text-green-700'
                    }`}>
                      {student.status === 'at-risk' ? 'At-Risk' : student.status.charAt(0).toUpperCase() + student.status.slice(1)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
