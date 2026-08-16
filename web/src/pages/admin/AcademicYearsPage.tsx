import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, X, CheckCircle2, CalendarRange, RotateCcw, ShieldCheck, Archive, Download, FileSpreadsheet } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear } from '../../contexts/AcademicYearContext';
import { useToast } from '../../contexts/ToastContext';
import type { AcademicYear } from '../../types';
import { downloadCsv, downloadExcel, type ExportColumn } from '../../lib/export';

export default function AcademicYearsPage() {
  const { user } = useAuth();
  const { years, refetch } = useAcademicYear();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<AcademicYear | null>(null);
  const [form, setForm] = useState({ name: '', start_date: '', end_date: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function openCreate() {
    setEditing(null);
    const currentYear = new Date().getFullYear();
    const startYear = new Date().getMonth() >= 5 ? currentYear : currentYear - 1;
    setForm({
      name: `${startYear}-${startYear + 1}`,
      start_date: `${startYear}-06-01`,
      end_date: `${startYear + 1}-03-31`,
    });
    setError('');
    setShowModal(true);
  }

  function openEdit(year: AcademicYear) {
    setEditing(year);
    setForm({ name: year.name, start_date: year.start_date, end_date: year.end_date });
    setError('');
    setShowModal(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');

    if (form.start_date >= form.end_date) {
      setError('Start date must be before end date.');
      setSaving(false);
      return;
    }

    const schoolId = user!.school_id!;
    const isFirst = years.length === 0;
    const result = editing
      ? await supabase.from('academic_years').update(form).eq('id', editing.id).eq('school_id', schoolId)
      : await supabase.from('academic_years').insert({
          ...form,
          school_id: schoolId,
          is_current: isFirst,
          status: isFirst ? 'active' : 'draft',
        });

    if (result.error) {
      setError(result.error.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    setShowModal(false);
    await refetch();
    showToast(editing ? 'Academic year updated successfully.' : 'Academic year created successfully.');
  }

  async function archiveYear(year: AcademicYear) {
    if (!confirm(`Archive ${year.name}? Its reports will remain available.`)) return;
    const { error: archiveError } = await supabase.rpc('archive_academic_year', { p_year_id: year.id });
    if (archiveError) { showToast(archiveError.message, 'error'); return; }
    await refetch();
    showToast(`${year.name} archived.`);
  }

  const exportColumns: ExportColumn<AcademicYear>[] = [
    { header: 'Academic Year', value: (year) => year.name, width: 18 },
    { header: 'Start Date', value: (year) => formatDate(year.start_date), width: 20 },
    { header: 'End Date', value: (year) => formatDate(year.end_date), width: 20 },
    { header: 'Status', value: (year) => year.status ?? (year.is_current ? 'Active' : 'Legacy'), width: 14 },
    { header: 'Current Year', value: (year) => year.is_current ? 'Yes' : 'No', width: 14 },
    { header: 'Created', value: (year) => year.created_at ? new Date(year.created_at).toLocaleDateString('en-PH') : '', width: 16 },
  ];
  const exportOptions = {
    title: 'Academic Year Registry',
    subtitle: 'Official school-year containers and lifecycle status',
    metadata: [
      { label: 'Total years', value: years.length },
      { label: 'Current year', value: years.find((year) => year.is_current)?.name ?? 'None' },
    ],
    generatedBy: user?.full_name,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Academic Years</h2>
          <p className="mt-1 text-sm text-slate-500">Create year containers here, then use the audited workflow to finalize and activate them.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => downloadCsv('academic-year-registry', years, exportColumns, exportOptions)} disabled={!years.length} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Download size={16} /> CSV</button>
          <button onClick={() => downloadExcel('academic-year-registry', 'Academic Years', years, exportColumns, exportOptions)} disabled={!years.length} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><FileSpreadsheet size={16} /> Excel</button>
          {years.length >= 2 && (
            <button onClick={() => navigate('/admin/year-end')} className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600">
              <RotateCcw size={16} /> Open Year-End Workflow
            </button>
          )}
          <button onClick={openCreate} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark">
            <Plus size={16} /> Add Academic Year
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
        <WorkflowStep number="1" title="Create a draft year" text="Set the next school-year dates without changing the active year." />
        <WorkflowStep number="2" title="Review student outcomes" text="Resolve promotion, retention, graduation, and school-leaver decisions." />
        <WorkflowStep number="3" title="Finalize and activate" text="Apply one audited transaction, then deliberately switch all portals." />
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <ShieldCheck size={18} className="mt-0.5 shrink-0" />
        <p>Academic years are permanent historical containers. Official years cannot be deleted; closed years remain available for reports and exports.</p>
      </div>

      {years.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
          <CalendarRange size={48} className="mx-auto mb-3 text-slate-300" />
          <h3 className="text-lg font-semibold text-slate-700">No academic years yet</h3>
          <p className="mx-auto mt-1 mb-4 max-w-md text-sm text-slate-500">Create the first academic year to organize enrollments, schedules, grades, and attendance.</p>
          <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white"><Plus size={16} /> Create first year</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {years.map((year) => (
            <div key={year.id} className={`rounded-xl border-2 bg-white p-5 ${year.is_current ? 'border-primary shadow-md shadow-primary/10' : 'border-slate-200'}`}>
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-800">{year.name}</h3>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {year.is_current && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"><CheckCircle2 size={12} /> Current</span>}
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold capitalize text-slate-600">{year.status ?? (year.is_current ? 'active' : 'legacy')}</span>
                  </div>
                </div>
                {year.status !== 'closed' && year.status !== 'archived' && <button onClick={() => openEdit(year)} className="p-1 text-slate-400 hover:text-primary" aria-label={`Edit ${year.name}`}><Pencil size={16} /></button>}
              </div>
              <div className="space-y-1 text-sm text-slate-500">
                <p>Start: <span className="font-medium text-slate-700">{formatDate(year.start_date)}</span></p>
                <p>End: <span className="font-medium text-slate-700">{formatDate(year.end_date)}</span></p>
              </div>
              {!year.is_current && <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">Activation is available only through the Year-End Workflow.</p>}
              {year.status === 'closed' && <button onClick={() => archiveYear(year)} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700"><Archive size={13} /> Archive closed year</button>}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 p-5"><h3 className="text-lg font-semibold text-slate-800">{editing ? 'Edit academic year' : 'Add academic year'}</h3><button onClick={() => setShowModal(false)} className="text-slate-400"><X size={20} /></button></div>
            <form onSubmit={handleSubmit} className="space-y-4 p-5">
              {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>}
              <label className="block text-sm font-medium text-slate-700">Year name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2.5" placeholder="2026-2027" /></label>
              <div className="grid grid-cols-2 gap-4">
                <label className="block text-sm font-medium text-slate-700">Start date<input type="date" required value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label>
                <label className="block text-sm font-medium text-slate-700">End date<input type="date" required value={form.end_date} onChange={(event) => setForm({ ...form, end_date: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label>
              </div>
              <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowModal(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button><button type="submit" disabled={saving} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkflowStep({ number, title, text }: { number: string; title: string; text: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white px-4 py-3"><div className="mb-2 flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">{number}</span><p className="font-semibold text-slate-700">{title}</p></div><p className="text-slate-500">{text}</p></div>;
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
