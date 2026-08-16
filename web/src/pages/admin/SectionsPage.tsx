import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { SCHOOL_GRADE_LEVELS } from '../../lib/gradeLevels';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useAcademicYear } from '../../contexts/AcademicYearContext';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import { useCachedState, hasCached } from '../../lib/pageCache';
import type { Section, Subject, Strand, AppUser } from '../../types';

type InstructorDropdown = { id: string; full_name: string };
type SectionRow = Section & {
  section_subjects?: { subject: Subject }[];
  strand?: Strand;
  adviser?: AppUser | null;
};
import {
  AlertTriangle, BookOpen, CheckCircle2, Download, FileSpreadsheet,
  Filter, GraduationCap, Layers3, Pencil, Plus, Search, Trash2,
  UserCheck, UserX, X,
} from 'lucide-react';
import { downloadCsv, downloadExcel, type ExportColumn } from '../../lib/export';

const GRADE_LEVELS: string[] = [...SCHOOL_GRADE_LEVELS];
type SetupFilter = 'all' | 'ready' | 'missing-adviser' | 'missing-subjects';

export default function SectionsPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { activeYear } = useAcademicYear();
  const [sections, setSections] = useCachedState<SectionRow[]>('admin-sections', []);
  const [allSubjects, setAllSubjects] = useCachedState<Subject[]>('admin-sections-subjects', []);
  const [strands, setStrands] = useCachedState<Strand[]>('admin-sections-strands', []);
  const [instructors, setInstructors] = useState<InstructorDropdown[]>([]);
  const [loading, setLoading] = useState(!hasCached('admin-sections'));
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Section | null>(null);
  const [form, setForm] = useState({ name: '', grade_level: GRADE_LEVELS[0], strand_id: '', adviser_id: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [gradeFilter, setGradeFilter] = useState('all');
  const [setupFilter, setSetupFilter] = useState<SetupFilter>('all');

  // Subject assignment modal
  const [showSubjectsModal, setShowSubjectsModal] = useState(false);
  const [selectedSection, setSelectedSection] = useState<Section | null>(null);
  const [assignedSubjectIds, setAssignedSubjectIds] = useState<Set<string>>(new Set());
  const [savingSubjects, setSavingSubjects] = useState(false);
  const [clearingSection, setClearingSection] = useState<string | null>(null);

  async function fetchInstructors() {
    const schoolId = user!.school_id!;
    const { data, error: instructorsError } = await supabase.from('users').select('id, full_name').eq('school_id', schoolId).eq('role', 'instructor').order('full_name');
    if (instructorsError) { setError(instructorsError.message); return; }
    setInstructors((data ?? []).map((instructor) => ({ id: instructor.id, full_name: instructor.full_name })));
  }

  async function fetchData() {
    const schoolId = user!.school_id!;
    setError('');
    const [sectionsRes, subjectsRes, strandsRes] = await Promise.all([
      supabase.from('sections').select('*, section_subjects(subject:subjects(*)), strand:strands(*), adviser:users(id, full_name)').eq('school_id', schoolId).order('grade_level').order('name'),
      supabase.from('subjects').select('*').eq('school_id', schoolId).order('name'),
      supabase.from('strands').select('*').eq('school_id', schoolId).order('name'),
    ]);
    const requestError = sectionsRes.error ?? subjectsRes.error ?? strandsRes.error;
    if (requestError) {
      setError(requestError.message);
      setLoading(false);
      return;
    }
    setSections((sectionsRes.data ?? []) as unknown as SectionRow[]);
    setAllSubjects(subjectsRes.data ?? []);
    setStrands(strandsRes.data ?? []);
    setLoading(false);
  }

  // The authenticated school is fixed for the lifetime of this page instance.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void fetchData(); void fetchInstructors(); }, []);
  useRealtimeRefresh(['sections', 'section_subjects', 'strands'], fetchData, { column: 'school_id', value: user?.school_id });

  function openCreate() { setEditing(null); setForm({ name: '', grade_level: GRADE_LEVELS[0], strand_id: '', adviser_id: '' }); setShowModal(true); }
  function openEdit(s: Section) { setEditing(s); setForm({ name: s.name, grade_level: s.grade_level, strand_id: s.strand_id ?? '', adviser_id: s.adviser_id ?? '' }); setShowModal(true); }

  const isSeniorHigh = form.grade_level === 'Grade 11' || form.grade_level === 'Grade 12';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const payload = {
      name: form.name.trim(),
      grade_level: form.grade_level,
      strand_id: isSeniorHigh && form.strand_id ? form.strand_id : null,
      adviser_id: form.adviser_id || null,
    };
    const result = editing
      ? await supabase.from('sections').update(payload).eq('id', editing.id)
      : await supabase.from('sections').insert({ ...payload, school_id: user!.school_id! });
    setSaving(false);
    if (result.error) { setError(result.error.message); showToast(`Failed to save section: ${result.error.message}`, 'error'); return; }
    setShowModal(false);
    await fetchData();
    showToast(editing ? 'Section updated successfully.' : 'Section added successfully.');
  }

  async function handleDelete(section: Section) {
    const label = `${section.grade_level} - ${section.name}`;
    if (!confirm(`Delete ${label}? This will also remove its subject assignments.`)) return;
    const { error } = await supabase.from('sections').delete().eq('id', section.id);
    if (error) { showToast(`Failed to delete: ${error.message}`, 'error'); return; }
    fetchData();
    showToast('Section deleted.');
  }

  async function handleClearStudents(section: Section) {
    const schoolId = user!.school_id!;
    const yearId = activeYear?.id;

    // Count how many students are in this section for the active year
    let count = 0;
    if (yearId) {
      const { count: c } = await supabase
        .from('student_enrollments')
        .select('student_id', { count: 'exact', head: true })
        .eq('section_id', section.id)
        .eq('academic_year_id', yearId)
        .eq('school_id', schoolId);
      count = c ?? 0;
    } else {
      const { count: c } = await supabase
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('section_id', section.id)
        .eq('school_id', schoolId);
      count = c ?? 0;
    }

    if (count === 0) { showToast('No students are assigned to this section.', 'error'); return; }

    const yearLabel = activeYear ? ` for ${activeYear.name}` : '';
    if (!confirm(`Remove ${count} student${count === 1 ? '' : 's'} from "${section.grade_level} - ${section.name}"${yearLabel}? Their records will remain — only the section assignment will be cleared.`)) return;

    setClearingSection(section.id);

    if (yearId) {
      // Clear from the per-year enrollment table (leaves other years untouched)
      const { error } = await supabase
        .from('student_enrollments')
        .delete()
        .eq('section_id', section.id)
        .eq('academic_year_id', yearId)
        .eq('school_id', schoolId);
      setClearingSection(null);
      if (error) { showToast(`Failed: ${error.message}`, 'error'); return; }
    } else {
      // No active year — clear the base section_id on the students table
      const { error } = await supabase
        .from('students')
        .update({ section_id: null })
        .eq('section_id', section.id)
        .eq('school_id', schoolId);
      setClearingSection(null);
      if (error) { showToast(`Failed: ${error.message}`, 'error'); return; }
    }

    showToast(`${count} student${count === 1 ? '' : 's'} removed from the section.`);
  }

  function openSubjectsModal(section: Section & { section_subjects?: { subject: Subject }[] }) {
    setSelectedSection(section);
    const ids = new Set((section.section_subjects ?? []).map((assignment) => assignment.subject?.id).filter(Boolean) as string[]);
    setAssignedSubjectIds(ids);
    setShowSubjectsModal(true);
  }

  function toggleSubject(subjectId: string) {
    setAssignedSubjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(subjectId)) next.delete(subjectId);
      else next.add(subjectId);
      return next;
    });
  }

  async function saveSubjects() {
    if (!selectedSection) return;
    setSavingSubjects(true);

    // Delete existing assignments for this section
    const { error: deleteError } = await supabase.from('section_subjects').delete().eq('section_id', selectedSection.id);
    if (deleteError) { alert(`Failed to save: ${deleteError.message}`); setSavingSubjects(false); return; }

    // Insert new assignments
    if (assignedSubjectIds.size > 0) {
      const rows = Array.from(assignedSubjectIds).map((subject_id) => ({
        section_id: selectedSection.id,
        subject_id,
        school_id: user!.school_id!,
      }));
      const { error: insertError } = await supabase.from('section_subjects').insert(rows);
      if (insertError) { alert(`Failed to save: ${insertError.message}`); setSavingSubjects(false); return; }
    }

    setSavingSubjects(false);
    setShowSubjectsModal(false);
    fetchData();
    showToast('Subject assignments saved.');
  }

  const exportColumns: ExportColumn<(Section & { section_subjects?: { subject: Subject }[]; strand?: Strand })>[] = [
    { header: 'Section Name', value: (row) => row.name },
    { header: 'Grade Level', value: (row) => row.grade_level },
    { header: 'Strand', value: (row) => row.strand?.code ?? '' },
    {
      header: 'Subjects',
      value: (row) => (row.section_subjects ?? [])
        .map((ss) => ss.subject?.code || ss.subject?.name)
        .filter(Boolean)
        .join(', '),
    },
  ];

  function exportCsv() {
    downloadCsv('sections', sections, exportColumns);
  }

  function exportExcel() {
    downloadExcel('sections', 'Sections', sections, exportColumns);
  }

  const sectionsWithoutSubjects = sections.filter((section) => (section.section_subjects ?? []).length === 0).length;
  const seniorHighCount = sections.filter((section) => section.grade_level === 'Grade 11' || section.grade_level === 'Grade 12').length;
  const sectionsWithoutAdviser = sections.filter((section) => !section.adviser_id).length;
  const readySections = sections.filter((section) => section.adviser_id && (section.section_subjects ?? []).length > 0).length;

  const filteredSections = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return sections.filter((section) => {
      if (gradeFilter !== 'all' && section.grade_level !== gradeFilter) return false;
      const subjectCount = (section.section_subjects ?? []).length;
      if (setupFilter === 'ready' && (!section.adviser_id || subjectCount === 0)) return false;
      if (setupFilter === 'missing-adviser' && section.adviser_id) return false;
      if (setupFilter === 'missing-subjects' && subjectCount > 0) return false;
      if (query && !`${section.name} ${section.grade_level} ${section.strand?.code ?? ''} ${section.adviser?.full_name ?? ''}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [gradeFilter, searchQuery, sections, setupFilter]);

  const gradeSummary = useMemo(() => GRADE_LEVELS.map(grade => ({
    grade,
    count: sections.filter(section => section.grade_level === grade).length,
  })).filter(item => item.count > 0), [sections]);

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary mb-1"><Layers3 size={14} /> Academic structure</div>
          <h2 className="text-2xl font-bold text-slate-900">Sections</h2>
          <p className="text-sm text-slate-500 mt-1">Build each class, assign its adviser and subjects, and resolve setup gaps before scheduling.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={exportCsv} disabled={sections.length === 0} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer">
            <Download size={16} /> Export CSV
          </button>
          <button onClick={exportExcel} disabled={sections.length === 0} className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer">
            <FileSpreadsheet size={16} /> Export Excel
          </button>
          <button onClick={openCreate} className="bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors cursor-pointer"><Plus size={16} /> Add Section</button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 flex items-start gap-3 text-rose-700"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><div><p className="text-sm font-semibold">Something needs attention</p><p className="text-xs mt-0.5">{error}</p></div></div>}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total sections</p><GraduationCap size={18} className="text-slate-300" /></div>
          <p className="mt-2 text-2xl font-bold text-slate-800">{sections.length}</p>
          <p className="text-xs text-slate-500 mt-1">{seniorHighCount} senior high section(s)</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 shadow-sm">
          <div className="flex justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Fully configured</p><CheckCircle2 size={18} className="text-emerald-500" /></div>
          <p className="mt-2 text-2xl font-bold text-emerald-800">{readySections}</p>
          <p className="text-xs text-emerald-700 mt-1">Adviser and subjects assigned</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 shadow-sm">
          <div className="flex justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Missing subjects</p><BookOpen size={18} className="text-amber-500" /></div>
          <p className="mt-2 text-2xl font-bold text-amber-800">{sectionsWithoutSubjects}</p>
          <p className="text-xs text-amber-700 mt-1">Cannot be fully scheduled yet</p>
        </div>
        <div className="rounded-2xl border border-sky-200 bg-sky-50/70 px-4 py-3 shadow-sm">
          <div className="flex justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Missing adviser</p><UserCheck size={18} className="text-sky-500" /></div>
          <p className="mt-2 text-2xl font-bold text-sky-800">{sectionsWithoutAdviser}</p>
          <p className="text-xs text-sky-700 mt-1">Needs adviser assignment</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h3 className="text-sm font-bold text-slate-800">Grade-level structure</h3><p className="text-xs text-slate-400 mt-0.5">How your sections are distributed across the school</p></div>
          <div className="flex flex-wrap gap-2">{gradeSummary.map(item => (
            <button key={item.grade} onClick={() => setGradeFilter(item.grade)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left hover:border-primary/40 hover:bg-primary/5 transition-colors cursor-pointer"><span className="block text-xs font-semibold text-slate-600">{item.grade}</span><span className="text-lg font-bold text-slate-900">{item.count}</span></button>
          ))}</div>
        </div>
        <div className="mt-5">
          <div className="flex justify-between text-xs mb-1.5"><span className="font-semibold text-slate-600">Setup completion</span><span className="text-slate-500">{sections.length ? Math.round(readySections / sections.length * 100) : 0}%</span></div>
          <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-500 transition-all" style={{ width: `${sections.length ? readySections / sections.length * 100 : 0}%` }} /></div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2"><Filter size={15} className="text-slate-400" /><span className="text-sm font-semibold text-slate-600">Filter</span></div>
        {([
          { value: 'all', label: `All ${sections.length}` },
          { value: 'ready', label: `Ready ${readySections}` },
          { value: 'missing-adviser', label: `No adviser ${sectionsWithoutAdviser}` },
          { value: 'missing-subjects', label: `No subjects ${sectionsWithoutSubjects}` },
        ] as { value: SetupFilter; label: string }[]).map(option => (
          <button key={option.value} onClick={() => setSetupFilter(option.value)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${setupFilter === option.value ? 'bg-slate-800 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>{option.label}</button>
        ))}
        <div className="flex-1 min-w-2" />
        <select value={gradeFilter} onChange={event => setGradeFilter(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 outline-none focus:ring-2 focus:ring-primary cursor-pointer"><option value="all">All grade levels</option>{GRADE_LEVELS.map(grade => <option key={grade} value={grade}>{grade}</option>)}</select>
        <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search section or adviser..." className="w-full sm:w-60 rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary" /></div>
      </div>

      <div className="grid gap-3 md:hidden">
        {filteredSections.map(section => {
          const subjectCount = (section.section_subjects ?? []).length;
          const isReady = Boolean(section.adviser_id && subjectCount > 0);
          return (
            <article key={section.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-primary">{section.grade_level}{section.strand?.code ? ` · ${section.strand.code}` : ''}</p><h3 className="text-lg font-bold text-slate-900 mt-0.5">{section.name}</h3></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${isReady ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{isReady ? 'Ready' : 'Setup needed'}</span></div>
              <div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] text-slate-400">Adviser</p><p className="text-xs font-semibold text-slate-700 mt-1 truncate">{section.adviser?.full_name ?? 'Not assigned'}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] text-slate-400">Subjects</p><p className="text-xs font-semibold text-slate-700 mt-1">{subjectCount} assigned</p></div></div>
              <div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => openSubjectsModal(section)} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white cursor-pointer"><BookOpen size={14} /> Subjects</button><button onClick={() => openEdit(section)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 cursor-pointer"><Pencil size={14} /> Edit</button></div>
            </article>
          );
        })}
        {filteredSections.length === 0 && <div className="rounded-2xl border border-slate-200 bg-white py-10 text-center text-sm text-slate-400">No sections match these filters.</div>}
      </div>

      <div className="hidden md:block bg-white rounded-xl shadow-sm overflow-hidden border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/80">
          <p className="text-sm font-semibold text-slate-700">Quick actions per section</p>
          <p className="text-xs text-slate-500 mt-1">Use the action buttons on the right to assign subjects, edit details, or delete a section.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Name</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Grade Level</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Strand</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Adviser</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Subjects</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase w-[240px]">Quick Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
            {filteredSections.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-6 py-4 text-sm font-medium text-slate-800">
                  <div>
                    <div className="font-semibold text-slate-800">{s.name}</div>
                    <div className="text-xs text-slate-500 mt-1">Manage this section's details and subject coverage</div>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">{s.grade_level}</td>
                <td className="px-6 py-4 text-sm text-slate-600">
                  {s.strand ? <span className="bg-purple-100 text-purple-700 text-xs px-2 py-0.5 rounded-full">{s.strand.code}</span> : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">
                  {s.adviser ? <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full">{s.adviser.full_name}</span> : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">
                  {(s.section_subjects ?? []).length > 0
                    ? <div className="space-y-2">
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                          {(s.section_subjects ?? []).length} subject(s) assigned
                        </span>
                        <div className="flex flex-wrap gap-1">{(s.section_subjects ?? []).map((ss) => (
                          <span key={ss.subject?.id} className="bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 rounded-full">{ss.subject?.code || ss.subject?.name}</span>
                        ))}</div>
                      </div>
                    : <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">No subjects assigned yet</span>
                  }
                </td>
                <td className="px-6 py-4">
                  <div className="min-w-[220px] space-y-2">
                    <button
                      onClick={() => openSubjectsModal(s)}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors cursor-pointer"
                      title="Assign Subjects"
                    >
                      <BookOpen size={15} /> Assign Subjects
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => openEdit(s)}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        <Pencil size={14} /> Edit
                      </button>
                      <button
                        onClick={() => handleDelete(s)}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors cursor-pointer"
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                    <button
                      onClick={() => handleClearStudents(s)}
                      disabled={clearingSection === s.id}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors cursor-pointer disabled:opacity-50"
                      title="Unassign all students from this section"
                    >
                      <UserX size={14} /> {clearingSection === s.id ? 'Clearing...' : 'Clear Students'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredSections.length === 0 && <tr><td colSpan={6} className="px-6 py-12 text-center"><Layers3 size={32} className="mx-auto text-slate-300 mb-2" /><p className="text-sm font-semibold text-slate-500">No sections match these filters</p><button onClick={() => { setSearchQuery(''); setGradeFilter('all'); setSetupFilter('all'); }} className="mt-2 text-xs font-semibold text-primary hover:underline cursor-pointer">Clear filters</button></td></tr>}
          </tbody>
        </table>
      </div>
    </div>

      {/* Create/Edit Section Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-800">{editing ? 'Edit Section' : 'Add Section'}</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Section Name</label>
                <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none" placeholder="e.g. Section A" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Grade Level</label>
                <select required value={form.grade_level} onChange={(e) => setForm({ ...form, grade_level: e.target.value, strand_id: '' })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none">
                  {GRADE_LEVELS.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              {isSeniorHigh && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Strand</label>
                  <select value={form.strand_id} onChange={(e) => setForm({ ...form, strand_id: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none">
                    <option value="">No strand</option>
                    {strands.map((s) => <option key={s.id} value={s.id}>{s.code} – {s.name}</option>)}
                  </select>
                  {strands.length === 0 && <p className="text-xs text-amber-600 mt-1">No strands created yet. Add strands first in the Strands page.</p>}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Adviser</label>
                <select value={form.adviser_id} onChange={e => setForm({ ...form, adviser_id: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none">
                  <option value="">No adviser</option>
                  {instructors.map(i => <option key={i.id} value={i.id}>{i.full_name ?? i.id}</option>)}
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-dark rounded-lg transition-colors disabled:opacity-50 cursor-pointer">{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign Subjects Modal */}
      {showSubjectsModal && selectedSection && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">Assign Subjects</h3>
                <p className="text-sm text-slate-500">{selectedSection.grade_level} - {selectedSection.name}</p>
              </div>
              <button onClick={() => setShowSubjectsModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer"><X size={20} /></button>
            </div>
            <div className="px-5 pt-4">
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600">
                Select the subjects that belong to this section. These will be available when creating schedules and managing grades.
              </div>
            </div>
            <div className="p-5 space-y-2 max-h-80 overflow-y-auto">
              {allSubjects.length === 0 && <p className="text-sm text-slate-400 text-center py-4">No subjects created yet. Add subjects first.</p>}
              {allSubjects.map((subj) => {
                const isAssigned = assignedSubjectIds.has(subj.id);
                return (
                  <label key={subj.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${isAssigned ? 'border-primary/30 bg-primary/5' : 'border-slate-200 hover:bg-slate-50'}`}>
                    <input
                      type="checkbox"
                      checked={isAssigned}
                      onChange={() => toggleSubject(subj.id)}
                      className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary cursor-pointer"
                    />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-slate-800">{subj.name}</span>
                      {subj.code && <span className="text-xs text-slate-400 ml-2">({subj.code})</span>}
                    </div>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${isAssigned ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-500'}`}>
                      {isAssigned ? 'Assigned' : 'Available'}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="flex justify-between items-center p-5 border-t border-slate-200">
              <span className="text-sm text-slate-500">{assignedSubjectIds.size} subject(s) selected</span>
              <div className="flex gap-3">
                <button onClick={() => setShowSubjectsModal(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer">Cancel</button>
                <button onClick={saveSubjects} disabled={savingSubjects} className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-dark rounded-lg transition-colors disabled:opacity-50 cursor-pointer">{savingSubjects ? 'Saving...' : 'Update Subjects'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
