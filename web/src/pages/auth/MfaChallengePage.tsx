import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import MfaSecurityPanel from '../../components/MfaSecurityPanel';
import type { UserRole } from '../../types';

const destinations: Record<UserRole, string> = { super_admin: '/super-admin', school_admin: '/admin', instructor: '/instructor' };

export default function MfaChallengePage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [factorId, setFactorId] = useState<string | null | undefined>(undefined);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactorId(data?.totp.find((factor) => factor.status === 'verified')?.id ?? null);
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  if (!user) return <Navigate to="/login" replace />;
  if (!['super_admin', 'school_admin'].includes(user.role)) return <Navigate to={destinations[user.role]} replace />;

  async function verify() {
    if (!factorId || code.length !== 6) return;
    setBusy(true); setError('');
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (verifyError) { setError(verifyError.message); return; }
    navigate(destinations[user!.role], { replace: true });
  }

  return <div className="min-h-screen app-grid px-4 py-10 flex items-center justify-center"><div className="glass-panel w-full max-w-lg rounded-3xl p-7">
    <div className="mb-6 flex items-start gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShieldCheck /></span><div><h1 className="text-xl font-bold text-slate-900">Administrator verification</h1><p className="mt-1 text-sm text-slate-500">A second factor protects sensitive school and student operations.</p></div></div>
    {factorId === undefined ? <div className="py-8 text-center text-sm text-slate-500">Checking account security…</div> : factorId === null ? <MfaSecurityPanel onEnabled={() => void load()} /> : <div>
      <label className="text-sm font-medium text-slate-700">Authenticator code</label>
      <input autoFocus value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={(event) => { if (event.key === 'Enter') void verify(); }} inputMode="numeric" autoComplete="one-time-code" className="mt-2 w-full rounded-xl border px-4 py-3 text-center text-2xl tracking-[0.45em] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" placeholder="000000" />
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      <button onClick={() => void verify()} disabled={busy || code.length !== 6} className="mt-4 w-full rounded-xl bg-primary py-2.5 font-semibold text-white disabled:opacity-50">{busy ? 'Verifying…' : 'Verify & Continue'}</button>
    </div>}
    <button onClick={() => void signOut()} className="mt-5 w-full text-center text-sm font-medium text-slate-500 hover:text-slate-700">Sign in with another account</button>
  </div></div>;
}
