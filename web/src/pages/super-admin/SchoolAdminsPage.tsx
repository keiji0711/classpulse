import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import { useCachedState, hasCached } from '../../lib/pageCache';
import { ensureSupabaseSession } from '../../lib/ensureSupabaseSession';
import { invokeEdgeFunction } from '../../lib/invokeEdgeFunction';
import { getFunctionErrorMessage } from '../../lib/getFunctionErrorMessage';
import { useToast } from '../../contexts/ToastContext';
import type { AppUser, School } from '../../types';
import { Plus, Pencil, Trash2, X } from 'lucide-react';

export default function SchoolAdminsPage() {
  const { showToast } = useToast();
  const [admins, setAdmins] = useCachedState<(AppUser & { school?: School })[]>('sa-admins', []);
  const [schools, setSchools] = useCachedState<School[]>('sa-admins-schools', []);
  const [loading, setLoading] = useState(!hasCached('sa-admins'));
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [form, setForm] = useState({ email: '', password: '', full_name: '', school_id: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  useRealtimeRefresh(['users', 'schools'], fetchData);

  async function fetchData() {
    const [adminsRes, schoolsRes] = await Promise.all([
      supabase.from('users').select('*, school:schools!users_school_id_fkey(*)').eq('role', 'school_admin').eq('account_status', 'active').order('created_at', { ascending: false }),
      supabase.from('schools').select('*').order('name'),
    ]);
    setAdmins((adminsRes.data as any) ?? []);
    setSchools(schoolsRes.data ?? []);
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setForm({ email: '', password: '', full_name: '', school_id: schools[0]?.id ?? '' });
    setError('');
    setShowModal(true);
  }

  function openEdit(admin: AppUser & { school?: School }) {
    setEditing(admin);
    setForm({ email: admin.email, password: '', full_name: admin.full_name, school_id: admin.school_id || '' });
    setError('');
    setShowModal(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');

    if (editing) {
      const { error: updateError } = await supabase.rpc('update_user_profile', {
        p_user_id: editing.id,
        p_full_name: form.full_name.trim(),
        p_phone_number: editing.phone_number ?? '',
        p_address: editing.address ?? '',
        p_school_id: form.school_id || null,
      });

      if (updateError) {
        setError(updateError.message);
        setSaving(false);
        return;
      }

      setSaving(false);
      setShowModal(false);
      setEditing(null);
      fetchData();
      showToast('School admin updated successfully.');
      return;
    }

    const normalizedEmail = form.email.trim().toLowerCase();

    const { data: existingAdmin, error: existingAdminError } = await supabase
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingAdminError) {
      setError(existingAdminError.message);
      setSaving(false);
      return;
    }

    if (existingAdmin) {
      setError('That email is already being used by another account. Please use a different email.');
      setSaving(false);
      return;
    }

    const { session, error: sessionError } = await ensureSupabaseSession();
    if (sessionError || !session) {
      setError(sessionError ?? 'Your session expired. Please sign out and sign in again.');
      setSaving(false);
      return;
    }

    const { data, error: fnError } = await invokeEdgeFunction<{ error?: string }>('create-user', session.access_token, {
      email: normalizedEmail,
      password: form.password,
      full_name: form.full_name.trim(),
      role: 'school_admin',
      school_id: form.school_id,
    });

    if (fnError || data?.error) {
      const message = data?.error ?? fnError ?? await getFunctionErrorMessage(fnError, 'Failed to create school admin');
      setError(message);
      setSaving(false);
      return;
    }

    setSaving(false);
    setShowModal(false);
    setForm({ email: '', password: '', full_name: '', school_id: schools[0]?.id ?? '' });
    fetchData();
    showToast('School admin created successfully.');
  }

  async function handleDelete(admin: AppUser) {
    if (!confirm(`Deactivate school admin "${admin.full_name}"? Historical records will be preserved.`)) return;
    const { session, error: sessionError } = await ensureSupabaseSession();
    if (sessionError || !session) { showToast(sessionError ?? 'Session expired.', 'error'); return; }
    const { error } = await invokeEdgeFunction('manage-user-account', session.access_token, { user_id: admin.id, action: 'deactivate' });
    if (error) { showToast(`Failed to deactivate: ${error}`, 'error'); return; }
    fetchData();
    showToast('School admin deactivated. Historical records were preserved.');
  }

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-800">School Admins</h2>
        <button onClick={openCreate} className="bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors cursor-pointer">
          <Plus size={16} /> Add School Admin
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Name</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Email</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">School</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase w-20">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {admins.map((admin) => (
              <tr key={admin.id} className="hover:bg-slate-50">
                <td className="px-6 py-4 text-sm font-medium text-slate-800">{admin.full_name}</td>
                <td className="px-6 py-4 text-sm text-slate-600">{admin.email}</td>
                <td className="px-6 py-4 text-sm text-slate-600">{(admin as any).school?.name ?? '—'}</td>
                <td className="px-6 py-4 flex items-center gap-2">
                  <button onClick={() => openEdit(admin)} className="text-slate-400 hover:text-primary cursor-pointer" aria-label={`Edit ${admin.full_name}`}><Pencil size={16} /></button>
                  <button onClick={() => handleDelete(admin)} className="text-slate-400 hover:text-danger cursor-pointer" aria-label={`Delete ${admin.full_name}`}><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
            {admins.length === 0 && (
              <tr><td colSpan={4} className="px-6 py-8 text-center text-slate-400">No school admins yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-800">{editing ? 'Edit School Admin' : 'Add School Admin'}</h3>
              <button onClick={() => { setShowModal(false); setEditing(null); }} className="text-slate-400 hover:text-slate-600 cursor-pointer" aria-label="Close"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {error && <div className="bg-red-50 text-red-600 rounded-lg p-3 text-sm">{error}</div>}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                <input type="text" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none" />
              </div>
              {!editing && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                    <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
                    <input type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none" placeholder="Minimum 8 characters" />
                  </div>
                </>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Assign to School</label>
                <select required value={form.school_id} onChange={(e) => setForm({ ...form, school_id: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none">
                  <option value="">Select a school</option>
                  {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setShowModal(false); setEditing(null); }} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-dark rounded-lg transition-colors disabled:opacity-50 cursor-pointer">{saving ? (editing ? 'Saving...' : 'Creating...') : (editing ? 'Save Changes' : 'Create')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
