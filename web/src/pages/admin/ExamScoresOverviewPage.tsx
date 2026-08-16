import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear } from '../../contexts/AcademicYearContext';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import { useCachedState, hasCached } from '../../lib/pageCache';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { ClipboardList, Download, FileSpreadsheet, Filter, Search } from 'lucide-react';
import { downloadCsv, downloadExcel, type ExportColumn } from '../../lib/export';
import PaginationControls from '../../components/PaginationControls';
import type { ExamPeriod } from '../../types';

const EXAM_PERIODS: { key: ExamPeriod | 'all'; label: string }[] = [
  { key: 'all', label: 'All Periods' },
  { key: '1st_quarter', label: '1st Quarter' },
  { key: '2nd_quarter', label: '2nd Quarter' },
  { key: '3rd_quarter', label: '3rd Quarter' },
];

const PERIOD_LABEL: Record<string, string> = {
  '1st_quarter': '1st Qtr',
  '2nd_quarter': '2nd Qtr',
  '3rd_quarter': '3rd Qtr',
};

interface ScoreRow {
  student_id: string;
  section_id: string;
  student_name: string;
  lrn: string;
  section_name: string;
  grade_level: string;
  subject_name: string;
  subject_code: string;
  exam_period: string;
  score: number;
  total_items: number;
  percentage: number;
}

interface MpsSummary {
  subject_name: string;
  subject_code: string;
  section_name: string;
  grade_level: string;
  exam_period: string;
  total_students: number;
  total_score_sum: number;
  total_items: number;
  mps: number;
}

export default function ExamScoresOverviewPage() {
  const { user } = useAuth();
  const { activeYear } = useAcademicYear();
  const [scores, setScores] = useCachedState<ScoreRow[]>('admin-exam-scores', []);
  const [loading, setLoading] = useState(!hasCached('admin-exam-scores'));
  const [refreshing, setRefreshing] = useState(false);
  const [sections, setSections] = useCachedState<{ id: string; name: string; grade_level: string }[]>('admin-exam-sections', []);
  const [subjects, setSubjects] = useCachedState<{ id: string; name: string }[]>('admin-exam-subjects', []);
  const [filterSection, setFilterSection] = useState('all');
  const [filterSubject, setFilterSubject] = useState('all');
  const [filterPeriod, setFilterPeriod] = useState<ExamPeriod | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [viewMode, setViewMode] = useState<'scores' | 'mps'>('mps');
  const debouncedSearch = useDebouncedValue(searchQuery, 300);

  useEffect(() => { setPage(1); }, [filterSection, filterSubject, filterPeriod, searchQuery, activeYear?.id]);

  useEffect(() => {
    if (user?.school_id) void fetchData();
  }, [user?.school_id, activeYear?.id, debouncedSearch]);

  useRealtimeRefresh(['exam_scores', 'sections', 'subjects'], fetchData, { column: 'school_id', value: user?.school_id });

  async function fetchData() {
    const schoolId = user?.school_id;
    if (!schoolId) return;

    if (!loading) setRefreshing(true);

    try {
      const [sectionsRes, subjectsRes] = await Promise.all([
        supabase.from('sections').select('id, name, grade_level').eq('school_id', schoolId).order('grade_level').order('name'),
        supabase.from('subjects').select('id, name').eq('school_id', schoolId).order('name'),
      ]);
      setSections(sectionsRes.data ?? []);
      setSubjects(subjectsRes.data ?? []);

      let query = supabase
        .from('exam_scores')
        .select('*, student:students(first_name, middle_name, last_name, lrn), subject:subjects(name, code)')
        .eq('school_id', schoolId)
        .in('exam_period', ['1st_quarter', '2nd_quarter', '3rd_quarter']);

      if (activeYear?.id) query = query.eq('academic_year_id', activeYear.id);

      const { data: rawScores } = await query.order('created_at', { ascending: false });

      const studentIds = [...new Set((rawScores ?? []).map((score: any) => score.student_id))];
      const { data: enrollmentRows } = activeYear?.id && studentIds.length > 0
        ? await supabase
            .from('student_enrollments')
            .select('student_id, section_id, section:sections!inner(name, grade_level)')
            .eq('school_id', schoolId)
            .eq('academic_year_id', activeYear.id)
            .in('student_id', studentIds)
        : { data: [] };
      const enrollmentByStudent = new Map<string, { id: string; name: string; grade_level: string }>();
      for (const enrollment of (enrollmentRows ?? []) as any[]) {
        const section = Array.isArray(enrollment.section) ? enrollment.section[0] : enrollment.section;
        if (section) enrollmentByStudent.set(enrollment.student_id, { id: enrollment.section_id, ...section });
      }

      const rows: ScoreRow[] = (rawScores ?? []).map((s: any) => {
        const student = s.student;
        const subject = s.subject;
        const sectionInfo = enrollmentByStudent.get(s.student_id);
        return {
          student_id: s.student_id,
          section_id: sectionInfo?.id ?? '',
          student_name: student ? `${student.last_name}, ${student.first_name}${student.middle_name ? ` ${student.middle_name.charAt(0)}.` : ''}` : '—',
          lrn: student?.lrn ?? '',
          section_name: sectionInfo?.name ?? '',
          grade_level: sectionInfo?.grade_level ?? '',
          subject_name: subject?.name ?? '',
          subject_code: subject?.code ?? '',
          exam_period: s.exam_period,
          score: s.score,
          total_items: s.total_items,
          percentage: s.total_items > 0 ? (s.score / s.total_items) * 100 : 0,
        };
      });

      setScores(rows);
    } catch {
      // keep existing data on error
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // Apply client-side filters
  const filtered = useMemo(() => {
    let result = scores;
    if (filterSection !== 'all') {
      result = result.filter(r => r.section_id === filterSection);
    }
    if (filterSubject !== 'all') {
      const subName = subjects.find(s => s.id === filterSubject);
      if (subName) result = result.filter(r => r.subject_name === subName.name);
    }
    if (filterPeriod !== 'all') {
      result = result.filter(r => r.exam_period === filterPeriod);
    }
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter(r =>
        r.student_name.toLowerCase().includes(q) ||
        r.lrn.toLowerCase().includes(q) ||
        r.subject_name.toLowerCase().includes(q)
      );
    }
    return result;
  }, [scores, filterSection, filterSubject, filterPeriod, debouncedSearch, sections, subjects]);

  // MPS summaries grouped by subject + section + period
  const mpsSummaries = useMemo((): MpsSummary[] => {
    const map = new Map<string, MpsSummary>();
    for (const row of filtered) {
      const key = `${row.subject_name}__${row.section_name}__${row.exam_period}`;
      if (!map.has(key)) {
        map.set(key, {
          subject_name: row.subject_name,
          subject_code: row.subject_code,
          section_name: row.section_name,
          grade_level: row.grade_level,
          exam_period: row.exam_period,
          total_students: 0,
          total_score_sum: 0,
          total_items: row.total_items,
          mps: 0,
        });
      }
      const entry = map.get(key)!;
      entry.total_students++;
      entry.total_score_sum += row.score;
      entry.total_items = row.total_items; // all same for same exam
    }
    for (const entry of map.values()) {
      if (entry.total_students > 0 && entry.total_items > 0) {
        entry.mps = (entry.total_score_sum / (entry.total_students * entry.total_items)) * 100;
      }
    }
    return [...map.values()].sort((a, b) =>
      a.subject_name.localeCompare(b.subject_name) ||
      a.section_name.localeCompare(b.section_name) ||
      a.exam_period.localeCompare(b.exam_period)
    );
  }, [filtered]);

  // Paging for scores
  const pagedScores = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  // Paging for MPS
  const pagedMps = useMemo(() => {
    const start = (page - 1) * pageSize;
    return mpsSummaries.slice(start, start + pageSize);
  }, [mpsSummaries, page, pageSize]);

  const scoreExportColumns: ExportColumn<ScoreRow>[] = [
    { header: 'Student Name', value: (r) => r.student_name },
    { header: 'LRN', value: (r) => r.lrn },
    { header: 'Grade Level', value: (r) => r.grade_level },
    { header: 'Section', value: (r) => r.section_name },
    { header: 'Subject', value: (r) => r.subject_name },
    { header: 'Exam Period', value: (r) => PERIOD_LABEL[r.exam_period] ?? r.exam_period },
    { header: 'Score', value: (r) => r.score },
    { header: 'Total Items', value: (r) => r.total_items },
    { header: 'Percentage', value: (r) => r.percentage.toFixed(1) + '%' },
  ];

  const mpsExportColumns: ExportColumn<MpsSummary>[] = [
    { header: 'Subject', value: (r) => r.subject_name },
    { header: 'Code', value: (r) => r.subject_code },
    { header: 'Grade Level', value: (r) => r.grade_level },
    { header: 'Section', value: (r) => r.section_name },
    { header: 'Exam Period', value: (r) => PERIOD_LABEL[r.exam_period] ?? r.exam_period },
    { header: 'Students', value: (r) => r.total_students },
    { header: 'Total Items', value: (r) => r.total_items },
    { header: 'MPS (%)', value: (r) => r.mps.toFixed(2) },
  ];

  function exportCsv() {
    if (viewMode === 'mps') downloadCsv('mps_overview', mpsSummaries, mpsExportColumns);
    else downloadCsv('exam_scores', filtered, scoreExportColumns);
  }

  function exportExcel() {
    if (viewMode === 'mps') downloadExcel('mps_overview', 'MPS Overview', mpsSummaries, mpsExportColumns);
    else downloadExcel('exam_scores', 'Exam Scores', filtered, scoreExportColumns);
  }

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Exam Scores & MPS</h2>
          <p className="text-sm text-slate-500 mt-1">View student exam scores and Mean Percentage Scores by subject and section.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={exportCsv} disabled={(viewMode === 'mps' ? mpsSummaries : filtered).length === 0} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer">
            <Download size={16} /> CSV
          </button>
          <button onClick={exportExcel} disabled={(viewMode === 'mps' ? mpsSummaries : filtered).length === 0} className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer">
            <FileSpreadsheet size={16} /> Excel
          </button>
        </div>
      </div>

      {/* View mode toggle + Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-4">
        <div className="flex rounded-lg border border-slate-300 overflow-hidden">
          <button onClick={() => { setViewMode('mps'); setPage(1); }} className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${viewMode === 'mps' ? 'bg-primary text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
            <ClipboardList size={14} className="inline mr-1.5 -mt-0.5" />MPS Summary
          </button>
          <button onClick={() => { setViewMode('scores'); setPage(1); }} className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${viewMode === 'scores' ? 'bg-primary text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
            Individual Scores
          </button>
        </div>
        <Filter size={16} className="text-slate-400" />
        <select value={filterSection} onChange={e => setFilterSection(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary outline-none">
          <option value="all">All Sections</option>
          {sections.map(s => <option key={s.id} value={s.id}>{s.grade_level} - {s.name}</option>)}
        </select>
        <select value={filterSubject} onChange={e => setFilterSubject(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary outline-none">
          <option value="all">All Subjects</option>
          {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={filterPeriod} onChange={e => setFilterPeriod(e.target.value as any)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary outline-none">
          {EXAM_PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <div className="flex-1" />
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Search student, LRN, subject..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary outline-none w-60" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
        <span>{refreshing ? 'Refreshing...' : viewMode === 'mps' ? `${mpsSummaries.length} subject-section group(s)` : `${filtered.length} score record(s)`}</span>
      </div>

      {/* MPS Summary View */}
      {viewMode === 'mps' && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Subject</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Section</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Period</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Students</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Total Items</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase text-center">MPS (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedMps.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-slate-800">{row.subject_name}</div>
                      <div className="text-xs text-slate-400">{row.subject_code}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">{row.grade_level} - {row.section_name}</td>
                    <td className="px-6 py-4 text-sm text-slate-600">{PERIOD_LABEL[row.exam_period] ?? row.exam_period}</td>
                    <td className="px-6 py-4 text-sm text-slate-600 text-center">{row.total_students}</td>
                    <td className="px-6 py-4 text-sm text-slate-600 text-center">{row.total_items}</td>
                    <td className="px-6 py-4 text-center">
                      <span className={`px-3 py-1 rounded-full text-sm font-bold ${row.mps >= 75 ? 'bg-green-100 text-green-700' : row.mps >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                        {row.mps.toFixed(2)}%
                      </span>
                    </td>
                  </tr>
                ))}
                {pagedMps.length === 0 && <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-400">No exam scores recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <PaginationControls page={page} pageSize={pageSize} totalItems={mpsSummaries.length} itemLabel="groups" onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} />
        </div>
      )}

      {/* Individual Scores View */}
      {viewMode === 'scores' && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Student</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Section</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Subject</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Period</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Score</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Total</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase text-center">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedScores.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-slate-800">{row.student_name}</div>
                      <div className="text-xs text-slate-400">{row.lrn}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">{row.grade_level} - {row.section_name}</td>
                    <td className="px-6 py-4 text-sm text-slate-600">{row.subject_name}</td>
                    <td className="px-6 py-4 text-sm text-slate-600">{PERIOD_LABEL[row.exam_period] ?? row.exam_period}</td>
                    <td className="px-6 py-4 text-sm text-slate-800 text-center font-medium">{row.score}</td>
                    <td className="px-6 py-4 text-sm text-slate-600 text-center">{row.total_items}</td>
                    <td className="px-6 py-4 text-center">
                      <span className={`text-sm font-semibold ${row.percentage >= 75 ? 'text-green-600' : row.percentage >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                        {row.percentage.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
                {pagedScores.length === 0 && <tr><td colSpan={7} className="px-6 py-8 text-center text-slate-400">No exam scores found.</td></tr>}
              </tbody>
            </table>
          </div>
          <PaginationControls page={page} pageSize={pageSize} totalItems={filtered.length} itemLabel="scores" onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} />
        </div>
      )}
    </div>
  );
}
