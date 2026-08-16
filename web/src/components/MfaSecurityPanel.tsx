import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';

type Enrollment = { id: string; qrCode: string; secret: string };

export default function MfaSecurityPanel({ onEnabled }: { onEnabled?: () => void }) {
  const { showToast } = useToast();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactorId(data?.totp.find((factor) => factor.status === 'verified')?.id ?? null);
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function startEnrollment() {
    setBusy(true);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'ClassPulse Authenticator' });
    setBusy(false);
    if (error || !data?.totp) {
      showToast(error?.message ?? 'Could not start MFA setup.', 'error');
      return;
    }
    setEnrollment({ id: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
  }

  async function verifyEnrollment() {
    if (!enrollment || code.trim().length !== 6) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollment.id, code: code.trim() });
    if (!error) await supabase.rpc('set_own_mfa_enrollment', { p_enrolled: true });
    setBusy(false);
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    setEnrollment(null);
    setCode('');
    await load();
    showToast('Multi-factor authentication enabled.');
    onEnabled?.();
  }

  if (enrollment) {
    return <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
      <h4 className="font-semibold text-slate-800">Connect your authenticator app</h4>
      <p className="mt-1 text-sm text-slate-600">Scan this code using Google Authenticator, Microsoft Authenticator, 1Password, or another TOTP app.</p>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
        <img src={enrollment.qrCode} alt="Authenticator QR code" className="h-44 w-44 rounded-xl border bg-white p-2" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase text-slate-500">Manual setup key</p>
          <code className="mt-1 block break-all rounded-lg bg-white p-2 text-xs text-slate-700">{enrollment.secret}</code>
          <label className="mt-3 block text-sm font-medium text-slate-700">6-digit verification code</label>
          <input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="mt-1 w-full rounded-xl border px-3 py-2 text-lg tracking-[0.35em] outline-none focus:border-primary" placeholder="000000" />
          <div className="mt-3 flex gap-2"><button onClick={verifyEnrollment} disabled={busy || code.length !== 6} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Verify & Enable</button><button onClick={() => setEnrollment(null)} className="rounded-xl border px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button></div>
        </div>
      </div>
    </div>;
  }

  return <div className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4 ${factorId ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'}`}>
    <div className="flex items-start gap-3">
      {factorId ? <ShieldCheck className="mt-0.5 text-emerald-600" size={20} /> : <ShieldOff className="mt-0.5 text-amber-600" size={20} />}
      <div><p className="text-sm font-semibold text-slate-800">Authenticator MFA {factorId ? 'enabled' : 'not configured'}</p><p className="mt-0.5 text-xs text-slate-600">Protects your administrator account even if its password is stolen.</p></div>
    </div>
    {factorId ? <span className="rounded-xl border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-700">Required &amp; active</span> : <button onClick={startEnrollment} disabled={busy} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Starting…' : 'Set Up MFA'}</button>}
  </div>;
}
