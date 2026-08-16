import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, Lock, RefreshCw, Rocket, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear } from '../../contexts/AcademicYearContext';
import { useToast } from '../../contexts/ToastContext';
import type { Section } from '../../types';
import { buildSuggestedDecision, getNextGrade, validateYearEndDecisions, type YearEndDecision as Decision, type YearEndOutcome as Outcome } from '../../lib/schoolYearWorkflow';

type ReviewStudent = {
  enrollment_id: string;
  student_id: string;
  name: string;
  lrn: string;
  section_id: string;
  section_name: string;
  grade_level: string;
};

type RolloverBatch = {
  id: string;
  source_year_id: string;
  target_year_id: string;
  status: 'processing' | 'finalized' | 'activated' | 'failed';
  summary: Record<string, number>;
};

const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: 'promoted', label: 'Promoted' },
  { value: 'retained', label: 'Retained' },
  { value: 'graduated', label: 'Graduated' },
  { value: 'transferred', label: 'Transferred out' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'dropped', label: 'Dropped' },
  { value: 'pending', label: 'Pending review' },
];

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export default function YearEndWorkflowPage() {
  const { user } = useAuth();
  const { years, currentYear, setActiveYearId, refetch: refetchYears } = useAcademicYear();
  const { showToast } = useToast();
  const [targetYearId, setTargetYearId] = useState('');
  const [students, setStudents] = useState<ReviewStudent[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [batch, setBatch] = useState<RolloverBatch | null>(null);
  const [missingGradeCells, setMissingGradeCells] = useState(0);
  const [openInterventions, setOpenInterventions] = useState(0);
  const [targetScheduleCount, setTargetScheduleCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [finalizing, setFinalizing] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState('');

  const sourceYear = currentYear;
  const targetOptions = useMemo(
    () => years.filter((year) => year.id !== sourceYear?.id && (!year.status || year.status === 'draft')),
    [years, sourceYear?.id],
  );
  const targetYear = years.find((year) => year.id === targetYearId) ?? null;

  useEffect(() => {
    if (targetYearId && targetOptions.some((year) => year.id === targetYearId)) return;
    setTargetYearId(targetOptions[0]?.id ?? '');
  }, [targetOptions, targetYearId]);

  useEffect(() => {
    if (!user?.school_id || !sourceYear?.id) return;
    void loadReview();
  }, [user?.school_id, sourceYear?.id, targetYearId]);

  async function loadReview() {
    const schoolId = user!.school_id!;
    const sourceYearId = sourceYear!.id;
    setLoading(true);
    setError('');

    const [enrollmentsRes, sectionsRes, subjectsRes, gradesRes, interventionsRes, batchRes, schedulesRes] = await Promise.all([
      supabase
        .from('student_enrollments')
        .select('id, student_id, section_id, student:students!inner(first_name, middle_name, last_name, lrn), section:sections!inner(name, grade_level)')
        .eq('school_id', schoolId)
        .eq('academic_year_id', sourceYearId)
        .order('last_name', { foreignTable: 'student' }),
      supabase.from('sections').select('*').eq('school_id', schoolId).order('grade_level').order('name'),
      supabase.from('section_subjects').select('section_id, subject_id').eq('school_id', schoolId),
      supabase.from('grades').select('student_id, subject_id, quarter').eq('school_id', schoolId).eq('academic_year_id', sourceYearId).lte('quarter', 3),
      supabase.from('attendance_interventions').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).in('status', ['pending', 'in_progress']),
      targetYearId
        ? supabase.from('school_year_rollover_batches').select('id, source_year_id, target_year_id, status, summary').eq('school_id', schoolId).eq('source_year_id', sourceYearId).eq('target_year_id', targetYearId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      targetYearId
        ? supabase.from('schedules').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('academic_year_id', targetYearId)
        : Promise.resolve({ count: 0, error: null }),
    ]);

    const firstError = [enrollmentsRes.error, sectionsRes.error, subjectsRes.error, gradesRes.error].find(Boolean);
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    const sectionRows = (sectionsRes.data ?? []) as Section[];
    const reviewRows: ReviewStudent[] = ((enrollmentsRes.data ?? []) as any[]).flatMap((enrollment) => {
      const student = relationOne(enrollment.student);
      const section = relationOne(enrollment.section);
      if (!student || !section) return [];
      return [{
        enrollment_id: enrollment.id,
        student_id: enrollment.student_id,
        name: `${student.last_name}, ${student.first_name}${student.middle_name ? ` ${student.middle_name.charAt(0)}.` : ''}`,
        lrn: student.lrn,
        section_id: enrollment.section_id,
        section_name: section.name,
        grade_level: section.grade_level,
      }];
    });

    const subjectsBySection = new Map<string, string[]>();
    for (const row of subjectsRes.data ?? []) {
      if (!subjectsBySection.has(row.section_id)) subjectsBySection.set(row.section_id, []);
      subjectsBySection.get(row.section_id)!.push(row.subject_id);
    }
    const recordedGradeKeys = new Set((gradesRes.data ?? []).map((grade) => `${grade.student_id}:${grade.subject_id}:${grade.quarter}`));
    let missing = 0;
    for (const student of reviewRows) {
      for (const subjectId of subjectsBySection.get(student.section_id) ?? []) {
        for (const quarter of [1, 2, 3]) {
          if (!recordedGradeKeys.has(`${student.student_id}:${subjectId}:${quarter}`)) missing++;
        }
      }
    }

    setStudents(reviewRows);
    setSections(sectionRows);
    setMissingGradeCells(missing);
    setOpenInterventions(interventionsRes.count ?? 0);
    setTargetScheduleCount(schedulesRes.count ?? 0);
    setBatch((batchRes.data as RolloverBatch | null) ?? null);
    setDecisions((existing) => {
      const next: Record<string, Decision> = {};
      for (const student of reviewRows) {
        if (existing[student.student_id]) {
          next[student.student_id] = existing[student.student_id];
          continue;
        }
        next[student.student_id] = buildSuggestedDecision(student.grade_level, sectionRows);
      }
      return next;
    });
    setLoading(false);
  }

  function updateDecision(student: ReviewStudent, updates: Partial<Decision>) {
    setDecisions((current) => {
      const previous = current[student.student_id] ?? { outcome: 'pending', target_section_id: '', notes: '' };
      const outcome = updates.outcome ?? previous.outcome;
      let targetSectionId = updates.target_section_id ?? previous.target_section_id;
      if (updates.outcome) {
        if (outcome === 'promoted') targetSectionId = sections.find((section) => section.grade_level === getNextGrade(student.grade_level))?.id ?? '';
        else if (outcome === 'retained') targetSectionId = sections.find((section) => section.grade_level === student.grade_level)?.id ?? student.section_id;
        else targetSectionId = '';
      }
      return { ...current, [student.student_id]: { ...previous, ...updates, outcome, target_section_id: targetSectionId } };
    });
  }

  const validation = useMemo(
    () => validateYearEndDecisions(students.map((student) => student.student_id), decisions, targetYearId),
    [students, decisions, targetYearId],
  );
  const canFinalize = validation.valid && missingGradeCells === 0;

  async function finalizeYear() {
    if (!sourceYear || !targetYear || !canFinalize || batch) return;
    if (!confirm(`Finalize ${sourceYear.name} into ${targetYear.name}? Student outcomes cannot be casually edited afterward.`)) return;
    setFinalizing(true);
    setError('');
    const payload = students.map((student) => ({ student_id: student.student_id, ...decisions[student.student_id] }));
    const { data, error: rpcError } = await supabase.rpc('finalize_school_year_rollover', {
      p_source_year_id: sourceYear.id,
      p_target_year_id: targetYear.id,
      p_decisions: payload,
      p_idempotency_key: crypto.randomUUID(),
    });
    if (rpcError) setError(rpcError.message);
    else {
      const result = data as { batch_id: string; status: RolloverBatch['status']; summary: Record<string, number> };
      setBatch({ id: result.batch_id, source_year_id: sourceYear.id, target_year_id: targetYear.id, status: result.status, summary: result.summary });
      showToast('Student outcomes finalized. Review the summary, then activate the new year.');
      await refetchYears();
      await loadReview();
    }
    setFinalizing(false);
  }

  async function activateNewYear() {
    if (!batch || batch.status !== 'finalized' || !targetYear) return;
    if (!confirm(`Activate ${targetYear.name}? The previous year will be closed and all portals will switch to the new year.`)) return;
    setActivating(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('activate_school_year_rollover', { p_batch_id: batch.id });
    if (rpcError) setError(rpcError.message);
    else {
      await refetchYears();
      setActiveYearId(targetYear.id);
      setBatch({ ...batch, status: 'activated' });
      showToast(`${targetYear.name} is now active.`);
    }
    setActivating(false);
  }

  if (!sourceYear) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-800">Create an active academic year before running year-end processing.</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Year-End Workflow</h2>
        <p className="mt-1 text-sm text-slate-500">Review every student outcome, finalize atomically, then activate the new academic year.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase text-slate-500">1. Source year</p><p className="mt-2 font-bold text-slate-800">{sourceYear.name}</p><p className="text-xs text-slate-500">{sourceYear.status ?? 'active'}</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><label className="text-xs font-semibold uppercase text-slate-500">2. Draft target year</label><select value={targetYearId} onChange={(event) => setTargetYearId(event.target.value)} disabled={Boolean(batch)} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">Select target</option>{targetOptions.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}</select></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase text-slate-500">3. Workflow status</p><p className="mt-2 font-bold text-slate-800">{batch?.status ?? 'Reviewing'}</p><p className="text-xs text-slate-500">{batch ? 'Audited rollover batch created' : 'No database changes applied yet'}</p></div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ReadinessCard label="Students reviewed" value={`${students.length - validation.pending}/${students.length}`} ok={validation.pending === 0} />
        <ReadinessCard label="Missing grade cells" value={String(missingGradeCells)} ok={missingGradeCells === 0} warning />
        <ReadinessCard label="Open interventions" value={String(openInterventions)} ok={openInterventions === 0} warning />
        <ReadinessCard label="Target schedules" value={String(targetScheduleCount)} ok={targetScheduleCount > 0} warning />
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {batch ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex items-start gap-3"><CheckCircle2 className="text-emerald-600" /><div><h3 className="font-bold text-emerald-900">Outcomes finalized</h3><p className="text-sm text-emerald-700">The source year is locked in closing status. Activate the target year when its setup is ready.</p></div></div>
          <div className="mt-4 flex flex-wrap gap-2">{Object.entries(batch.summary ?? {}).map(([label, count]) => <span key={label} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-emerald-800">{label}: {count}</span>)}</div>
          {batch.status === 'finalized' && <button onClick={activateNewYear} disabled={activating} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Rocket size={16} />{activating ? 'Activating...' : `Activate ${targetYear?.name ?? 'new year'}`}</button>}
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><h3 className="font-semibold text-slate-800">Student outcome review</h3><p className="text-xs text-slate-500">All students must have a resolved outcome.</p></div><button onClick={loadReview} className="inline-flex items-center gap-1 text-sm text-primary"><RefreshCw size={14} /> Refresh</button></div>
            {loading ? <div className="p-10 text-center text-sm text-slate-500">Loading review...</div> : <div className="max-h-[60vh] overflow-auto"><table className="w-full text-left"><thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Student</th><th className="px-4 py-3">Current placement</th><th className="px-4 py-3">Outcome</th><th className="px-4 py-3">Target section</th><th className="px-4 py-3">Notes</th></tr></thead><tbody className="divide-y divide-slate-100">{students.map((student) => { const decision = decisions[student.student_id]; const needsTarget = decision && ['promoted', 'retained'].includes(decision.outcome); const allowedSections = decision?.outcome === 'retained' ? sections.filter((section) => section.grade_level === student.grade_level) : sections.filter((section) => section.grade_level === getNextGrade(student.grade_level)); return <tr key={student.student_id}><td className="px-4 py-3"><p className="text-sm font-medium text-slate-800">{student.name}</p><p className="text-xs text-slate-500">{student.lrn}</p></td><td className="px-4 py-3 text-sm text-slate-600">{student.grade_level} - {student.section_name}</td><td className="px-4 py-3"><select value={decision?.outcome ?? 'pending'} onChange={(event) => updateDecision(student, { outcome: event.target.value as Outcome })} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">{OUTCOMES.map((outcome) => <option key={outcome.value} value={outcome.value}>{outcome.label}</option>)}</select></td><td className="px-4 py-3">{needsTarget ? <select value={decision.target_section_id} onChange={(event) => updateDecision(student, { target_section_id: event.target.value })} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"><option value="">Select section</option>{allowedSections.map((section) => <option key={section.id} value={section.id}>{section.grade_level} - {section.name}</option>)}</select> : <span className="text-xs text-slate-400">No next enrollment</span>}</td><td className="px-4 py-3"><input value={decision?.notes ?? ''} onChange={(event) => updateDecision(student, { notes: event.target.value })} placeholder="Optional" className="w-40 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" /></td></tr>; })}</tbody></table></div>}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-4"><div><h3 className="font-semibold text-slate-800">Finalization preview</h3><div className="mt-2 flex flex-wrap gap-2">{OUTCOMES.map((outcome) => <span key={outcome.value} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">{outcome.label}: {validation.counts[outcome.value]}</span>)}</div></div><button onClick={finalizeYear} disabled={!canFinalize || finalizing || !targetYear} className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><Lock size={16} />{finalizing ? 'Finalizing...' : 'Finalize outcomes'}</button></div>
            {!canFinalize && <p className="mt-3 flex items-center gap-2 text-sm text-amber-700"><AlertTriangle size={15} /> Resolve {validation.pending} pending student(s), {validation.missingTargets} missing target section(s), and {missingGradeCells} missing grade cell(s).</p>}
          </div>
        </>
      )}
    </div>
  );
}

function ReadinessCard({ label, value, ok, warning = false }: { label: string; value: string; ok: boolean; warning?: boolean }) {
  const color = ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : warning ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-red-200 bg-red-50 text-red-800';
  return <div className={`rounded-xl border p-4 ${color}`}><div className="flex items-center gap-2">{ok ? <CheckCircle2 size={16} /> : warning ? <AlertTriangle size={16} /> : <Users size={16} />}<p className="text-xs font-semibold uppercase">{label}</p></div><p className="mt-2 text-2xl font-bold">{value}</p></div>;
}
