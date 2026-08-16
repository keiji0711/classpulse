import { useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, BookOpenCheck, LoaderCircle, UserPlus, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import type { AcademicYear, Section } from '../types';

interface Props {
  sections: Section[];
  activeYear: AcademicYear;
  onClose: () => void;
  onAdded: () => Promise<void> | void;
}

interface FormState {
  sectionId: string;
  lrn: string;
  firstName: string;
  middleName: string;
  lastName: string;
  guardianName: string;
  phoneNumber: string;
}

export default function ManualStudentModal({ sections, activeYear, onClose, onAdded }: Props) {
  const { showToast } = useToast();
  const [form, setForm] = useState<FormState>({
    sectionId: sections[0]?.id ?? '',
    lrn: '', firstName: '', middleName: '', lastName: '', guardianName: '', phoneNumber: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selectedSection = useMemo(() => sections.find((section) => section.id === form.sectionId), [form.sectionId, sections]);
  const valid = form.sectionId && /^\d{12}$/.test(form.lrn) && form.firstName.trim() && form.lastName.trim() && form.guardianName.trim();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    const { data, error: addError } = await supabase.rpc('add_advisory_student', {
      p_section_id: form.sectionId,
      p_academic_year_id: activeYear.id,
      p_lrn: form.lrn,
      p_first_name: form.firstName.trim(),
      p_middle_name: form.middleName.trim(),
      p_last_name: form.lastName.trim(),
      p_guardian_name: form.guardianName.trim(),
      p_phone_number: form.phoneNumber.trim(),
    });
    if (addError) {
      setError(addError.message || 'Could not add this student.');
      setSaving(false);
      return;
    }
    await onAdded();
    showToast((data as { created?: boolean } | null)?.created === false
      ? 'Existing learner enrolled in your advisory section.'
      : 'Student added to your advisory section.');
    setSaving(false);
    onClose();
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
    <form onSubmit={submit} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-primary"><UserPlus size={22} /></div><div><h2 className="font-bold text-slate-900">Add student manually</h2><p className="text-xs text-slate-500">Enroll one learner in your advisory class.</p></div></div>
        <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"><X size={20} /></button>
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800"><BookOpenCheck size={20} className="mt-0.5 shrink-0" /><div><p className="font-bold">Current school year: {activeYear.name}</p><p className="mt-0.5 text-xs leading-5 text-blue-700">Manual entry is best for one learner. Use Import SF1 when adding a whole class.</p></div></div>

        {error && <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><AlertCircle size={17} className="mt-0.5 shrink-0" /><span>{error}</span></div>}

        <label className="block"><FieldLabel required>Advisory section</FieldLabel><select required value={form.sectionId} onChange={(event) => update('sectionId', event.target.value)} className="field-input"><option value="">Select a section</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.grade_level} · {section.name}</option>)}</select></label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block"><FieldLabel required>Learner Reference Number (LRN)</FieldLabel><input required inputMode="numeric" autoComplete="off" maxLength={12} value={form.lrn} onChange={(event) => update('lrn', event.target.value.replace(/\D/g, '').slice(0, 12))} placeholder="12-digit LRN" className="field-input font-mono tracking-wide" /><span className={`mt-1 block text-xs ${form.lrn && form.lrn.length !== 12 ? 'text-amber-600' : 'text-slate-400'}`}>{form.lrn.length}/12 digits</span></label>
          <label className="block"><FieldLabel required>Last name</FieldLabel><input required maxLength={150} value={form.lastName} onChange={(event) => update('lastName', event.target.value)} placeholder="Dela Cruz" className="field-input" /></label>
          <label className="block"><FieldLabel required>First name</FieldLabel><input required maxLength={150} value={form.firstName} onChange={(event) => update('firstName', event.target.value)} placeholder="Juan" className="field-input" /></label>
          <label className="block"><FieldLabel>Middle name</FieldLabel><input maxLength={150} value={form.middleName} onChange={(event) => update('middleName', event.target.value)} placeholder="Optional" className="field-input" /></label>
        </div>

        <div className="border-t border-slate-100 pt-5"><h3 className="text-sm font-bold text-slate-900">Guardian information</h3><p className="mt-1 text-xs text-slate-500">The guardian name is required for parent login and student support. Contact number may be left blank.</p></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block"><FieldLabel required>Guardian full name</FieldLabel><input required maxLength={250} value={form.guardianName} onChange={(event) => update('guardianName', event.target.value)} placeholder="Parent or legal guardian" className="field-input" /></label>
          <label className="block"><FieldLabel>Contact number</FieldLabel><input inputMode="tel" maxLength={40} value={form.phoneNumber} onChange={(event) => update('phoneNumber', event.target.value)} placeholder="Optional" className="field-input" /></label>
        </div>

        {selectedSection && <div className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600"><strong className="text-slate-800">Enrollment destination:</strong> {selectedSection.grade_level} · {selectedSection.name}, {activeYear.name}</div>}
      </div>

      <div className="sticky bottom-0 flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6"><button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button><button type="submit" disabled={!valid || saving} className="inline-flex min-w-36 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50">{saving ? <><LoaderCircle size={17} className="animate-spin" />Adding...</> : <><UserPlus size={17} />Add student</>}</button></div>
    </form>
  </div>;
}

function FieldLabel({ children, required = false }: { children: React.ReactNode; required?: boolean }) {
  return <span className="mb-1.5 block text-sm font-semibold text-slate-700">{children}{required && <span className="ml-1 text-rose-500">*</span>}</span>;
}
