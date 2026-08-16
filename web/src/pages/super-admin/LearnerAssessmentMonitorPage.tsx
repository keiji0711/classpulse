import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BookOpenCheck, Calculator, HeartPulse, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';

type MonitorRow = {
  school_id: string;
  school_name: string;
  academic_year_id: string | null;
  academic_year_name: string | null;
  enrolled: number;
  bosy_literacy: number; bosy_numeracy: number; bosy_nutrition: number;
  eosy_literacy: number; eosy_numeracy: number; eosy_nutrition: number;
  literacy_needs_support: number; numeracy_needs_support: number; nutrition_needs_support: number;
};

export default function LearnerAssessmentMonitorPage() {
  const { showToast } = useToast();
  const [rows, setRows] = useState<MonitorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<'bosy'|'eosy'>('bosy');

  useEffect(() => { void (async () => {
    const { data, error } = await supabase.rpc('get_platform_assessment_monitor');
    if (error) showToast(error.message, 'error');
    setRows(((data ?? []) as MonitorRow[]).map((row) => Object.fromEntries(Object.entries(row).map(([key,value]) => [key, typeof value === 'string' && /^\d+$/.test(value) && !key.endsWith('_id') ? Number(value) : value])) as MonitorRow));
    setLoading(false);
  })(); }, [showToast]);

  const visible = useMemo(() => rows.filter((row) => row.school_name.toLowerCase().includes(search.trim().toLowerCase())), [rows, search]);
  const totals = useMemo(() => rows.reduce((total,row) => ({ enrolled: total.enrolled+Number(row.enrolled), literacy: total.literacy+Number(row[`${period}_literacy`]), numeracy: total.numeracy+Number(row[`${period}_numeracy`]), nutrition: total.nutrition+Number(row[`${period}_nutrition`]) }), { enrolled:0,literacy:0,numeracy:0,nutrition:0 }), [rows,period]);

  if (loading) return <div className="flex justify-center py-20"><div className="h-9 w-9 animate-spin rounded-full border-4 border-slate-200 border-t-primary"/></div>;
  return <div className="space-y-6">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><h1 className="text-2xl font-bold text-slate-900">Learner Assessment Monitoring</h1><p className="mt-1 text-sm text-slate-500">Aggregate-only visibility into DepEd BoSY and EoSY completion and intervention signals.</p></div><div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">{(['bosy','eosy'] as const).map((value)=><button key={value} onClick={()=>setPeriod(value)} className={`rounded-lg px-4 py-2 text-sm font-bold ${period===value?'bg-primary text-white':'text-slate-500 hover:bg-slate-50'}`}>{value==='bosy'?'BoSY':'EoSY'}</button>)}</div></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Enrolled learners" value={totals.enrolled} icon={<BookOpenCheck/>}/><Metric label="Literacy coverage" value={totals.literacy} total={totals.enrolled} icon={<BookOpenCheck/>}/><Metric label="Numeracy coverage" value={totals.numeracy} total={totals.enrolled} icon={<Calculator/>}/><Metric label="Nutrition coverage" value={totals.nutrition} total={totals.enrolled} icon={<HeartPulse/>}/></div>
    <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">This page intentionally shows school-level counts only. Learner names, scores, measurements, and health classifications remain restricted to assigned teachers.</div>
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-bold text-slate-900">School coverage</h2><p className="text-xs text-slate-500">Current academic year per school</p></div><div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search school" className="rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"/></div></div><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left"><thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">School</th><th className="px-4 py-3 text-right">Enrolled</th><th className="px-4 py-3">Literacy</th><th className="px-4 py-3">Numeracy</th><th className="px-4 py-3">Nutrition</th><th className="px-4 py-3">Current support signals</th></tr></thead><tbody className="divide-y divide-slate-100">{visible.map((row)=><tr key={row.school_id}><td className="px-4 py-4"><p className="font-bold text-slate-800">{row.school_name}</p><p className="text-xs text-slate-400">{row.academic_year_name ?? 'No current academic year'}</p></td><td className="px-4 py-4 text-right font-bold text-slate-700">{Number(row.enrolled).toLocaleString()}</td>{(['literacy','numeracy','nutrition'] as const).map((domain)=><td key={domain} className="px-4 py-4"><Coverage value={Number(row[`${period}_${domain}`])} total={Number(row.enrolled)}/></td>)}<td className="px-4 py-4"><div className="flex flex-wrap gap-1.5"><Signal label="Literacy" value={Number(row.literacy_needs_support)}/><Signal label="Numeracy" value={Number(row.numeracy_needs_support)}/><Signal label="Nutrition" value={Number(row.nutrition_needs_support)}/></div></td></tr>)}{visible.length===0&&<tr><td colSpan={6} className="px-4 py-14 text-center text-sm text-slate-400">No schools match this search.</td></tr>}</tbody></table></div></div>
  </div>;
}

function Metric({label,value,total,icon}:{label:string;value:number;total?:number;icon:React.ReactNode}) { const pct=total?Math.round(value/total*100):null; return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">{icon}</div><p className="mt-3 text-2xl font-extrabold text-slate-900">{value.toLocaleString()}{pct!==null&&<span className="ml-2 text-sm text-slate-400">{pct}%</span>}</p><p className="text-xs font-semibold text-slate-500">{label}</p></div>; }
function Coverage({value,total}:{value:number;total:number}) { const pct=total?Math.round(value/total*100):0; return <div className="min-w-28"><div className="flex justify-between text-xs"><span className="font-bold text-slate-700">{value}/{total}</span><span className="text-slate-400">{pct}%</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${pct===100?'bg-emerald-500':pct>=75?'bg-teal-500':'bg-amber-500'}`} style={{width:`${pct}%`}}/></div></div>; }
function Signal({label,value}:{label:string;value:number}) { return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold ${value?'bg-amber-50 text-amber-700':'bg-slate-50 text-slate-400'}`}>{value>0&&<AlertTriangle size={11}/>} {label}: {value}</span>; }

