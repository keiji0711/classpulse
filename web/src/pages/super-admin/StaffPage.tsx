import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { invokeEdgeFunction } from '../../lib/invokeEdgeFunction';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { PERMISSIONS, ROLE_PRESETS, ALL_PERMISSIONS, type PermissionKey } from '../../lib/permissions';
import { ShieldCheck, UserPlus, Trash2, Crown, X, KeyRound, Mail } from 'lucide-react';

interface StaffRow {
  id: string;
  full_name: string;
  email: string;
  permissions: string[] | null;
  is_platform_owner: boolean | null;
  created_at: string;
}

export default function StaffPage() {
  const { user, isPlatformOwner } = useAuth();
  const { showToast } = useToast();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<StaffRow | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('users')
      .select('id, full_name, email, permissions, is_platform_owner, created_at')
      .eq('role', 'super_admin')
      .eq('account_status', 'active')
      .order('is_platform_owner', { ascending: false })
      .order('created_at', { ascending: true });
    setStaff((data as StaffRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function call(body: Record<string, unknown>): Promise<boolean> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { showToast('Session expired. Sign in again.', 'error'); return false; }
    const { error } = await invokeEdgeFunction('manage-staff', session.access_token, body);
    if (error) { showToast(error, 'error'); return false; }
    return true;
  }

  async function remove(row: StaffRow) {
    if (!window.confirm(`Deactivate ${row.full_name}? Their audit history will be preserved.`)) return;
    if (await call({ action: 'remove', user_id: row.id })) {
      showToast('Staff member deactivated. Historical records were preserved.');
      load();
    }
  }

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <ShieldCheck size={22} className="text-primary" /> Staff &amp; Access (IAM)
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">Invite platform staff and control which modules each can access.</p>
        </div>
        {isPlatformOwner && (
          <button
            onClick={() => setShowAdd(true)}
            className="bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <UserPlus size={16} /> Add Staff
          </button>
        )}
      </div>

      {!isPlatformOwner && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3">
          You can view the team, but only platform owners can add or change staff access.
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase">Member</th>
              <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase">Access</th>
              <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {staff.map((s) => {
              const owner = s.is_platform_owner === true;
              const perms = s.permissions ?? [];
              const isSelf = s.id === user?.id;
              return (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">{s.full_name}</span>
                      {owner && <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded"><Crown size={10} /> Owner</span>}
                      {isSelf && <span className="text-[10px] text-slate-400">(you)</span>}
                    </div>
                    <div className="text-xs text-slate-400">{s.email}</div>
                  </td>
                  <td className="px-5 py-3">
                    {owner ? (
                      <span className="text-xs text-slate-500">Full access</span>
                    ) : perms.length === 0 ? (
                      <span className="text-xs text-slate-400">Dashboard only</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {perms.map((p) => (
                          <span key={p} className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded">
                            {PERMISSIONS.find((x) => x.key === p)?.label ?? p}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {isPlatformOwner && !owner && (
                        <>
                          <button onClick={() => setEditing(s)} className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer flex items-center gap-1">
                            <KeyRound size={12} /> Edit access
                          </button>
                          <button onClick={() => remove(s)} className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 cursor-pointer flex items-center gap-1">
                            <Trash2 size={12} /> Remove
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showAdd && <AddStaffModal onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); load(); }} call={call} showToast={showToast} />}
      {editing && <EditAccessModal row={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} call={call} showToast={showToast} />}
    </div>
  );
}

function PermissionGrid({ value, onChange }: { value: PermissionKey[]; onChange: (v: PermissionKey[]) => void }) {
  function toggle(key: PermissionKey) {
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {PERMISSIONS.map((p) => {
        const on = value.includes(p.key);
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => toggle(p.key)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm text-left transition-colors cursor-pointer ${
              on ? 'border-primary bg-primary/5 text-primary font-semibold' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? 'bg-primary border-primary' : 'border-slate-300'}`}>
              {on && <span className="w-2 h-2 bg-white rounded-sm" />}
            </span>
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function AddStaffModal({ onClose, onDone, call, showToast }: {
  onClose: () => void; onDone: () => void;
  call: (b: Record<string, unknown>) => Promise<boolean>; showToast: (m: string, t?: 'success' | 'error') => void;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [permissions, setPermissions] = useState<PermissionKey[]>([]);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!fullName.trim() || !email.trim() || password.length < 8) {
      showToast('Name, email, and an 8+ character password are required.', 'error');
      return;
    }
    setSaving(true);
    const ok = await call({ action: 'create', full_name: fullName.trim(), email: email.trim(), password, permissions });
    setSaving(false);
    if (ok) { showToast('Staff member created.'); onDone(); }
  }

  return (
    <ModalShell title="Add staff member" onClose={onClose}>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Full name</label>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-primary" placeholder="Jane Dela Cruz" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1"><Mail size={12} /> Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-primary" placeholder="jane@classpulse.app" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1"><KeyRound size={12} /> Temporary password</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-primary" placeholder="Min 8 characters" />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-xs font-medium text-slate-600">Access</label>
          <div className="flex gap-1">
            {ROLE_PRESETS.map((p) => (
              <button key={p.key} type="button" onClick={() => setPermissions([...p.permissions])} title={p.description}
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 cursor-pointer">
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <PermissionGrid value={permissions} onChange={setPermissions} />
        <p className="text-[11px] text-slate-400 mt-1.5">Dashboard &amp; their own Settings are always available. {permissions.length === ALL_PERMISSIONS.length && 'This grants full access.'}</p>
      </div>
      <button onClick={submit} disabled={saving} className="w-full bg-primary hover:bg-primary-dark text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 cursor-pointer">
        {saving ? 'Creating...' : 'Create staff member'}
      </button>
    </ModalShell>
  );
}

function EditAccessModal({ row, onClose, onDone, call, showToast }: {
  row: StaffRow; onClose: () => void; onDone: () => void;
  call: (b: Record<string, unknown>) => Promise<boolean>; showToast: (m: string, t?: 'success' | 'error') => void;
}) {
  const [permissions, setPermissions] = useState<PermissionKey[]>((row.permissions ?? []) as PermissionKey[]);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    const ok = await call({ action: 'update', user_id: row.id, permissions });
    setSaving(false);
    if (ok) { showToast('Access updated.'); onDone(); }
  }

  return (
    <ModalShell title={`Edit access — ${row.full_name}`} onClose={onClose}>
      <PermissionGrid value={permissions} onChange={setPermissions} />
      <button onClick={submit} disabled={saving} className="w-full bg-primary hover:bg-primary-dark text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 cursor-pointer">
        {saving ? 'Saving...' : 'Save access'}
      </button>
    </ModalShell>
  );
}
