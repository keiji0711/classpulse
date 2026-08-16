import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileSpreadsheet, LoaderCircle, Upload, X, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  applyGuardianChoice,
  getSf1MatchChecks,
  parseSf1Workbook,
  validateSf1Row,
  type GuardianChoice,
  type Sf1ImportRow,
  type Sf1Workbook,
} from '../lib/sf1Import';
import type { AcademicYear, Section } from '../types';

type ExistingStatus = 'existing' | 'already_enrolled';

interface ImportResult {
  submitted: number;
  new_students: number;
  existing_students_enrolled: number;
  already_enrolled_skipped: number;
}

interface Props {
  sections: Section[];
  activeYear: AcademicYear;
  onClose: () => void;
  onImported: () => Promise<void> | void;
}

export default function Sf1ImportModal({ sections, activeYear, onClose, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? '');
  const [workbook, setWorkbook] = useState<Sf1Workbook | null>(null);
  const [rows, setRows] = useState<Sf1ImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [guardianChoice, setGuardianChoice] = useState<GuardianChoice>('father');
  const [existing, setExisting] = useState<Record<string, ExistingStatus>>({});
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [depedSchoolId, setDepedSchoolId] = useState('');
  const [schoolLoading, setSchoolLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void supabase
      .from('schools')
      .select('deped_school_id')
      .eq('id', sections[0]?.school_id ?? '')
      .single()
      .then(({ data, error: schoolError }) => {
        if (!active) return;
        if (schoolError) setError(schoolError.message);
        else setDepedSchoolId(data?.deped_school_id ?? '');
        setSchoolLoading(false);
      });
    return () => { active = false; };
  }, [sections]);

  const lrnCounts = useMemo(() => rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.lrn] = (counts[row.lrn] ?? 0) + 1;
    return counts;
  }, {}), [rows]);

  const rowErrors = useMemo(() => rows.map((row) => {
    const errors = validateSf1Row(row);
    if (row.lrn && lrnCounts[row.lrn] > 1) errors.push('Duplicate LRN in this file');
    return errors;
  }), [lrnCounts, rows]);
  const invalidCount = rowErrors.filter((errors) => errors.length > 0).length;
  const selectedSection = sections.find((section) => section.id === sectionId);
  const matchChecks = useMemo(() => workbook && selectedSection ? getSf1MatchChecks(workbook, {
    schoolId: depedSchoolId,
    schoolYear: activeYear.name,
    gradeLevel: selectedSection.grade_level,
    sectionName: selectedSection.name,
  }) : [], [activeYear.name, depedSchoolId, selectedSection, workbook]);
  const metadataMatches = matchChecks.length === 4 && matchChecks.every((check) => check.matches);

  async function checkExisting(parsedRows: Sf1ImportRow[]) {
    setChecking(true);
    setExisting({});
    try {
      const lrns = [...new Set(parsedRows.map((row) => row.lrn).filter(Boolean))];
      if (lrns.length === 0) return;
      const { data: students, error: studentError } = await supabase
        .from('students')
        .select('id, lrn')
        .in('lrn', lrns);
      if (studentError) throw studentError;

      const studentIds = (students ?? []).map((student) => student.id);
      let enrolledIds = new Set<string>();
      if (studentIds.length > 0) {
        const { data: enrollments, error: enrollmentError } = await supabase
          .from('student_enrollments')
          .select('student_id')
          .eq('academic_year_id', activeYear.id)
          .in('student_id', studentIds);
        if (enrollmentError) throw enrollmentError;
        enrolledIds = new Set((enrollments ?? []).map((enrollment) => enrollment.student_id));
      }

      setExisting(Object.fromEntries((students ?? []).map((student) => [
        student.lrn,
        enrolledIds.has(student.id) ? 'already_enrolled' : 'existing',
      ])));
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : 'Could not check existing learners.');
    } finally {
      setChecking(false);
    }
  }

  async function selectFile(file?: File) {
    if (!file) return;
    setError('');
    setResult(null);
    try {
      if (!/\.xlsx?$/i.test(file.name)) throw new Error('Choose an Excel .xls or .xlsx file.');
      const parsed = parseSf1Workbook(await file.arrayBuffer());
      const selectedRows = applyGuardianChoice(parsed.rows, guardianChoice);
      setWorkbook(parsed);
      setRows(selectedRows);
      setFileName(file.name);
      await checkExisting(selectedRows);
    } catch (parseError) {
      setWorkbook(null);
      setRows([]);
      setFileName('');
      setError(parseError instanceof Error ? parseError.message : 'Could not read the SF1 workbook.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function chooseGuardian(choice: GuardianChoice) {
    setGuardianChoice(choice);
    setRows((current) => applyGuardianChoice(current, choice));
  }

  function updateRow(index: number, changes: Partial<Sf1ImportRow>) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...changes } : row));
  }

  async function importStudents() {
    if (!sectionId || invalidCount > 0 || rows.length === 0 || !metadataMatches || importing) return;
    setImporting(true);
    setError('');
    const payload = rows.map((row) => ({
      lrn: row.lrn.trim(),
      first_name: row.firstName.trim(),
      middle_name: row.middleName.trim(),
      last_name: row.lastName.trim(),
      guardian_name: (row.guardianChoice === 'father' ? row.fatherName : row.motherName).trim(),
      phone_number: row.phoneNumber.trim(),
    }));
    const { data, error: importError } = await supabase.rpc('import_advisory_students', {
      p_section_id: sectionId,
      p_academic_year_id: activeYear.id,
      p_students: payload,
      p_source_school_id: workbook?.schoolId ?? '',
      p_source_school_year: workbook?.schoolYear ?? '',
      p_source_grade_level: workbook?.gradeLevel ?? '',
      p_source_section_name: workbook?.sectionName ?? '',
    });
    setImporting(false);
    if (importError) {
      setError(importError.message || 'The SF1 roster could not be imported.');
      return;
    }
    setResult(data as ImportResult);
    await onImported();
  }

  if (result) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
        <div className="w-full max-w-lg rounded-3xl bg-white p-8 text-center shadow-2xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700"><CheckCircle2 size={34} /></div>
          <h2 className="mt-5 text-2xl font-bold text-slate-900">SF1 import complete</h2>
          <p className="mt-2 text-sm text-slate-500">The roster was processed safely for {selectedSection?.grade_level} · {selectedSection?.name}.</p>
          <div className="mt-6 grid grid-cols-3 gap-3">
            <ResultStat label="New" value={result.new_students} />
            <ResultStat label="Re-enrolled" value={result.existing_students_enrolled} />
            <ResultStat label="Skipped" value={result.already_enrolled_skipped} />
          </div>
          <button type="button" onClick={onClose} className="mt-7 w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white transition hover:bg-primary-dark">Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-5">
      <div className="flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><FileSpreadsheet size={23} /></div>
            <div><h2 className="font-bold text-slate-900">Import students from SF1</h2><p className="text-xs text-slate-500">Upload, review, then confirm. The original file is not stored.</p></div>
          </div>
          <button type="button" onClick={onClose} disabled={importing} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"><X size={20} /></button>
        </div>

        <div className="overflow-y-auto p-5 sm:p-6">
          {error ? <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={18} className="mt-0.5 shrink-0" /><span>{error}</span></div> : null}
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1.3fr]">
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Assigned section</span><select value={sectionId} onChange={(event) => setSectionId(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">{sections.map((section) => <option key={section.id} value={section.id}>{section.grade_level} · {section.name}</option>)}</select></label>
            <div><span className="mb-1.5 block text-sm font-semibold text-slate-700">Default guardian</span><div className="grid grid-cols-2 rounded-xl border border-slate-300 p-1">{(['father', 'mother'] as const).map((choice) => <button key={choice} type="button" onClick={() => chooseGuardian(choice)} className={`rounded-lg px-3 py-2 text-sm font-semibold capitalize transition ${guardianChoice === choice ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{choice}</button>)}</div></div>
            <div><span className="mb-1.5 block text-sm font-semibold text-slate-700">SF1 workbook</span><input ref={inputRef} type="file" accept=".xls,.xlsx" onChange={(event) => void selectFile(event.target.files?.[0])} className="hidden" /><button type="button" onClick={() => inputRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/50 bg-teal-50 px-4 py-2.5 text-sm font-bold text-primary transition hover:bg-teal-100"><Upload size={17} />{fileName || 'Choose .xls or .xlsx'}</button></div>
          </div>

          {workbook ? (
            <>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600"><span><b>School:</b> {workbook.schoolName || 'Not detected'}</span><span><b>School year:</b> {workbook.schoolYear || 'Not detected'}</span><span><b>SF1 class:</b> {[workbook.gradeLevel, workbook.sectionName].filter(Boolean).join(' · ') || 'Not detected'}</span><span><b>Learners:</b> {rows.length}</span></div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {schoolLoading ? <div className="col-span-full flex items-center justify-center gap-2 rounded-xl border border-slate-200 p-4 text-sm text-slate-500"><LoaderCircle size={17} className="animate-spin" />Checking school configuration...</div> : matchChecks.map((check) => (
                  <div key={check.key} className={`rounded-xl border p-3 ${check.matches ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                    <div className="flex items-start gap-2">
                      {check.matches ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-700" /> : <XCircle size={18} className="mt-0.5 shrink-0 text-red-600" />}
                      <div className="min-w-0"><p className={`text-xs font-bold ${check.matches ? 'text-emerald-800' : 'text-red-700'}`}>{check.label}</p><p className="mt-1 truncate text-xs text-slate-600">SF1: {check.actual}</p><p className="truncate text-xs text-slate-500">Expected: {check.expected}</p><p className={`mt-1 text-[11px] ${check.matches ? 'text-emerald-700' : 'text-red-600'}`}>{check.message}</p></div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-[1260px] w-full text-left">
                  <thead className="sticky top-0 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3">SF1 row</th><th className="px-3 py-3">LRN</th><th className="px-3 py-3">Last name</th><th className="px-3 py-3">First name</th><th className="px-3 py-3">Middle name</th><th className="px-3 py-3">Guardian</th><th className="px-3 py-3">Contact</th><th className="px-3 py-3">Status</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">{rows.map((row, index) => {
                    const errors = rowErrors[index];
                    const status = existing[row.lrn];
                    const guardianAvailable = row.guardianChoice === 'father' ? row.fatherName : row.motherName;
                    return <tr key={`${row.sourceRow}-${index}`} className={errors.length ? 'bg-red-50/40' : ''}>
                      <td className="px-3 py-3 text-xs text-slate-400">{row.sourceRow}</td>
                      <td className="px-3 py-3"><input value={row.lrn} onChange={(event) => updateRow(index, { lrn: event.target.value.replace(/\D/g, '').slice(0, 12) })} className="w-32 rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-medium outline-none focus:border-primary" /></td>
                      <td className="px-3 py-3"><input value={row.lastName} onChange={(event) => updateRow(index, { lastName: event.target.value })} className="w-36 rounded-lg border border-slate-300 px-2.5 py-2 text-sm outline-none focus:border-primary" /></td>
                      <td className="px-3 py-3"><input value={row.firstName} onChange={(event) => updateRow(index, { firstName: event.target.value })} className="w-40 rounded-lg border border-slate-300 px-2.5 py-2 text-sm outline-none focus:border-primary" /></td>
                      <td className="px-3 py-3"><input value={row.middleName} onChange={(event) => updateRow(index, { middleName: event.target.value })} placeholder="Optional" className="w-36 rounded-lg border border-slate-300 px-2.5 py-2 text-sm outline-none focus:border-primary" /></td>
                      <td className="px-3 py-3"><select value={row.guardianChoice} onChange={(event) => updateRow(index, { guardianChoice: event.target.value as GuardianChoice })} className="w-64 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none focus:border-primary"><option value="father" disabled={!row.fatherName}>Father — {row.fatherName || 'Not listed'}</option><option value="mother" disabled={!row.motherName}>Mother — {row.motherName || 'Not listed'}</option></select>{!guardianAvailable ? <p className="mt-1 text-[11px] text-red-600">Guardian is not available</p> : null}</td>
                      <td className="px-3 py-3"><input value={row.phoneNumber} onChange={(event) => updateRow(index, { phoneNumber: event.target.value })} placeholder="No contact provided" className="w-40 rounded-lg border border-slate-300 px-2.5 py-2 text-sm outline-none focus:border-primary" /></td>
                      <td className="px-3 py-3">{errors.length ? <span className="text-xs font-semibold text-red-600" title={errors.join('; ')}>Needs review</span> : status === 'already_enrolled' ? <span className="text-xs font-semibold text-slate-500">Already enrolled · skip</span> : status === 'existing' ? <span className="text-xs font-semibold text-blue-700">Existing · enroll</span> : <span className="text-xs font-semibold text-emerald-700">Ready</span>}</td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            </>
          ) : <div className="mt-8 rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center"><FileSpreadsheet size={36} className="mx-auto text-slate-300" /><p className="mt-3 font-semibold text-slate-600">Choose a DepEd SF1 workbook to begin</p><p className="mt-1 text-sm text-slate-400">Learner rows and parent names will appear here for review.</p></div>}
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-xs text-slate-500">{rows.length ? !metadataMatches ? 'Import locked until the school, year, grade, and section all match.' : `${rows.length - invalidCount} ready · ${invalidCount} need review · ${Object.values(existing).filter((value) => value === 'already_enrolled').length} will be skipped` : 'Nothing is written until you confirm.'}</p>
          <div className="flex gap-3"><button type="button" onClick={onClose} disabled={importing} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button><button type="button" onClick={() => void importStudents()} disabled={!rows.length || invalidCount > 0 || !metadataMatches || schoolLoading || checking || importing} className="inline-flex min-w-40 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50">{checking || importing ? <LoaderCircle size={17} className="animate-spin" /> : <Upload size={17} />}{checking ? 'Checking...' : importing ? 'Importing...' : `Import ${rows.length} students`}</button></div>
        </div>
      </div>
    </div>
  );
}

function ResultStat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl bg-slate-50 px-3 py-4"><p className="text-2xl font-bold text-slate-900">{value}</p><p className="mt-1 text-xs font-semibold text-slate-500">{label}</p></div>;
}
