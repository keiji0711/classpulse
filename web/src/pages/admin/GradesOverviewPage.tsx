import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear } from '../../contexts/AcademicYearContext';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import { useCachedState, hasCached } from '../../lib/pageCache';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { BookOpen, Download, FileSpreadsheet, Filter, Search } from 'lucide-react';
import { downloadCsv, downloadExcel, type ExportColumn } from '../../lib/export';
import PaginationControls from '../../components/PaginationControls';

interface GradeRow {
  student_id: string;
  student_name: string;
  lrn: string;
  section_name: string;
  grade_level: string;
  subject_name: string;
  subject_code: string;
  q1: number | null;
  q2: number | null;
  q3: number | null;
  average: number | null;
}

interface GradeStudentPage {
  id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  lrn: string;
  section_id: string;
  section?: { name: string; grade_level: string } | null;
}

function buildSearchTerm(rawValue: string) {
  return rawValue.trim().replace(/[%,]/g, '').replace(/\s+/g, ' ');
}

export default function GradesOverviewPage() {
  const { user } = useAuth();
  const { activeYear } = useAcademicYear();
  const [rows, setRows] = useCachedState<GradeRow[]>('admin-grades', []);
  const [loading, setLoading] = useState(!hasCached('admin-grades'));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [sections, setSections] = useCachedState<{ id: string; name: string; grade_level: string }[]>('admin-grades-sections', []);
  const [subjects, setSubjects] = useCachedState<{ id: string; name: string }[]>('admin-grades-subjects', []);
  const [totalStudents, setTotalStudents] = useCachedState<number>('admin-grades-total', 0);
  const [filterSection, setFilterSection] = useState('all');
  const [filterSubject, setFilterSubject] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);

  useEffect(() => {
    setPage(1);
  }, [filterSection, filterSubject, searchQuery, activeYear?.id]);

  useEffect(() => {
    if (!user?.school_id) return;
    void fetchData();
  }, [user?.school_id, activeYear?.id, filterSection, filterSubject, debouncedSearchQuery, page, pageSize]);

  useRealtimeRefresh(['grades', 'sections', 'subjects'], fetchData, { column: 'school_id', value: user?.school_id });

  async function fetchData() {
    const schoolId = user?.school_id;
    if (!schoolId) return;

    const yearId = activeYear?.id;
    const start = (page - 1) * pageSize;
    const end = start + pageSize - 1;
    const searchValue = buildSearchTerm(debouncedSearchQuery);
    const searchPattern = `%${searchValue}%`;

    if (!loading) setRefreshing(true);
    setError('');

    try {
      let studentsQuery = supabase
        .from('student_enrollments')
        .select('student_id, section_id, student:students!inner(id, first_name, middle_name, last_name, lrn), section:sections!inner(name, grade_level)', { count: 'exact' })
        .eq('school_id', schoolId)
        .eq('academic_year_id', yearId ?? '00000000-0000-0000-0000-000000000000');

      if (filterSection !== 'all') studentsQuery = studentsQuery.eq('section_id', filterSection);

      if (searchValue) {
        studentsQuery = studentsQuery.or([
          `first_name.ilike.${searchPattern}`,
          `middle_name.ilike.${searchPattern}`,
          `last_name.ilike.${searchPattern}`,
          `lrn.ilike.${searchPattern}`,
        ].join(','), { foreignTable: 'student' });
      }

      const [studentsRes, sectionsRes, subjectsRes] = await Promise.all([
        studentsQuery
          .order('last_name', { foreignTable: 'student' })
          .order('first_name', { foreignTable: 'student' })
          .range(start, end),
        supabase.from('sections').select('id, name, grade_level').eq('school_id', schoolId).order('grade_level').order('name'),
        supabase.from('subjects').select('id, name').eq('school_id', schoolId).order('name'),
      ]);

      if (studentsRes.error) throw studentsRes.error;
      if (sectionsRes.error) throw sectionsRes.error;
      if (subjectsRes.error) throw subjectsRes.error;

      setSections(sectionsRes.data ?? []);
      setSubjects(subjectsRes.data ?? []);

      const studentPage = ((studentsRes.data ?? []) as any[]).flatMap((enrollment) => {
        const student = Array.isArray(enrollment.student) ? enrollment.student[0] : enrollment.student;
        const section = Array.isArray(enrollment.section) ? enrollment.section[0] : enrollment.section;
        if (!student || !section) return [];
        return [{ ...student, section_id: enrollment.section_id, section } as GradeStudentPage];
      });
      setTotalStudents(studentsRes.count ?? studentPage.length);

      if (studentPage.length === 0) {
        setRows([]);
        return;
      }

      const studentLookup = new Map(studentPage.map((student) => [student.id, student]));
      let gradesQuery = supabase
        .from('grades')
        .select('student_id, subject_id, quarter, grade, subject:subjects(name, code)')
        .eq('school_id', schoolId)
        .lte('quarter', 3)
        .in('student_id', studentPage.map((student) => student.id));

      if (yearId) gradesQuery = gradesQuery.eq('academic_year_id', yearId);
      if (filterSubject !== 'all') gradesQuery = gradesQuery.eq('subject_id', filterSubject);

      const { data: gradesData, error: gradesError } = await gradesQuery
        .order('student_id')
        .order('subject_id')
        .order('quarter');

      if (gradesError) throw gradesError;

      const key = (studentId: string, subjectId: string) => `${studentId}__${subjectId}`;
      const map = new Map<string, GradeRow>();

      for (const grade of (gradesData ?? []) as any[]) {
        const student = studentLookup.get(grade.student_id);
        const subject = grade.subject as { name: string; code: string } | null;
        if (!student || !subject) continue;

        const rowKey = key(grade.student_id, grade.subject_id);
        if (!map.has(rowKey)) {
          map.set(rowKey, {
            student_id: grade.student_id,
            student_name: `${student.last_name}, ${student.first_name}${student.middle_name ? ` ${student.middle_name.charAt(0)}.` : ''}`,
            lrn: student.lrn,
            section_name: student.section?.name ?? '',
            grade_level: student.section?.grade_level ?? '',
            subject_name: subject.name,
            subject_code: subject.code,
            q1: null,
            q2: null,
            q3: null,
            average: null,
          });
        }

        const row = map.get(rowKey)!;
        if (grade.quarter === 1) row.q1 = grade.grade;
        else if (grade.quarter === 2) row.q2 = grade.grade;
        else if (grade.quarter === 3) row.q3 = grade.grade;
      }

      for (const row of map.values()) {
        const values = [row.q1, row.q2, row.q3].filter((value): value is number => value !== null);
        if (values.length > 0) row.average = values.reduce((sum, value) => sum + value, 0) / values.length;
      }

      setRows([...map.values()].sort((a, b) => a.student_name.localeCompare(b.student_name) || a.subject_name.localeCompare(b.subject_name)));
    } catch (loadError: any) {
      console.error('Failed to load grades overview', loadError);
      setError(loadError?.message ?? 'Unable to load grade summaries right now.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const exportColumns: ExportColumn<GradeRow>[] = [
    { header: 'Student Name', value: (row) => row.student_name },
    { header: 'LRN', value: (row) => row.lrn },
    { header: 'Grade Level', value: (row) => row.grade_level },
    { header: 'Section', value: (row) => row.section_name },
    { header: 'Subject', value: (row) => row.subject_name },
    { header: 'Subject Code', value: (row) => row.subject_code },
    { header: 'Q1', value: (row) => row.q1 ?? '' },
    { header: 'Q2', value: (row) => row.q2 ?? '' },
    { header: 'Q3', value: (row) => row.q3 ?? '' },
    { header: 'Average', value: (row) => (row.average !== null ? row.average.toFixed(1) : '') },
  ];

  function exportCsv() {
    downloadCsv('grades_overview', rows, exportColumns);
  }

  function exportExcel() {
    downloadExcel('grades_overview', 'Grades Overview', rows, exportColumns);
  }

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Grades Overview</h2>
          <p className="text-sm text-slate-500 mt-1">View student grades across subjects and quarters with lighter, paged loading.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={exportCsv} disabled={rows.length === 0} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer">
            <Download size={16} /> Export CSV
          </button>
          <button onClick={exportExcel} disabled={rows.length === 0} className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer">
            <FileSpreadsheet size={16} /> Export Excel
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-4">
        <Filter size={16} className="text-slate-400" />
        <select value={filterSection} onChange={e => setFilterSection(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary outline-none">
          <option value="all">All Sections</option>
          {sections.map(s => <option key={s.id} value={s.id}>{s.grade_level} - {s.name}</option>)}
        </select>
        <select value={filterSubject} onChange={e => setFilterSubject(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary outline-none">
          <option value="all">All Subjects</option>
          {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="flex-1" />
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Search by student name or LRN" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary outline-none w-60" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
        <span>{refreshing ? 'Refreshing results…' : 'Server-side learner pagination active'}</span>
        <span>{totalStudents} matching learner(s)</span>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <BookOpen size={40} className="text-slate-300 mx-auto mb-2" />
          <p className="text-slate-500 font-medium">No grades recorded yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto max-h-[70vh]">
            <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Student</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Section</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Subject</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase w-20">Q1</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase w-20">Q2</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase w-20">Q3</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase w-24">Average</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={`${row.student_id}-${row.subject_name}`} className={`border-b border-slate-100 hover:bg-slate-50/50 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-slate-800">{row.student_name}</div>
                    <div className="text-xs text-slate-400">{row.lrn}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{row.grade_level} - {row.section_name}</td>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-slate-700">{row.subject_name}</div>
                    <div className="text-xs text-slate-400">{row.subject_code}</div>
                  </td>
                  {[row.q1, row.q2, row.q3].map((val, i) => (
                    <td key={i} className="px-4 py-3 text-center">
                      {val !== null ? (
                        <span className={`text-sm font-semibold ${val >= 75 ? 'text-green-600' : 'text-red-600'}`}>{val}</span>
                      ) : (
                        <span className="text-sm text-slate-300">—</span>
                      )}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-center">
                    {row.average !== null ? (
                      <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${row.average >= 75 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {row.average.toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-sm text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <PaginationControls
            page={page}
            pageSize={pageSize}
            totalItems={totalStudents}
            itemLabel="students"
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </div>
      )}
    </div>
  );
}
