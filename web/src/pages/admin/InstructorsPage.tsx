import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import { useCachedState, hasCached } from '../../lib/pageCache';
import { ensureSupabaseSession } from '../../lib/ensureSupabaseSession';
import { invokeEdgeFunction } from '../../lib/invokeEdgeFunction';
import { getFunctionErrorMessage } from '../../lib/getFunctionErrorMessage';
import type { AppUser } from '../../types';
import { Download, FileSpreadsheet, KeyRound, Plus, Pencil, Trash2, X } from 'lucide-react';
import { downloadCsv, downloadExcel, type ExportColumn } from '../../lib/export';

export default function InstructorsPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [instructors, setInstructors] = useCachedState<AppUser[]>('admin-instructors', []);
  const [loading, setLoading] = useState(!hasCached('admin-instructors'));
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [form, setForm] = useState({ email: '', password: '', full_name: '', phone_number: '', address: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchInstructors();
  }, []);

  useRealtimeRefresh(['users'], fetchInstructors, { column: 'school_id', value: user?.school_id });

  async function fetchInstructors() {
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('school_id', user!.school_id!)
      .eq('role', 'instructor')
      .eq('account_status', 'active')
      .order('created_at', { ascending: false });
    setInstructors(data ?? []);
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setForm({ email: '', password: '', full_name: '', phone_number: '', address: '' });
    setError('');
    setShowModal(true);
  }

  function openEdit(inst: AppUser) {
    setEditing(inst);
    setForm({ email: inst.email, password: '', full_name: inst.full_name, phone_number: inst.phone_number || '', address: inst.address || '' });
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
        p_phone_number: form.phone_number.trim(),
        p_address: form.address.trim(),
        p_school_id: editing.school_id,
      });

      if (updateError) {
        setError(updateError.message);
        setSaving(false);
        return;
      }

      setSaving(false);
      setShowModal(false);
      setEditing(null);
      fetchInstructors();
      showToast('Teacher updated successfully.');
      return;
    }

    const normalizedEmail = form.email.trim().toLowerCase();

    const { data: existingInstructor, error: existingInstructorError } = await supabase
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingInstructorError) {
      setError(existingInstructorError.message);
      setSaving(false);
      return;
    }

    if (existingInstructor) {
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
      phone_number: form.phone_number,
      address: form.address,
      role: 'instructor',
      school_id: user!.school_id,
    });

    if (fnError || data?.error) {
      const message = data?.error ?? fnError ?? await getFunctionErrorMessage(fnError, 'Failed to create teacher');
      setError(message);
      setSaving(false);
      return;
    }

    setSaving(false);
    setShowModal(false);
    setForm({ email: '', password: '', full_name: '', phone_number: '', address: '' });
    fetchInstructors();
    showToast('Teacher added successfully.');
  }

  async function handleDelete(instructor: AppUser) {
    if (!confirm(`Deactivate teacher "${instructor.full_name}"? Their historical records will be preserved.`)) return;
    const { session, error: sessionError } = await ensureSupabaseSession();
    if (sessionError || !session) { showToast(sessionError ?? 'Session expired.', 'error'); return; }
    const { error } = await invokeEdgeFunction('manage-user-account', session.access_token, { user_id: instructor.id, action: 'deactivate' });
    if (error) { showToast(`Failed to deactivate: ${error}`, 'error'); return; }
    fetchInstructors();
    showToast('Teacher deactivated. Historical records were preserved.');
  }

  async function sendPasswordReset(instructor: AppUser) {
    if (!confirm(`Send a password reset link to ${instructor.email}?`)) return;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(instructor.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (resetError) showToast(resetError.message, 'error');
    else showToast(`Password reset link sent to ${instructor.email}.`);
  }

  const exportColumns: ExportColumn<AppUser>[] = [
    { header: 'Full Name', value: (row) => row.full_name },
    { header: 'Phone', value: (row) => row.phone_number || '' },
    { header: 'Address', value: (row) => row.address || '' },
    { header: 'Email', value: (row) => row.email },
    { header: 'Created At', value: (row) => new Date(row.created_at).toLocaleDateString() },
  ];

  function exportCsv() {
    downloadCsv('teachers', instructors, exportColumns);
  }

  function exportExcel() {
    downloadExcel('teachers', 'Teachers', instructors, exportColumns);
  }

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-slate-800">Teachers</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={exportCsv} disabled={instructors.length === 0} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer">
            <Download size={16} /> Export CSV
          </button>
          <button onClick={exportExcel} disabled={instructors.length === 0} className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer">
            <FileSpreadsheet size={16} /> Export Excel
          </button>
          <button onClick={openCreate} className="bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors cursor-pointer">
            <Plus size={16} /> Add Teacher
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Name</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Phone</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Address</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Email</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Created</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase w-20">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {instructors.map((inst) => (
              <tr key={inst.id} className="hover:bg-slate-50">
                <td className="px-6 py-4 text-sm font-medium text-slate-800">{inst.full_name}</td>
                <td className="px-6 py-4 text-sm text-slate-600">{inst.phone_number || '—'}</td>
                <td className="px-6 py-4 text-sm text-slate-600">{inst.address || '—'}</td>
                <td className="px-6 py-4 text-sm text-slate-600">{inst.email}</td>
                <td className="px-6 py-4 text-sm text-slate-500">{new Date(inst.created_at).toLocaleDateString()}</td>
                <td className="px-6 py-4 flex items-center gap-2">
                  <button onClick={() => openEdit(inst)} className="text-slate-400 hover:text-primary cursor-pointer" aria-label={`Edit ${inst.full_name}`}><Pencil size={16} /></button>
                  <button onClick={() => void sendPasswordReset(inst)} className="text-slate-400 hover:text-amber-600 cursor-pointer" aria-label={`Send password reset to ${inst.full_name}`} title="Send password reset link"><KeyRound size={16} /></button>
                  <button onClick={() => handleDelete(inst)} className="text-slate-400 hover:text-danger cursor-pointer" aria-label={`Delete ${inst.full_name}`}><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
            {instructors.length === 0 && (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-400">No teachers yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-800">{editing ? 'Edit Teacher' : 'Add Teacher'}</h3>
              <button onClick={() => { setShowModal(false); setEditing(null); }} className="text-slate-400 hover:text-slate-600 cursor-pointer" aria-label="Close"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {error && <div className="bg-red-50 text-red-600 rounded-lg p-3 text-sm">{error}</div>}

              {/* Step 1: Teacher Information */}
              <p className="text-sm font-medium text-slate-500">Teacher Information</p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                <input type="text" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none" placeholder="e.g. Juan Dela Cruz" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number</label>
                <input type="text" value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none" placeholder="e.g. 09171234567" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
                <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none" placeholder="e.g. 123 Main St, Quezon City" />
              </div>

              {!editing && (
                <>
                  <hr className="border-slate-200" />
                  <p className="text-sm font-medium text-slate-500">Account Credentials</p>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                    <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none" placeholder="e.g. teacher@school.edu" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
                    <input type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none" placeholder="Minimum 8 characters" />
                  </div>
                </>
              )}

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
