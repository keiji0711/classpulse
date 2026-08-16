import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Activity, BookOpenCheck, Calculator, CheckCircle2, HeartPulse, Search, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear } from '../../contexts/AcademicYearContext';
import { useToast } from '../../contexts/ToastContext';
import {
  CRLA_LEVELS,
  LITERACY_LANGUAGES,
  PHIL_IRI_LEVELS,
  RMA_LEVELS,
  ageInMonths,
  assessmentLabel,
  heightStatusFromZScore,
  literacyInstrument,
  nutritionStatusFromZScore,
  supportsRma,
  type AssessmentDomain,
  type AssessmentPeriod,
} from '../../lib/depedAssessments';

type RosterStudent = {
  id: string;
  lrn: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  section_id: string;
  section: { id: string; name: string; grade_level: string };
};

type AssessmentRecord = {
  id: string;
  student_id: string;
  assessment_period: AssessmentPeriod;
  domain: AssessmentDomain;
  instrument: string;
  instrument_version: string;
  language: string;
  classification: string;
  secondary_classification: string | null;
  raw_score: number | null;
  total_items: number | null;
  assessment_date: string;
  sex: 'male' | 'female' | null;
  date_of_birth: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  bmi: number | null;
  bmi_for_age_z: number | null;
  height_for_age_z: number | null;
  notes: string;
};

type EnrollmentResultRow = {
  section_id: string;
  student: Omit<RosterStudent, 'section_id' | 'section'> | Array<Omit<RosterStudent, 'section_id' | 'section'>>;
  section: RosterStudent['section'] | Array<RosterStudent['section']>;
};

type FormState = {
  language: 'mother_tongue' | 'filipino' | 'english';
  classification: string;
  rawScore: string;
  totalItems: string;
  assessmentDate: string;
  instrumentVersion: string;
  sex: '' | 'male' | 'female';
  dateOfBirth: string;
  heightCm: string;
  weightKg: string;
  bmiZ: string;
  hfaZ: string;
  notes: string;
  verified: boolean;
};

const emptyForm: FormState = {
  language: 'filipino', classification: '', rawScore: '', totalItems: '', assessmentDate: '',
  instrumentVersion: '', sex: '', dateOfBirth: '', heightCm: '', weightKg: '', bmiZ: '', hfaZ: '',
  notes: '', verified: false,
};

export default function LearnerAssessmentsPage() {
  const { user } = useAuth();
  const { activeYear, isViewingCurrentYear } = useAcademicYear();
  const { showToast } = useToast();
  const [period, setPeriod] = useState<AssessmentPeriod>('bosy');
  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [records, setRecords] = useState<AssessmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ student: RosterStudent; domain: AssessmentDomain } | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const userId = user?.id;
  const schoolId = user?.school_id;
  const activeYearId = activeYear?.id;
  const assessmentWritable = isViewingCurrentYear
    && (activeYear?.status === 'active' || activeYear?.status === 'closing' || !activeYear?.status);

  const load = useCallback(async () => {
    if (!userId || !schoolId || !activeYearId) {
      setStudents([]); setRecords([]); setLoading(false); return;
    }
    setLoading(true);
    const [advisoryResult, scheduleResult] = await Promise.all([
      supabase.from('sections').select('id').eq('school_id', schoolId).eq('adviser_id', userId),
      supabase.from('schedules').select('section_id').eq('school_id', schoolId).eq('academic_year_id', activeYearId).eq('instructor_id', userId),
    ]);
    const sectionIds = [...new Set([
      ...(advisoryResult.data ?? []).map((row) => row.id),
      ...(scheduleResult.data ?? []).map((row) => row.section_id),
    ])];
    if (advisoryResult.error || scheduleResult.error) {
      showToast(advisoryResult.error?.message ?? scheduleResult.error?.message ?? 'Unable to load teacher assignments.', 'error');
      setLoading(false); return;
    }
    if (sectionIds.length === 0) {
      setStudents([]); setRecords([]); setLoading(false); return;
    }
    const enrollmentResult = await supabase
      .from('student_enrollments')
      .select('student_id,section_id,student:students!inner(id,lrn,first_name,middle_name,last_name),section:sections!inner(id,name,grade_level)')
      .eq('school_id', schoolId)
      .eq('academic_year_id', activeYearId)
      .eq('enrollment_status', 'enrolled')
      .in('section_id', sectionIds);
    if (enrollmentResult.error) {
      showToast(enrollmentResult.error.message, 'error'); setLoading(false); return;
    }
    const roster = ((enrollmentResult.data ?? []) as unknown as EnrollmentResultRow[]).map((row) => {
      const student = Array.isArray(row.student) ? row.student[0] : row.student;
      const section = Array.isArray(row.section) ? row.section[0] : row.section;
      return { ...student, section_id: row.section_id, section } as RosterStudent;
    }).sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));
    setStudents(roster);
    const assessmentResult = await supabase.from('learner_assessments').select('*')
      .eq('academic_year_id', activeYearId).eq('assessment_period', period)
      .in('student_id', roster.map((student) => student.id));
    if (assessmentResult.error) showToast(assessmentResult.error.message, 'error');
    setRecords((assessmentResult.data ?? []) as AssessmentRecord[]);
    setLoading(false);
  }, [activeYearId, period, schoolId, showToast, userId]);

  // Loading remote Supabase state is the synchronization performed by this effect.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const visibleStudents = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return students;
    return students.filter((student) => `${student.first_name} ${student.middle_name ?? ''} ${student.last_name} ${student.lrn} ${student.section.grade_level} ${student.section.name}`.toLowerCase().includes(query));
  }, [search, students]);

  const completion = useMemo(() => Object.fromEntries((['literacy','numeracy','nutrition'] as AssessmentDomain[]).map((domain) => [
    domain, new Set(records.filter((record) => record.domain === domain).map((record) => record.student_id)).size,
  ])) as Record<AssessmentDomain, number>, [records]);

  function recordsFor(studentId: string, domain: AssessmentDomain) {
    return records.filter((record) => record.student_id === studentId && record.domain === domain);
  }

  function openAssessment(student: RosterStudent, domain: AssessmentDomain) {
    const instrument = domain === 'literacy' ? literacyInstrument(student.section.grade_level) : domain === 'numeracy' ? (supportsRma(student.section.grade_level) ? 'RMA' : null) : 'DEPED_NUTRITION';
    if (!instrument) {
      showToast(`The current DepEd ${domain} instrument in this module does not cover ${student.section.grade_level}.`, 'error');
      return;
    }
    const existing = recordsFor(student.id, domain)[0];
    const defaultDate = period === 'bosy' ? activeYear?.start_date : activeYear?.end_date;
    setEditing({ student, domain });
    setForm(existing ? {
      language: existing.language === 'not_applicable' ? 'filipino' : existing.language as FormState['language'],
      classification: existing.classification,
      rawScore: existing.raw_score?.toString() ?? '', totalItems: existing.total_items?.toString() ?? '',
      assessmentDate: existing.assessment_date, instrumentVersion: existing.instrument_version,
      sex: existing.sex ?? '', dateOfBirth: existing.date_of_birth ?? '',
      heightCm: existing.height_cm?.toString() ?? '', weightKg: existing.weight_kg?.toString() ?? '',
      bmiZ: existing.bmi_for_age_z?.toString() ?? '', hfaZ: existing.height_for_age_z?.toString() ?? '',
      notes: existing.notes, verified: false,
    } : {
      ...emptyForm,
      assessmentDate: defaultDate ?? '',
      instrumentVersion: `DepEd ${period === 'bosy' ? 'BoSY' : 'EoSY'} ${activeYear?.name ?? ''} official ${instrument === 'DEPED_NUTRITION' ? 'nutritional tool' : 'scoresheet'}`,
    });
  }

  function selectLiteracyLanguage(language: FormState['language']) {
    if (!editing) return;
    const existing = recordsFor(editing.student.id, 'literacy').find((record) => record.language === language);
    setForm((current) => existing ? {
      ...current, language, classification: existing.classification,
      rawScore: existing.raw_score?.toString() ?? '', totalItems: existing.total_items?.toString() ?? '',
      assessmentDate: existing.assessment_date, instrumentVersion: existing.instrument_version,
      notes: existing.notes, verified: false,
    } : { ...current, language, classification: '', rawScore: '', totalItems: '', notes: '', verified: false });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing || !activeYear?.id) return;
    if (!assessmentWritable) { showToast('Select the current active or closing academic year before recording assessments.', 'error'); return; }
    if (!form.verified) { showToast('Confirm that you copied the result from the official DepEd tool.', 'error'); return; }
    const domain = editing.domain;
    const instrument = domain === 'literacy' ? literacyInstrument(editing.student.section.grade_level) : domain === 'numeracy' ? 'RMA' : 'DEPED_NUTRITION';
    if (!instrument) return;
    setSaving(true);
    const { data: savedAssessment, error } = await supabase.rpc('save_learner_assessment', {
      p_student_id: editing.student.id, p_academic_year_id: activeYear.id,
      p_assessment_period: period, p_domain: domain, p_instrument: instrument,
      p_instrument_version: form.instrumentVersion.trim(),
      p_language: domain === 'literacy' ? form.language : 'not_applicable',
      p_classification: domain === 'nutrition' ? 'derived_by_server' : form.classification,
      p_secondary_classification: null,
      p_raw_score: domain === 'numeracy' ? Number(form.rawScore) : null,
      p_total_items: domain === 'numeracy' ? Number(form.totalItems) : null,
      p_assessment_date: form.assessmentDate,
      p_sex: domain === 'nutrition' ? form.sex : null,
      p_date_of_birth: domain === 'nutrition' ? form.dateOfBirth : null,
      p_height_cm: domain === 'nutrition' ? Number(form.heightCm) : null,
      p_weight_kg: domain === 'nutrition' ? Number(form.weightKg) : null,
      p_bmi_for_age_z: domain === 'nutrition' ? Number(form.bmiZ) : null,
      p_height_for_age_z: domain === 'nutrition' ? Number(form.hfaZ) : null,
      p_details: { verified_from_official_tool: true }, p_notes: form.notes.trim(),
      p_verified_from_official_tool: true,
    });
    if (error) { setSaving(false); showToast(error.message, 'error'); return; }
    const assessmentId = (savedAssessment as { id?: string } | null)?.id;
    if (assessmentId) {
      const { error: notificationError } = await supabase.functions.invoke('dispatch-assessment-notification', { body: { assessment_id: assessmentId } });
      if (notificationError) showToast('Assessment saved. The parent notification is queued for automatic retry.', 'warning');
    }
    setSaving(false);
    showToast(`${domain.charAt(0).toUpperCase() + domain.slice(1)} assessment saved.`);
    setEditing(null); await load();
  }

  if (loading) return <div className="flex min-h-[420px] items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-primary" /></div>;

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div><h1 className="text-2xl font-bold text-slate-900">Learner Assessments</h1><p className="mt-1 text-sm text-slate-500">Record official literacy, numeracy, and nutritional results for {activeYear?.name ?? 'the active school year'}.</p></div>
      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {(['bosy','eosy'] as AssessmentPeriod[]).map((value) => <button key={value} onClick={() => setPeriod(value)} className={`rounded-lg px-4 py-2 text-sm font-bold ${period === value ? 'bg-primary text-white' : 'text-slate-500 hover:bg-slate-50'}`}>{value === 'bosy' ? 'Beginning of School Year' : 'End of School Year'}</button>)}
      </div>
    </div>

    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>Evidence rule:</strong> use the current official CRLA, Phil-IRI, RMA, or DepEd/LIS nutritional tool. The app records and validates the result; it does not replace administration of the official assessment.</div>

    <div className="grid gap-4 sm:grid-cols-3">
      <Summary icon={<BookOpenCheck size={21}/>} label="Literacy recorded" value={completion.literacy} total={students.length}/>
      <Summary icon={<Calculator size={21}/>} label="Numeracy recorded" value={completion.numeracy} total={students.length}/>
      <Summary icon={<HeartPulse size={21}/>} label="Nutrition recorded" value={completion.nutrition} total={students.length}/>
    </div>

    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-bold text-slate-900">Assigned learners</h2><p className="text-xs text-slate-500">{visibleStudents.length} learners · {period === 'bosy' ? 'BoSY' : 'EoSY'}</p></div><div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search learner or LRN" className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary sm:w-72"/></div></div>
      {students.length === 0 ? <div className="py-16 text-center text-sm text-slate-500">No enrolled learners are assigned to you for this academic year.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left"><thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Learner</th><th className="px-4 py-3">Class</th><th className="px-4 py-3">Literacy</th><th className="px-4 py-3">Numeracy</th><th className="px-4 py-3">Nutrition</th></tr></thead><tbody className="divide-y divide-slate-100">{visibleStudents.map((student) => <tr key={student.id}><td className="px-4 py-3"><p className="font-bold text-slate-800">{student.last_name}, {student.first_name}</p><p className="text-xs text-slate-400">LRN {student.lrn}</p></td><td className="px-4 py-3 text-sm text-slate-600">{student.section.grade_level} · {student.section.name}</td>{(['literacy','numeracy','nutrition'] as AssessmentDomain[]).map((domain) => { const existing = recordsFor(student.id, domain); return <td key={domain} className="px-4 py-3"><button disabled={!assessmentWritable} onClick={() => openAssessment(student, domain)} className={`min-w-36 rounded-xl border px-3 py-2 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${existing.length ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-600 hover:border-primary/40'}`}><span className="flex items-center gap-1.5 font-bold">{existing.length ? <CheckCircle2 size={14}/> : <Activity size={14}/>} {existing.length ? (domain === 'literacy' && existing.length > 1 ? `${existing.length} languages` : assessmentLabel(existing[0].classification)) : 'Record result'}</span></button></td>;})}</tr>)}</tbody></table></div>}
    </div>

    {editing && <AssessmentModal editing={editing} form={form} setForm={setForm} onLanguage={selectLiteracyLanguage} onClose={() => setEditing(null)} onSave={save} saving={saving}/>} 
  </div>;
}

function Summary({ icon, label, value, total }: { icon: React.ReactNode; label: string; value: number; total: number }) {
  const percent = total ? Math.round(value / total * 100) : 0;
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">{icon}</span><span className="text-xs font-bold text-slate-400">{percent}%</span></div><p className="mt-3 text-2xl font-extrabold text-slate-900">{value}<span className="text-sm font-semibold text-slate-400"> / {total}</span></p><p className="text-xs font-semibold text-slate-500">{label}</p></div>;
}

function AssessmentModal({ editing, form, setForm, onLanguage, onClose, onSave, saving }: {
  editing: { student: RosterStudent; domain: AssessmentDomain }; form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>; onLanguage: (language: FormState['language']) => void;
  onClose: () => void; onSave: (event: FormEvent) => void; saving: boolean;
}) {
  const instrument = editing.domain === 'literacy' ? literacyInstrument(editing.student.section.grade_level) : editing.domain === 'numeracy' ? 'RMA' : 'DEPED_NUTRITION';
  const levels = instrument === 'CRLA' ? CRLA_LEVELS : instrument === 'PHIL_IRI' ? PHIL_IRI_LEVELS : RMA_LEVELS;
  const bmiZ = Number(form.bmiZ); const hfaZ = Number(form.hfaZ);
  const bmi = Number(form.heightCm) > 0 && Number(form.weightKg) > 0 ? Number(form.weightKg) / ((Number(form.heightCm) / 100) ** 2) : null;
  const months = ageInMonths(form.dateOfBirth, form.assessmentDate);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white p-5"><div><h2 className="text-lg font-bold text-slate-900">{editing.domain.charAt(0).toUpperCase()+editing.domain.slice(1)} · {editing.student.last_name}, {editing.student.first_name}</h2><p className="text-xs text-slate-500">{instrument?.replace('_','-')} · {editing.student.section.grade_level} {editing.student.section.name}</p></div><button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20}/></button></div><form onSubmit={onSave} className="space-y-4 p-5">
    {editing.domain === 'literacy' && <Field label="Assessment language"><select value={form.language} onChange={(e) => onLanguage(e.target.value as FormState['language'])} className="field-input">{LITERACY_LANGUAGES.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></Field>}
    {editing.domain !== 'nutrition' && <Field label="Official proficiency classification"><select required value={form.classification} onChange={(e) => setForm((f) => ({...f,classification:e.target.value}))} className="field-input"><option value="">Select the scoresheet result</option>{levels.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></Field>}
    {editing.domain === 'numeracy' && <div className="grid grid-cols-2 gap-3"><Field label="Raw score"><input required type="number" min="0" step="1" value={form.rawScore} onChange={(e) => setForm((f)=>({...f,rawScore:e.target.value}))} className="field-input"/></Field><Field label="Total items"><input required type="number" min="1" step="1" value={form.totalItems} onChange={(e) => setForm((f)=>({...f,totalItems:e.target.value}))} className="field-input"/></Field></div>}
    {editing.domain === 'nutrition' && <><div className="grid gap-3 sm:grid-cols-3"><Field label="Sex used by tool"><select required value={form.sex} onChange={(e)=>setForm((f)=>({...f,sex:e.target.value as FormState['sex']}))} className="field-input"><option value="">Select</option><option value="male">Male</option><option value="female">Female</option></select></Field><Field label="Date of birth"><input required type="date" value={form.dateOfBirth} onChange={(e)=>setForm((f)=>({...f,dateOfBirth:e.target.value}))} className="field-input"/></Field><Field label="Age at assessment"><div className="field-input bg-slate-50 text-slate-600">{months === null ? '—' : `${months} months`}</div></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Measured height (cm)"><input required type="number" min="50" max="230" step="0.1" value={form.heightCm} onChange={(e)=>setForm((f)=>({...f,heightCm:e.target.value}))} className="field-input"/></Field><Field label="Measured weight (kg)"><input required type="number" min="5" max="250" step="0.1" value={form.weightKg} onChange={(e)=>setForm((f)=>({...f,weightKg:e.target.value}))} className="field-input"/></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="BMI-for-age z-score from approved tool"><input required type="number" min="-10" max="10" step="0.01" value={form.bmiZ} onChange={(e)=>setForm((f)=>({...f,bmiZ:e.target.value}))} className="field-input"/></Field><Field label="Height-for-age z-score from approved tool"><input required type="number" min="-10" max="10" step="0.01" value={form.hfaZ} onChange={(e)=>setForm((f)=>({...f,hfaZ:e.target.value}))} className="field-input"/></Field></div><div className="grid gap-3 rounded-xl border border-teal-100 bg-teal-50 p-3 text-sm sm:grid-cols-3"><div><p className="text-xs text-teal-700">Calculated BMI</p><p className="font-bold text-teal-950">{bmi ? bmi.toFixed(2) : '—'}</p></div><div><p className="text-xs text-teal-700">BMI-for-age status</p><p className="font-bold text-teal-950">{Number.isFinite(bmiZ) && form.bmiZ !== '' ? assessmentLabel(nutritionStatusFromZScore(bmiZ)) : '—'}</p></div><div><p className="text-xs text-teal-700">Height-for-age status</p><p className="font-bold text-teal-950">{Number.isFinite(hfaZ) && form.hfaZ !== '' ? assessmentLabel(heightStatusFromZScore(hfaZ)) : '—'}</p></div></div></>}
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Assessment date"><input required type="date" value={form.assessmentDate} onChange={(e)=>setForm((f)=>({...f,assessmentDate:e.target.value}))} className="field-input"/></Field><Field label="Official tool / scoresheet version"><input required minLength={3} maxLength={120} value={form.instrumentVersion} onChange={(e)=>setForm((f)=>({...f,instrumentVersion:e.target.value}))} className="field-input"/></Field></div>
    <Field label="Note for parent/guardian (optional)"><textarea maxLength={1000} rows={3} value={form.notes} onChange={(e)=>setForm((f)=>({...f,notes:e.target.value}))} placeholder="This note will be visible in the family app." className="field-input resize-none"/></Field>
    <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><input required type="checkbox" checked={form.verified} onChange={(e)=>setForm((f)=>({...f,verified:e.target.checked}))} className="mt-0.5 h-4 w-4"/><span>I confirm that I administered the official instrument and copied these results from its current scoresheet or approved nutritional tool.</span></label>
    <div className="flex justify-end gap-3 border-t border-slate-100 pt-4"><button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100">Cancel</button><button disabled={saving} className="rounded-xl bg-primary px-5 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50">{saving ? 'Saving…' : 'Save official result'}</button></div>
  </form></div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">{label}</span>{children}</label>; }
