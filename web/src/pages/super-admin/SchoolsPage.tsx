import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import { useCachedState, hasCached } from '../../lib/pageCache';
import { useToast } from '../../contexts/ToastContext';
import type { School } from '../../types';
import { Plus, Pencil, X } from 'lucide-react';

type SchoolWithParentFee = School & {
  parentMonthlyPrice: number | null;
};

type SchoolRow = School & {
  parent_access_billing_settings:
    | { monthly_price: number | string }
    | { monthly_price: number | string }[]
    | null;
};

const emptyForm = { name: '', depedSchoolId: '', address: '', monthlyPrice: '' };

export default function SchoolsPage() {
  const { showToast } = useToast();
  const [schools, setSchools] = useCachedState<SchoolWithParentFee[]>('sa-schools', []);
  const [loading, setLoading] = useState(!hasCached('sa-schools'));
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<School | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSchools();
  }, []);

  useRealtimeRefresh(['schools'], fetchSchools);

  async function fetchSchools() {
    const { data, error } = await supabase
      .from('schools')
      .select('*, parent_access_billing_settings(monthly_price)')
      .order('created_at', { ascending: false });
    if (error) {
      showToast(error.message, 'error');
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as SchoolRow[];
    setSchools(rows.map((row) => {
      const { parent_access_billing_settings, ...school } = row;
      const settings = Array.isArray(parent_access_billing_settings)
        ? parent_access_billing_settings[0]
        : parent_access_billing_settings;
      return {
        ...school,
        parentMonthlyPrice: settings ? Number(settings.monthly_price) : null,
      };
    }));
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setShowModal(true);
  }

  function openEdit(school: SchoolWithParentFee) {
    setEditing(school);
    setForm({
      name: school.name,
      depedSchoolId: school.deped_school_id ?? '',
      address: school.address,
      monthlyPrice: school.parentMonthlyPrice?.toString() ?? '',
    });
    setShowModal(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const depedSchoolId = form.depedSchoolId.trim();
    if (!/^\d{6}$/.test(depedSchoolId)) {
      showToast('DepEd School ID must contain exactly 6 digits.', 'error');
      return;
    }
    const monthlyPrice = Number(form.monthlyPrice);
    if (!Number.isFinite(monthlyPrice) || monthlyPrice <= 0 || monthlyPrice > 999999.99) {
      showToast('Enter a valid monthly parent fee greater than ₱0.', 'error');
      return;
    }
    setSaving(true);

    const { error } = editing
      ? await supabase.rpc('update_school_with_parent_billing', {
          p_school_id: editing.id,
          p_name: form.name,
          p_deped_school_id: depedSchoolId,
          p_address: form.address,
          p_monthly_price: monthlyPrice,
        })
      : await supabase.rpc('create_school_with_parent_billing', {
          p_name: form.name,
          p_deped_school_id: depedSchoolId,
          p_address: form.address,
          p_monthly_price: monthlyPrice,
        });

    setSaving(false);
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    setShowModal(false);
    await fetchSchools();
    showToast(editing ? 'School updated successfully.' : 'School added successfully.');
  }

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Schools</h2>
        <button onClick={openCreate} className="bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors cursor-pointer">
          <Plus size={16} /> Add School
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Name</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">DepEd School ID</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Address</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Monthly Parent Fee</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Created</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase w-24">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {schools.map((school) => (
              <tr key={school.id} className="hover:bg-slate-50">
                <td className="px-6 py-4 text-sm font-medium text-slate-800">{school.name}</td>
                <td className="px-6 py-4 text-sm font-semibold tabular-nums text-slate-700">{school.deped_school_id || <span className="font-normal text-amber-600">Not configured</span>}</td>
                <td className="px-6 py-4 text-sm text-slate-600">{school.address}</td>
                <td className="px-6 py-4 text-sm font-semibold text-slate-700">
                  {school.parentMonthlyPrice === null
                    ? <span className="font-normal text-amber-600">Not configured</span>
                    : `₱${school.parentMonthlyPrice.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </td>
                <td className="px-6 py-4 text-sm text-slate-500">{new Date(school.created_at).toLocaleDateString()}</td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <button onClick={() => openEdit(school)} className="text-slate-400 hover:text-primary cursor-pointer"><Pencil size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {schools.length === 0 && (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-400">No schools yet. Click "Add School" to create one.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-800">{editing ? 'Edit School' : 'Add School'}</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">School Name</label>
                <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">DepEd School ID</label>
                <input type="text" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={form.depedSchoolId} onChange={(e) => setForm({ ...form, depedSchoolId: e.target.value.replace(/\D/g, '').slice(0, 6) })} placeholder="e.g. 131747" className="w-full px-4 py-2.5 border border-slate-300 rounded-lg font-medium tracking-wider focus:ring-2 focus:ring-primary focus:border-primary outline-none" />
                <p className="mt-1.5 text-xs text-slate-500">The official 6-digit ID printed on DepEd forms. It must be unique and is used to verify SF1 imports.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
                <input type="text" required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Monthly Parent Fee</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">₱</span>
                  <input
                    type="number"
                    required
                    min="0.01"
                    max="999999.99"
                    step="0.01"
                    inputMode="decimal"
                    value={form.monthlyPrice}
                    onChange={(e) => setForm({ ...form, monthlyPrice: e.target.value })}
                    placeholder="Enter the amount"
                    className="w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-4 outline-none focus:border-primary focus:ring-2 focus:ring-primary"
                  />
                </div>
                <p className="mt-1.5 text-xs text-slate-500">Charged per student each month. This amount appears in teacher collections and revenue reports.</p>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-dark rounded-lg transition-colors disabled:opacity-50 cursor-pointer">{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
