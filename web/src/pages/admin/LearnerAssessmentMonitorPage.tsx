import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BookOpenCheck, Calculator, HeartPulse, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';

type Period = 'bosy' | 'eosy';
type Domain = 'literacy' | 'numeracy' | 'nutrition';
type MonitorRow = {
  academic_year_id: string;
  academic_year_name: string;
  section_id: string;
  section_name: string;
  grade_level: string;
  enrolled: number;
  bosy_literacy: number; bosy_numeracy: number; bosy_nutrition: number;
  eosy_literacy: number; eosy_numeracy: number; eosy_nutrition: number;
  bosy_literacy_support: number; bosy_numeracy_support: number; bosy_nutrition_support: number;
  eosy_literacy_support: number; eosy_numeracy_support: number; eosy_nutrition_support: number;
};

const domains: Domain[] = ['literacy', 'numeracy', 'nutrition'];

export default function LearnerAssessmentMonitorPage() {
  const { showToast } = useToast();
  const [rows, setRows] = useState<MonitorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('bosy');

  useEffect(() => { void (async () => {
    const { data, error } = await supabase.rpc('get_school_assessment_monitor');
    if (error) showToast(error.message, 'error');
    const normalized = ((data ?? []) as Record<string, unknown>[]).map((row) =>
      Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'string' && /^\d+$/.test(value) && !key.endsWith('_id') ? Number(value) : value])) as MonitorRow,
    );
    normalized.sort((a, b) => a.grade_level.localeCompare(b.grade_level, undefined, { numeric: true }) || a.section_name.localeCompare(b.section_name));
    setRows(normalized);
    setLoading(false);
  })(); }, [showToast]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => `${row.grade_level} ${row.section_name}`.toLowerCase().includes(term));
  }, [rows, search]);
  const totals = useMemo(() => rows.reduce((total, row) => ({
    enrolled: total.enrolled + Number(row.enrolled),
    literacy: total.literacy + Number(row[`${period}_literacy`]),
    numeracy: total.numeracy + Number(row[`${period}_numeracy`]),
    nutrition: total.nutrition + Number(row[`${period}_nutrition`]),
  }), { enrolled: 0, literacy: 0, numeracy: 0, nutrition: 0 }), [rows, period]);

  if (loading) return <div className="flex justify-center py-20"><div className="h-9 w-9 animate-spin rounded-full border-4 border-slate-200 border-t-primary" /></div>;

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div><h1 className="text-2xl font-bold text-slate-900">Learner Assessment Monitoring</h1><p className="mt-1 text-sm text-slate-500">Track DepEd BoSY and EoSY completion by section for {rows[0]?.academic_year_name ?? 'the current school year'}.</p></div>
      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">{(['bosy', 'eosy'] as Period[]).map((value) => <button key={value} onClick={() => setPeriod(value)} className={`rounded-lg px-4 py-2 text-sm font-bold ${period === value ? 'bg-primary text-white' : 'text-slate-500 hover:bg-slate-50'}`}>{value === 'bosy' ? 'BoSY' : 'EoSY'}</button>)}</div>
    </div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Enrolled learners" value={totals.enrolled} icon={<BookOpenCheck />} /><Metric label="Literacy recorded" value={totals.literacy} total={totals.enrolled} icon={<BookOpenCheck />} /><Metric label="Numeracy recorded" value={totals.numeracy} total={totals.enrolled} icon={<Calculator />} /><Metric label="Nutrition recorded" value={totals.nutrition} total={totals.enrolled} icon={<HeartPulse />} /></div>
    <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">Teachers record official results. This monitoring page shows section-level completion and support counts only; it does not expose learner scores or health measurements.</div>
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-bold text-slate-900">Section coverage</h2><p className="text-xs text-slate-500">{period === 'bosy' ? 'Beginning' : 'End'} of school year</p></div><div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search grade or section" className="rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary" /></div></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[920px] text-left"><thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Grade &amp; section</th><th className="px-4 py-3 text-right">Enrolled</th><th className="px-4 py-3">Literacy</th><th className="px-4 py-3">Numeracy</th><th className="px-4 py-3">Nutrition</th><th className="px-4 py-3">Support signals</th></tr></thead><tbody className="divide-y divide-slate-100">{visible.map((row) => <tr key={row.section_id}><td className="px-4 py-4"><p className="font-bold text-slate-800">{row.section_name}</p><p className="text-xs text-slate-400">{row.grade_level}</p></td><td className="px-4 py-4 text-right font-bold text-slate-700">{Number(row.enrolled).toLocaleString()}</td>{domains.map((domain) => <td key={domain} className="px-4 py-4"><Coverage value={Number(row[`${period}_${domain}`])} total={Number(row.enrolled)} /></td>)}<td className="px-4 py-4"><div className="flex flex-wrap gap-1.5">{domains.map((domain) => <Signal key={domain} label={domain} value={Number(row[`${period}_${domain}_support`])} />)}</div></td></tr>)}{visible.length === 0 && <tr><td colSpan={6} className="px-4 py-14 text-center text-sm text-slate-400">{rows.length ? 'No sections match this search.' : 'No enrolled sections found for the current school year.'}</td></tr>}</tbody></table></div>
    </div>
  </div>;
}

function Metric({ label, value, total, icon }: { label: string; value: number; total?: number; icon: React.ReactNode }) { const pct = total ? Math.round(value / total * 100) : null; return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">{icon}</div><p className="mt-3 text-2xl font-extrabold text-slate-900">{value.toLocaleString()}{pct !== null && <span className="ml-2 text-sm text-slate-400">{pct}%</span>}</p><p className="text-xs font-semibold text-slate-500">{label}</p></div>; }
function Coverage({ value, total }: { value: number; total: number }) { const pct = total ? Math.round(value / total * 100) : 0; return <div className="min-w-28"><div className="flex justify-between text-xs"><span className="font-bold text-slate-700">{value}/{total}</span><span className="text-slate-400">{pct}%</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${pct === 100 ? 'bg-emerald-500' : pct >= 75 ? 'bg-teal-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div></div>; }
function Signal({ label, value }: { label: string; value: number }) { return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold capitalize ${value ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-400'}`}>{value > 0 && <AlertTriangle size={11} />} {label}: {value}</span>; }
