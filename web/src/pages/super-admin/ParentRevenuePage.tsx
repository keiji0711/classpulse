import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, Building2, CheckCircle2, Clock3, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';

type RevenueRow = {
  school_id: string;
  school_name: string;
  monthly_price: number;
  eligible: number;
  paid: number;
  waived: number;
  collected: number;
  verified: number;
  pending_verification: number;
};

function currentMonthInput() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function ParentRevenuePage() {
  const [month, setMonth] = useState(currentMonthInput);
  const [rows, setRows] = useState<RevenueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadRevenue = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: queryError } = await supabase.rpc('get_parent_access_revenue', {
      p_billing_month: `${month}-01`,
    });
    if (queryError) setError(queryError.message);
    else setRows((data ?? []) as RevenueRow[]);
    setLoading(false);
  }, [month]);

  useEffect(() => {
    void loadRevenue();
  }, [loadRevenue]);

  const totals = useMemo(() => rows.reduce((result, row) => ({
    eligible: result.eligible + Number(row.eligible),
    paid: result.paid + Number(row.paid),
    collected: result.collected + Number(row.collected),
    verified: result.verified + Number(row.verified),
    pending: result.pending + Number(row.pending_verification),
    expected: result.expected + Number(row.eligible) * Number(row.monthly_price),
  }), { eligible: 0, paid: 0, collected: 0, verified: 0, pending: 0, expected: 0 }), [rows]);

  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-2xl font-bold text-slate-900">Parent Access Revenue</h1><p className="mt-1 text-sm text-slate-500">Monthly collections recorded by advisers and verified by schools.</p></div>
        <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Billing month<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="mt-1 block rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" /></label>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Eligible" value={totals.eligible.toLocaleString()} icon={<Users size={21} />} tone="slate" />
        <Metric label="Expected" value={`₱${totals.expected.toLocaleString('en-PH')}`} icon={<Banknote size={21} />} tone="amber" />
        <Metric label="Collected" value={`₱${totals.collected.toLocaleString('en-PH')}`} icon={<Banknote size={21} />} tone="blue" />
        <Metric label="Verified Revenue" value={`₱${totals.verified.toLocaleString('en-PH')}`} icon={<CheckCircle2 size={21} />} tone="emerald" />
        <Metric label="Pending Records" value={totals.pending.toLocaleString()} icon={<Clock3 size={21} />} tone="rose" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-bold text-slate-900">{monthLabel} by school</h2><p className="mt-0.5 text-xs text-slate-500">Verified revenue is the safest confirmed-income figure.</p></div>
        {loading ? <div className="flex min-h-64 items-center justify-center"><div className="h-9 w-9 animate-spin rounded-full border-4 border-slate-200 border-t-primary" /></div> : rows.length === 0 ? <div className="px-6 py-16 text-center text-sm text-slate-500">No schools found.</div> : (
          <div className="overflow-x-auto"><table className="w-full"><thead className="bg-slate-50"><tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500"><th className="px-5 py-3">School</th><th className="px-5 py-3 text-right">Eligible</th><th className="px-5 py-3 text-right">Paid</th><th className="px-5 py-3 text-right">Waived</th><th className="px-5 py-3 text-right">Expected</th><th className="px-5 py-3 text-right">Collected</th><th className="px-5 py-3 text-right">Verified</th><th className="px-5 py-3 text-right">Pending</th></tr></thead><tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const rate = Number(row.eligible) ? Math.round((Number(row.paid) / Number(row.eligible)) * 100) : 0;
              return <tr key={row.school_id} className="hover:bg-slate-50/70"><td className="px-5 py-4"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><Building2 size={17} /></div><div><p className="font-semibold text-slate-900">{row.school_name}</p><p className="text-xs text-slate-500">₱{Number(row.monthly_price).toLocaleString('en-PH')} per student</p></div></div></td><td className="px-5 py-4 text-right text-sm text-slate-700">{Number(row.eligible).toLocaleString()}</td><td className="px-5 py-4 text-right"><p className="text-sm font-bold text-emerald-700">{Number(row.paid).toLocaleString()}</p><p className="text-xs text-slate-400">{rate}%</p></td><td className="px-5 py-4 text-right text-sm text-slate-600">{Number(row.waived).toLocaleString()}</td><td className="px-5 py-4 text-right text-sm font-semibold text-slate-700">₱{(Number(row.eligible) * Number(row.monthly_price)).toLocaleString('en-PH')}</td><td className="px-5 py-4 text-right text-sm font-semibold text-blue-700">₱{Number(row.collected).toLocaleString('en-PH')}</td><td className="px-5 py-4 text-right text-sm font-bold text-emerald-700">₱{Number(row.verified).toLocaleString('en-PH')}</td><td className="px-5 py-4 text-right text-sm text-amber-700">{Number(row.pending_verification).toLocaleString()}</td></tr>;
            })}
          </tbody></table></div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone: 'slate' | 'amber' | 'blue' | 'emerald' | 'rose' }) {
  const tones = { slate: 'bg-slate-100 text-slate-600', amber: 'bg-amber-100 text-amber-700', blue: 'bg-blue-100 text-blue-700', emerald: 'bg-emerald-100 text-emerald-700', rose: 'bg-rose-100 text-rose-700' };
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}>{icon}</div><p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-xl font-bold text-slate-900">{value}</p></div>;
}
