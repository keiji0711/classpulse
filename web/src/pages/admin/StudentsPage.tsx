import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear } from '../../contexts/AcademicYearContext';
import { useToast } from '../../contexts/ToastContext';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import { useCachedState, hasCached } from '../../lib/pageCache';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import type { Student, Section, Strand } from '../../types';
import { Download, FileSpreadsheet, Plus, Pencil, Trash2, X, ArrowRightLeft, Users, Search } from 'lucide-react';
import { downloadCsv, downloadExcel, type ExportColumn } from '../../lib/export';
import PaginationControls from '../../components/PaginationControls';
import { SCHOOL_GRADE_LEVELS } from '../../lib/gradeLevels';

const GRADE_LEVELS = ['All', ...SCHOOL_GRADE_LEVELS];
const FORM_GRADES = GRADE_LEVELS.slice(1); // without 'All'

type StudentRow = Student & {
  section?: Section & { strand?: Strand };
  parents?: { id: string; guardian_name: string; phone_number: string }[];
};

function buildSearchPattern(rawValue: string) {
  return rawValue.trim().replace(/[%,]/g, '').replace(/\s+/g, ' ');
}

export default function StudentsPage() {
  const { user } = useAuth();
  const { activeYear, years, canWriteToActiveYear } = useAcademicYear();
  const { showToast } = useToast();
  const [students, setStudents] = useCachedState<StudentRow[]>('admin-students', []);
  const [sections, setSections] = useCachedState<(Section & { strand?: Strand })[]>('admin-students-sections', []);
  const [totalStudents, setTotalStudents] = useCachedState<number>('admin-students-total', 0);
  const [loading, setLoading] = useState(!hasCached('admin-students'));
  const [refreshingList, setRefreshingList] = useState(false);
  const [listError, setListError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [form, setForm] = useState({ first_name: '', middle_name: '', last_name: '', lrn: '', section_id: '', guardian_name: '', phone_number: '' });
  const [formGrade, setFormGrade] = useState(FORM_GRADES[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [filterGrade, setFilterGrade] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [showPromoteModal, setShowPromoteModal] = useState(false);
  const [promotionGrade, setPromotionGrade] = useState(FORM_GRADES[0]);
  const [promotionSectionId, setPromotionSectionId] = useState('');
  const [promotionTargetYearId, setPromotionTargetYearId] = useState('');
  const [promoting, setPromoting] = useState(false);
  const [promotionMessage, setPromotionMessage] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [linkingFamily, setLinkingFamily] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);

  useEffect(() => {
    setPage(1);
  }, [filterGrade, searchQuery, activeYear?.id]);

  useEffect(() => {
    if (!user?.school_id) return;
    void fetchData();
  }, [user?.school_id, activeYear?.id, filterGrade, debouncedSearchQuery, page, pageSize]);

  useRealtimeRefresh(['students', 'sections', 'parents', 'student_enrollments'], fetchData, { column: 'school_id', value: user?.school_id });

  async function fetchData() {
    const schoolId = user?.school_id;
    if (!schoolId) return;

    const yearId = activeYear?.id;
    const start = (page - 1) * pageSize;
    const end = start + pageSize - 1;
    const searchValue = buildSearchPattern(debouncedSearchQuery);
    const searchPattern = `%${searchValue}%`;

    if (!loading) setRefreshingList(true);
    setListError('');

    try {
      const sectionsPromise = supabase
        .from('sections')
        .select('*, strand:strands(*)')
        .eq('school_id', schoolId)
        .order('grade_level')
        .order('name');

      if (yearId) {
        let query = supabase
          .from('student_enrollments')
          .select(`
            student_id,
            section_id,
            student:students!inner(*, parents(id, guardian_name, phone_number)),
            section:sections!inner(*, strand:strands(*))
          `, { count: 'exact' })
          .eq('school_id', schoolId)
          .eq('academic_year_id', yearId);

        if (filterGrade !== 'All') query = query.eq('section.grade_level', filterGrade);

        if (searchValue) {
          query = query.or(
            `first_name.ilike.${searchPattern},middle_name.ilike.${searchPattern},last_name.ilike.${searchPattern},lrn.ilike.${searchPattern}`,
            { foreignTable: 'student' }
          );
        }

        const [studentsRes, sectionsRes] = await Promise.all([
          query
            .order('last_name', { ascending: true, foreignTable: 'student' })
            .order('first_name', { ascending: true, foreignTable: 'student' })
            .range(start, end),
          sectionsPromise,
        ]);

        if (studentsRes.error) throw studentsRes.error;
        if (sectionsRes.error) throw sectionsRes.error;

        const mappedStudents = ((studentsRes.data as any[]) ?? []).map((row) => ({
          ...(row.student ?? {}),
          section_id: row.section_id,
          section: row.section,
          parents: row.student?.parents ?? [],
        })) as StudentRow[];

        setStudents(mappedStudents);
        setTotalStudents(studentsRes.count ?? mappedStudents.length);
        setSections((sectionsRes.data as any) ?? []);
      } else {
        let query = supabase
          .from('students')
          .select('*, section:sections(*, strand:strands(*)), parents(id, guardian_name, phone_number)', { count: 'exact' })
          .eq('school_id', schoolId);

        if (filterGrade !== 'All') query = query.eq('section.grade_level', filterGrade);

        if (searchValue) {
          query = query.or(
            `first_name.ilike.${searchPattern},middle_name.ilike.${searchPattern},last_name.ilike.${searchPattern},lrn.ilike.${searchPattern}`
          );
        }

        const [studentsRes, sectionsRes] = await Promise.all([
          query.order('last_name').order('first_name').range(start, end),
          sectionsPromise,
        ]);

        if (studentsRes.error) throw studentsRes.error;
        if (sectionsRes.error) throw sectionsRes.error;

        const studentList = (studentsRes.data as StudentRow[] | null) ?? [];
        setStudents(studentList);
        setTotalStudents(studentsRes.count ?? studentList.length);
        setSections((sectionsRes.data as any) ?? []);
      }
    } catch (fetchError: any) {
      console.error('Failed to load students', fetchError);
      setListError(fetchError?.message ?? 'Unable to load students right now.');
    } finally {
      setLoading(false);
      setRefreshingList(false);
    }
  }

  const exportColumns: ExportColumn<StudentRow>[] = [
    { header: 'LRN', value: (row) => row.lrn },
    { header: 'Last Name', value: (row) => row.last_name },
    { header: 'First Name', value: (row) => row.first_name },
    { header: 'Middle Name', value: (row) => row.middle_name ?? '' },
    { header: 'Grade Level', value: (row) => row.section?.grade_level ?? '' },
    { header: 'Section', value: (row) => row.section?.name ?? '' },
    { header: 'Strand', value: (row) => row.section?.strand?.code ?? '' },
    { header: 'Guardian', value: (row) => row.parents?.[0]?.guardian_name ?? '' },
    { header: 'Phone', value: (row) => row.parents?.[0]?.phone_number ?? '' },
  ];

  function exportCsv() {
    downloadCsv(`students_${filterGrade.replaceAll(' ', '_').toLowerCase()}`, students, exportColumns);
  }

  function exportExcel() {
    downloadExcel(`students_${filterGrade.replaceAll(' ', '_').toLowerCase()}`, 'Students', students, exportColumns);
  }

  async function linkSelectedGuardians() {
    if (selectedIds.size < 2) {
      showToast('Select at least two students to link as siblings.', 'warning');
      return;
    }
    setLinkingFamily(true);
    try {
      const { data: parents, error: parentError } = await supabase
        .from('parents')
        .select('id, student_id')
        .in('student_id', [...selectedIds]);
      if (parentError) throw parentError;
      if ((parents?.length ?? 0) !== selectedIds.size) {
        throw new Error('Every selected student must have a guardian record.');
      }
      const { error: linkError } = await supabase.rpc('link_parent_family', {
        p_parent_ids: parents!.map((parent) => parent.id),
      });
      if (linkError) throw linkError;
      showToast(`${parents!.length} guardian records linked as one family.`);
      setSelectedIds(new Set());
    } catch (linkError: any) {
      showToast(linkError?.message ?? 'Unable to link guardian records.', 'error');
    } finally {
      setLinkingFamily(false);
    }
  }

  const formSections = sections.filter((s) => s.grade_level === formGrade);

  function openCreate() {
    if (!canWriteToActiveYear) { showToast('This academic year is read-only.', 'warning'); return; }
    setEditing(null);
    const grade = FORM_GRADES[0];
    setFormGrade(grade);
    const firstSection = sections.find((s) => s.grade_level === grade);
    setForm({ first_name: '', middle_name: '', last_name: '', lrn: '', section_id: firstSection?.id ?? '', guardian_name: '', phone_number: '' });
    setError('');
    setShowModal(true);
  }

  function openEdit(s: Student & { section?: Section & { strand?: Strand }; parents?: { guardian_name: string; phone_number: string }[] }) {
    if (!canWriteToActiveYear) { showToast('This academic year is read-only.', 'warning'); return; }
    setEditing(s);
    const parent = s.parents?.[0];
    const grade = s.section?.grade_level ?? FORM_GRADES[0];
    setFormGrade(grade);
    setForm({
      first_name: s.first_name,
      middle_name: s.middle_name ?? '',
      last_name: s.last_name,
      lrn: s.lrn,
      section_id: s.section_id,
      guardian_name: parent?.guardian_name ?? '',
      phone_number: parent?.phone_number ?? '',
    });
    setError('');
    setShowModal(true);
  }

  function handleGradeChange(grade: string) {
    setFormGrade(grade);
    const firstSection = sections.find((s) => s.grade_level === grade);
    setForm((prev) => ({ ...prev, section_id: firstSection?.id ?? '' }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canWriteToActiveYear) { setError('This academic year is read-only.'); return; }
    setSaving(true);
    setError('');
    const schoolId = user!.school_id!;

    if (editing) {
      const studentUpdates: Record<string, string> = {
        first_name: form.first_name,
        middle_name: form.middle_name,
        last_name: form.last_name,
        lrn: form.lrn,
      };
      // Legacy cache only: historical enrollments remain the source of truth.
      if (activeYear?.is_current) studentUpdates.section_id = form.section_id;
      const { error: updateError } = await supabase.from('students').update(studentUpdates).eq('id', editing.id);
      if (updateError) { setError(updateError.message); setSaving(false); return; }

      // Upsert parent
      const { data: existingParent } = await supabase.from('parents').select('id').eq('student_id', editing.id).single();
      if (existingParent) {
        const { error: parentError } = await supabase.from('parents').update({ guardian_name: form.guardian_name, phone_number: form.phone_number }).eq('id', existingParent.id);
        if (parentError) { setError(parentError.message); setSaving(false); return; }
      } else {
        const { error: parentError } = await supabase.from('parents').insert({ student_id: editing.id, school_id: schoolId, guardian_name: form.guardian_name, phone_number: form.phone_number });
        if (parentError) { setError(parentError.message); setSaving(false); return; }
      }

      // Update enrollment for active academic year
      if (activeYear?.id) {
        // Migration 042 only permits direct updates to section_id. A full-row
        // upsert requests UPDATE privileges for immutable enrollment columns and
        // is therefore rejected by Postgres even when those values are unchanged.
        const { error: enrollmentError } = await supabase
          .from('student_enrollments')
          .update({ section_id: form.section_id })
          .eq('student_id', editing.id)
          .eq('academic_year_id', activeYear.id)
          .eq('school_id', schoolId);
        if (enrollmentError) { setError(enrollmentError.message); setSaving(false); return; }
      }
    } else {
      // Recover cleanly when an earlier request created the student but failed
      // before creating the enrollment (for example, the former 403 upsert).
      const { data: existingStudent, error: lookupError } = await supabase
        .from('students')
        .select('id')
        .eq('school_id', schoolId)
        .eq('lrn', form.lrn)
        .maybeSingle();
      if (lookupError) { setError(lookupError.message); setSaving(false); return; }

      let studentId = existingStudent?.id;
      if (studentId && activeYear?.id) {
        const { data: existingEnrollment, error: enrollmentLookupError } = await supabase
          .from('student_enrollments')
          .select('id')
          .eq('student_id', studentId)
          .eq('academic_year_id', activeYear.id)
          .maybeSingle();
        if (enrollmentLookupError) { setError(enrollmentLookupError.message); setSaving(false); return; }
        if (existingEnrollment) { setError('A student with this LRN is already enrolled in the selected academic year.'); setSaving(false); return; }

        const { error: recoverError } = await supabase.from('students').update({
          first_name: form.first_name, middle_name: form.middle_name, last_name: form.last_name, section_id: form.section_id,
        }).eq('id', studentId);
        if (recoverError) { setError(recoverError.message); setSaving(false); return; }
      } else {
        const { data: newStudent, error: insertError } = await supabase.from('students').insert({
          first_name: form.first_name, middle_name: form.middle_name, last_name: form.last_name, lrn: form.lrn, section_id: form.section_id, school_id: schoolId,
        }).select('id').single();
        if (insertError) { setError(insertError.message); setSaving(false); return; }
        studentId = newStudent.id;
      }

      if (studentId && form.guardian_name) {
        const { data: existingParent, error: parentLookupError } = await supabase.from('parents').select('id').eq('student_id', studentId).maybeSingle();
        if (parentLookupError) { setError(parentLookupError.message); setSaving(false); return; }
        const parentResult = existingParent
          ? await supabase.from('parents').update({ guardian_name: form.guardian_name, phone_number: form.phone_number }).eq('id', existingParent.id)
          : await supabase.from('parents').insert({ student_id: studentId, school_id: schoolId, guardian_name: form.guardian_name, phone_number: form.phone_number });
        if (parentResult.error) { setError(parentResult.error.message); setSaving(false); return; }
      }

      // Create enrollment for active academic year.
      if (studentId && activeYear?.id) {
        const { error: enrollmentError } = await supabase.from('student_enrollments').insert({
          student_id: studentId,
          section_id: form.section_id,
          academic_year_id: activeYear.id,
          school_id: schoolId,
        });
        if (enrollmentError) { setError(enrollmentError.message); setSaving(false); return; }
      }
    }

    setSaving(false);
    setShowModal(false);
    fetchData();
    showToast(editing ? 'Student updated successfully.' : 'Student added successfully.');
  }

  async function handleDelete(id: string) {
    if (!canWriteToActiveYear) { showToast('This academic year is read-only.', 'warning'); return; }
    if (!confirm('Delete this student and their parent record?')) return;
    const { error: parentErr } = await supabase.from('parents').delete().eq('student_id', id);
    if (parentErr) { showToast(`Failed to delete parent: ${parentErr.message}`, 'error'); return; }
    const { error: studentErr } = await supabase.from('students').delete().eq('id', id);
    if (studentErr) { showToast(`Failed to delete student: ${studentErr.message}`, 'error'); return; }
    fetchData();
    showToast('Student deleted.');
  }

  function getNextGradeLevel(currentGrade?: string) {
    const currentIndex = FORM_GRADES.indexOf(currentGrade ?? '');
    if (currentIndex >= 0 && currentIndex < FORM_GRADES.length - 1) {
      return FORM_GRADES[currentIndex + 1];
    }
    return currentGrade ?? FORM_GRADES[0];
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === students.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(students.map((s) => s.id)));
    }
  }

  const selectedStudents = students.filter((s) => selectedIds.has(s.id));

  function closePromoteModal() {
    setShowPromoteModal(false);
    setPromotionMessage('');
  }

  function openPromoteModal() {
    if (!canWriteToActiveYear) { showToast('Select the active academic year before promoting students.', 'warning'); return; }
    if (selectedStudents.length === 0) return;
    // Suggest next grade level based on the first selected student
    const firstStudent = selectedStudents[0];
    const suggestedGrade = getNextGradeLevel(firstStudent.section?.grade_level);
    const suggestedSection = sections.find((section) => section.grade_level === suggestedGrade) ?? null;

    setPromotionGrade(suggestedSection?.grade_level ?? suggestedGrade);
    setPromotionSectionId(suggestedSection?.id ?? '');
    // Default target year to the first year that isn't the active year, or empty
    const otherYears = years.filter((y) => y.id !== activeYear?.id);
    setPromotionTargetYearId(otherYears.length > 0 ? otherYears[0].id : '');
    setPromotionMessage('');
    setShowPromoteModal(true);
  }

  function handlePromotionGradeChange(grade: string) {
    setPromotionGrade(grade);
    const firstSection = sections.find((section) => section.grade_level === grade);
    setPromotionSectionId(firstSection?.id ?? '');
    setPromotionMessage('');
  }

  async function handleBulkPromote() {
    if (!promotionTargetYearId) {
      setPromotionMessage('Select a target academic year.');
      return;
    }
    if (promotionTargetYearId === activeYear?.id) {
      setPromotionMessage('Cannot promote to the same academic year. Select a different target year or create a new one first.');
      return;
    }
    if (selectedStudents.length === 0) {
      setPromotionMessage('No students selected.');
      return;
    }
    if (!promotionSectionId) {
      setPromotionMessage('Choose the target section.');
      return;
    }

    setPromoting(true);
    setPromotionMessage('');

    const schoolId = user!.school_id!;
    // Split inserts from section-only updates so the operation respects the
    // column-level enrollment permissions introduced in migration 042.
    const enrollmentRows = selectedStudents.map((s) => ({
      student_id: s.id,
      section_id: promotionSectionId,
      academic_year_id: promotionTargetYearId,
      school_id: schoolId,
    }));

    const selectedStudentIds = selectedStudents.map(student => student.id);
    const { data: existingRows, error: existingError } = await supabase
      .from('student_enrollments')
      .select('student_id')
      .eq('school_id', schoolId)
      .eq('academic_year_id', promotionTargetYearId)
      .in('student_id', selectedStudentIds);

    if (existingError) {
      setPromotionMessage(`Error: ${existingError.message}`);
      setPromoting(false);
      return;
    }

    const existingIds = new Set((existingRows ?? []).map(row => row.student_id));
    const newEnrollments = enrollmentRows.filter(row => !existingIds.has(row.student_id));

    if (newEnrollments.length > 0) {
      const { error: insertEnrollmentError } = await supabase
        .from('student_enrollments')
        .insert(newEnrollments);
      if (insertEnrollmentError) {
        setPromotionMessage(`Error: ${insertEnrollmentError.message}`);
        setPromoting(false);
        return;
      }
    }

    if (existingIds.size > 0) {
      const { error: updateEnrollmentError } = await supabase
        .from('student_enrollments')
        .update({ section_id: promotionSectionId })
        .eq('school_id', schoolId)
        .eq('academic_year_id', promotionTargetYearId)
        .in('student_id', [...existingIds]);
      if (updateEnrollmentError) {
        setPromotionMessage(`Error: ${updateEnrollmentError.message}`);
        setPromoting(false);
        return;
      }
    }

    const targetSection = sections.find((section) => section.id === promotionSectionId);
    const targetYear = years.find((y) => y.id === promotionTargetYearId);
    const count = selectedStudents.length;

    setPromoting(false);
    await fetchData();
    setSelectedIds(new Set());

    setPromotionMessage(`Successfully promoted ${count} student(s) to ${targetSection?.grade_level ?? ''} - ${targetSection?.name ?? ''} for ${targetYear?.name ?? ''}.`);
    showToast(`${count} student(s) promoted successfully.`);
  }

  const activeYearLabel = activeYear?.name ?? 'No academic year selected';
  const promotionSections = sections.filter((section) => section.grade_level === promotionGrade);
  const selectedPromotionSection = sections.find((section) => section.id === promotionSectionId);
  const targetYearOptions = years.filter((y) => y.id !== activeYear?.id);
  const selectedTargetYear = years.find((y) => y.id === promotionTargetYearId);
  const isSameYear = promotionTargetYearId === activeYear?.id;

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Students</h2>
        <p className="text-sm text-slate-600 mt-1 max-w-3xl">
          Use the checkboxes to select students, then click <strong>Promote Selected</strong> to move them into their new section for the active academic year.
        </p>
      </div>

      <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
        <div className="relative w-full max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by student name, LRN, guardian, or section"
            className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-700 shadow-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={exportCsv} disabled={students.length === 0} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer">
            <Download size={16} /> Export CSV
          </button>
          <button onClick={exportExcel} disabled={students.length === 0} className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer">
            <FileSpreadsheet size={16} /> Export Excel
          </button>
          <button onClick={openCreate} disabled={!canWriteToActiveYear} className="bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"><Plus size={16} /> Add Student</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Students in this view</p>
          <p className="mt-2 text-2xl font-bold text-slate-800">{totalStudents}</p>
          <p className="text-xs text-slate-500 mt-1">Filtered by {filterGrade}</p>
        </div>
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 px-4 py-3 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Active academic year</p>
          <p className="mt-2 text-lg font-bold text-indigo-800">{activeYearLabel}</p>
          <p className="text-xs text-indigo-700 mt-1">Section assignments follow the selected year</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Tip</p>
          <p className="mt-2 text-sm font-semibold text-amber-900">Create a new academic year first</p>
          <p className="text-xs text-amber-700 mt-1">Set the new academic year as active, then select students and promote them to their new sections.</p>
        </div>
      </div>

      {/* Bulk Promote Bar */}
      {selectedIds.size > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-3 flex items-center justify-between gap-4 animate-slide-in">
          <div className="flex items-center gap-3">
            <div className="bg-amber-500 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold">{selectedIds.size}</div>
            <p className="text-sm font-medium text-amber-900">student(s) selected</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedIds(new Set())} className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-white rounded-lg transition-colors cursor-pointer">Clear</button>
            <button
              onClick={() => void linkSelectedGuardians()}
              disabled={selectedIds.size < 2 || linkingFamily}
              className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-white px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
              title="Explicitly link these guardians so the parent app can switch between siblings"
            >
              <Users size={15} /> {linkingFamily ? 'Linking…' : 'Link as Siblings'}
            </button>
            <button
              onClick={openPromoteModal}
              disabled={!activeYear || !canWriteToActiveYear}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md hover:from-amber-600 hover:to-orange-600 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              <ArrowRightLeft size={15} /> Promote Selected
            </button>
          </div>
        </div>
      )}

      {/* Grade Level Filter */}
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap gap-2">
          {GRADE_LEVELS.map((g) => (
            <button
              key={g}
              onClick={() => setFilterGrade(g)}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors cursor-pointer ${filterGrade === g ? 'bg-primary text-white' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
            >{g}</button>
          ))}
        </div>
        <div className="text-xs text-slate-500">
          {refreshingList ? 'Refreshing results…' : `Server-side loading active • ${totalStudents} match(es)`}
        </div>
      </div>

      {listError && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{listError}</div>}

      <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-slate-200">
        <div className="overflow-x-auto max-h-[70vh]">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={students.length > 0 && selectedIds.size === students.length}
                    onChange={toggleSelectAll}
                    disabled={!canWriteToActiveYear}
                    className="w-4 h-4 text-primary border-slate-300 rounded focus:ring-primary cursor-pointer"
                  />
                </th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">LRN</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Name</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Grade</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Section</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Strand</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Guardian</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Phone</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase w-[120px] text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {students.map((s) => (
                <tr key={s.id} className={`group hover:bg-slate-50/80 transition-colors ${selectedIds.has(s.id) ? 'bg-amber-50/40' : ''}`}>
                  <td className="px-4 py-4">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(s.id)}
                      onChange={() => toggleSelect(s.id)}
                      disabled={!canWriteToActiveYear}
                      className="w-4 h-4 text-primary border-slate-300 rounded focus:ring-primary cursor-pointer"
                    />
                  </td>
                  <td className="px-6 py-4 text-sm font-mono text-slate-800">{s.lrn}</td>
                  <td className="px-6 py-4 text-sm font-medium text-slate-800">{s.last_name}, {s.first_name}{s.middle_name ? ` ${s.middle_name.charAt(0)}.` : ''}</td>
                  <td className="px-6 py-4 text-sm text-slate-600">{s.section?.grade_level ?? '—'}</td>
                  <td className="px-6 py-4 text-sm text-slate-600">{s.section?.name ?? '—'}</td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {(s.section as any)?.strand
                      ? <span className="bg-purple-100 text-purple-700 text-xs px-2 py-0.5 rounded-full">{(s.section as any).strand.code}</span>
                      : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">{(s as any).parents?.[0]?.guardian_name ?? '—'}</td>
                  <td className="px-6 py-4 text-sm text-slate-600">{(s as any).parents?.[0]?.phone_number ?? '—'}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end">
                      <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 shadow-sm">
                        <button
                          onClick={() => openEdit(s)}
                          disabled={!canWriteToActiveYear}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Edit student"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(s.id)}
                          disabled={!canWriteToActiveYear}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-white text-rose-500 transition-colors hover:bg-rose-50 hover:border-rose-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Delete student"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
              {students.length === 0 && <tr><td colSpan={9} className="px-6 py-8 text-center text-slate-400">{filterGrade === 'All' ? 'No students yet.' : `No students in ${filterGrade}.`}</td></tr>}
            </tbody>
          </table>
        </div>
        {totalStudents > 0 && (
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
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-800">{editing ? 'Edit Student' : 'Add Student'}</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {error && <div className="bg-red-50 text-red-600 rounded-lg p-3 text-sm">{error}</div>}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">First Name</label>
                  <input type="text" required value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Middle Name</label>
                  <input type="text" value={form.middle_name} onChange={(e) => setForm({ ...form, middle_name: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none" placeholder="Optional" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Last Name</label>
                  <input type="text" required value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">LRN</label>
                  <input type="text" required value={form.lrn} onChange={(e) => setForm({ ...form, lrn: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none" placeholder="Learner Reference Number" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Grade Level</label>
                  <select required value={formGrade} onChange={(e) => handleGradeChange(e.target.value)} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none">
                    {FORM_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Section</label>
                <select required value={form.section_id} onChange={(e) => setForm({ ...form, section_id: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none">
                  <option value="">Select section</option>
                  {formSections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.strand ? ` (${s.strand.code})` : ''}
                    </option>
                  ))}
                </select>
                {formSections.length === 0 && <p className="text-xs text-amber-600 mt-1">No sections for {formGrade}. Create one in the Sections page first.</p>}
              </div>
              <hr className="border-slate-200" />
              <p className="text-sm font-medium text-slate-500">Parent / Guardian Info</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Guardian Name</label>
                  <input type="text" value={form.guardian_name} onChange={(e) => setForm({ ...form, guardian_name: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number</label>
                  <input type="text" value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none" />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-dark rounded-lg transition-colors disabled:opacity-50 cursor-pointer">{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPromoteModal && selectedStudents.length > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">Promote Students</h3>
                <p className="text-sm text-slate-500 mt-1">Move {selectedStudents.length} student(s) from <span className="font-semibold text-slate-700">{activeYearLabel}</span> to a new academic year.</p>
              </div>
              <button onClick={closePromoteModal} className="text-slate-400 hover:text-slate-600 cursor-pointer"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4">
              {/* Selected students list */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{selectedStudents.length} selected student(s)</p>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {selectedStudents.map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-700">{s.last_name}, {s.first_name}</span>
                      <span className="text-xs text-slate-400">{s.section?.grade_level ?? '—'} - {s.section?.name ?? '—'}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Target academic year */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Promote to academic year</label>
                {targetYearOptions.length === 0 ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                    <p className="text-sm font-medium text-red-700">No other academic year available</p>
                    <p className="text-xs text-red-600 mt-1">You need to create a new academic year in the Academic Years page before you can promote students. Promotion moves students from one year to another.</p>
                  </div>
                ) : (
                  <>
                    <select
                      value={promotionTargetYearId}
                      onChange={(e) => { setPromotionTargetYearId(e.target.value); setPromotionMessage(''); }}
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                    >
                      <option value="">Select target year</option>
                      {targetYearOptions.map((y) => (
                        <option key={y.id} value={y.id}>{y.name}{y.is_current ? ' (current)' : ''}</option>
                      ))}
                    </select>
                    {isSameYear && (
                      <p className="text-xs text-red-600 mt-1">Cannot promote to the same academic year the students are currently enrolled in.</p>
                    )}
                  </>
                )}
              </div>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">New placement</p>
                <p className="mt-2 text-sm font-semibold text-emerald-800">
                  {selectedTargetYear ? selectedTargetYear.name : '—'} &bull; {selectedPromotionSection ? `${selectedPromotionSection.grade_level} - ${selectedPromotionSection.name}` : 'Select a target section'}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">New grade level</label>
                  <select
                    value={promotionGrade}
                    onChange={(e) => handlePromotionGradeChange(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                  >
                    {FORM_GRADES.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">New section</label>
                  <select
                    value={promotionSectionId}
                    onChange={(e) => { setPromotionSectionId(e.target.value); setPromotionMessage(''); }}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                  >
                    <option value="">Select target section</option>
                    {promotionSections.map((section) => (
                      <option key={section.id} value={section.id}>{section.name}{section.strand ? ` (${section.strand.code})` : ''}</option>
                    ))}
                  </select>
                  {promotionSections.length === 0 && <p className="text-xs text-amber-600 mt-1">No sections found for {promotionGrade}. Create one in the Sections page first.</p>}
                </div>
              </div>

              {promotionMessage && (
                <div className={`rounded-lg p-3 text-sm ${promotionMessage.startsWith('Error') ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>
                  {promotionMessage}
                </div>
              )}

              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-3">
                <p className="text-sm font-medium text-slate-700 flex items-center gap-2"><Users size={16} /> How promotion works</p>
                <p className="text-sm text-slate-500 mt-1">Create a new academic year and set it as the active year first, then promote students to their new sections. Past-year records remain intact.</p>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closePromoteModal} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer">Cancel</button>
                <button
                  type="button"
                  onClick={handleBulkPromote}
                  disabled={promoting || !promotionTargetYearId || isSameYear || !promotionSectionId || targetYearOptions.length === 0}
                  className="px-4 py-2 text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {promoting ? 'Promoting...' : `Promote ${selectedStudents.length} Student(s)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
