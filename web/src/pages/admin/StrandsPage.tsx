import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import { useCachedState, hasCached } from '../../lib/pageCache';
import type { Strand } from '../../types';
import { Download, FileSpreadsheet, Plus, Pencil, Trash2, X } from 'lucide-react';
import { downloadCsv, downloadExcel, type ExportColumn } from '../../lib/export';

export default function StrandsPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [strands, setStrands] = useCachedState<Strand[]>('admin-strands', []);
  const [loading, setLoading] = useState(!hasCached('admin-strands'));
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Strand | null>(null);
  const [form, setForm] = useState({ name: '', code: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchStrands(); }, []);

  useRealtimeRefresh(['strands'], fetchStrands, { column: 'school_id', value: user?.school_id });

  async function fetchStrands() {
    const { data } = await supabase.from('strands').select('*').eq('school_id', user!.school_id!).order('name');
    setStrands(data ?? []);
    setLoading(false);
  }

  function openCreate() { setEditing(null); setForm({ name: '', code: '' }); setShowModal(true); }
  function openEdit(s: Strand) { setEditing(s); setForm({ name: s.name, code: s.code }); setShowModal(true); }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    if (editing) {
      await supabase.from('strands').update({ name: form.name, code: form.code }).eq('id', editing.id);
    } else {
      await supabase.from('strands').insert({ name: form.name, code: form.code, school_id: user!.school_id! });
    }
    setSaving(false);
    setShowModal(false);
    fetchStrands();
    showToast(editing ? 'Strand updated successfully.' : 'Strand added successfully.');
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this strand? Sections using it will have their strand unset.')) return;
    const { error } = await supabase.from('strands').delete().eq('id', id);
    if (error) { showToast(`Failed to delete: ${error.message}`, 'error'); return; }
    fetchStrands();
    showToast('Strand deleted.');
  }

  const exportColumns: ExportColumn<Strand>[] = [
    { header: 'Code', value: (row) => row.code },
    { header: 'Name', value: (row) => row.name },
  ];

  function exportCsv() {
    downloadCsv('strands', strands, exportColumns);
  }

  function exportExcel() {
    downloadExcel('strands', 'Strands', strands, exportColumns);
  }

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Strands</h2>
          <p className="text-sm text-slate-500 mt-1">Senior High School strands (e.g. STEM, ABM, GAS, TVL, HUMSS)</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={exportCsv} disabled={strands.length === 0} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer">
            <Download size={16} /> Export CSV
          </button>
          <button onClick={exportExcel} disabled={strands.length === 0} className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer">
            <FileSpreadsheet size={16} /> Export Excel
          </button>
          <button onClick={openCreate} className="bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors cursor-pointer"><Plus size={16} /> Add Strand</button>
        </div>
      </div>
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Code</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Name</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase w-24">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {strands.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-6 py-4 text-sm font-medium text-slate-800">{s.code}</td>
                <td className="px-6 py-4 text-sm text-slate-600">{s.name}</td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <button onClick={() => openEdit(s)} className="text-slate-400 hover:text-primary cursor-pointer"><Pencil size={16} /></button>
                    <button onClick={() => handleDelete(s.id)} className="text-slate-400 hover:text-danger cursor-pointer"><Trash2 size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {strands.length === 0 && <tr><td colSpan={3} className="px-6 py-8 text-center text-slate-400">No strands yet. Add strands like STEM, ABM, GAS, TVL, HUMSS.</td></tr>}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-800">{editing ? 'Edit Strand' : 'Add Strand'}</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Code</label>
                <input type="text" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none" placeholder="e.g. STEM" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none" placeholder="e.g. Science, Technology, Engineering, and Mathematics" />
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
