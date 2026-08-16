import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowRight, Banknote, BellRing, Building2,
  CheckCircle2, GraduationCap, HeartPulse, Inbox, RefreshCw,
  ShieldCheck, UserRoundCheck,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { supabase } from '../../lib/supabase';

type SchoolStatus = 'new' | 'setup' | 'ready' | 'active' | 'inactive' | 'suspended' | 'archived';
type Period = 7 | 30;

interface SchoolRow {
  id: string;
  name: string;
  address: string;
  operational_status: SchoolStatus;
  students: number;
  instructors: number;
  admins: number;
  sections: number;
  schedules: number;
  open_support: number;
  attendance_7d: number;
  notification_failures_7d: number;
  google_play_students: number;
  has_active_year: boolean;
  last_attendance: string | null;
}

interface DayActivity { date: string; records: number; active_schools: number }
interface NotificationDay { date: string; delivered: number; failed: number; no_token: number }
interface Snapshot {
  generated_at: string | null;
  schools: SchoolRow[];
  totals: { schools: number; active: number; attention: number; students: number; instructors: number; admins: number; new_schools_30d: number };
  activity: { attendance_today: number; attendance_7d: number; active_schools_today: number; active_schools_7d: number; days: DayActivity[] };
  notifications: { attempts: number; delivered: number; failed: number; no_token: number; skipped: number; avg_latency_ms: number };
  notification_days: NotificationDay[];
  parent_access: { eligible: number; cash_paid: number; waived: number; google_play_families: number; google_play_students: number; verified_cash_revenue: number; pending_cash_records: number };
  health: { open: number; critical: number; warning: number };
  support: { open: number; unread: number };
  open_health_events: number;
  open_support: number;
}

const EMPTY: Snapshot = {
  generated_at: null,
  schools: [],
  totals: { schools: 0, active: 0, attention: 0, students: 0, instructors: 0, admins: 0, new_schools_30d: 0 },
  activity: { attendance_today: 0, attendance_7d: 0, active_schools_today: 0, active_schools_7d: 0, days: [] },
  notifications: { attempts: 0, delivered: 0, failed: 0, no_token: 0, skipped: 0, avg_latency_ms: 0 },
  notification_days: [],
  parent_access: { eligible: 0, cash_paid: 0, waived: 0, google_play_families: 0, google_play_students: 0, verified_cash_revenue: 0, pending_cash_records: 0 },
  health: { open: 0, critical: 0, warning: 0 },
  support: { open: 0, unread: 0 },
  open_health_events: 0,
  open_support: 0,
};

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('en-PH', { notation: 'compact', maximumFractionDigits: 1 });
const PIE_COLORS = ['#0f766e', '#0369a1', '#f59e0b'];

export default function SuperAdminDashboard() {
  const [data, setData] = useState<Snapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState<Period>(30);

  const load = useCallback(async () => {
    const { data: snapshot, error: queryError } = await supabase.rpc('get_platform_operations_snapshot');
    if (queryError) setError(queryError.message);
    else {
      setError('');
      setData({ ...EMPTY, ...(snapshot as Snapshot) });
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    // Initial remote snapshot load; state updates occur after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const attendanceTrend = useMemo(() => (data.activity.days ?? []).slice(-period).map((day) => ({
    ...day,
    label: formatDay(day.date, period),
  })), [data.activity.days, period]);

  const notificationTrend = useMemo(() => (data.notification_days ?? []).slice(-period).map((day) => ({
    ...day,
    label: formatDay(day.date, period),
  })), [data.notification_days, period]);

  const actionableSchools = useMemo(() => data.schools
    .map((school) => ({ school, signal: getSchoolSignal(school) }))
    .filter(({ signal }) => signal.level !== 'healthy')
    .sort((a, b) => b.signal.score - a.signal.score)
    .slice(0, 8), [data.schools]);

  const schoolHealth = useMemo(() => data.schools
    .map((school) => ({ school, signal: getSchoolSignal(school) }))
    .sort((a, b) => b.school.attendance_7d - a.school.attendance_7d)
    .slice(0, 7), [data.schools]);

  const deliveryDenominator = data.notifications.delivered + data.notifications.failed;
  const deliveryRate = deliveryDenominator ? Math.round((data.notifications.delivered / deliveryDenominator) * 100) : 100;
  const activeSchoolRate = data.totals.schools ? Math.round((data.activity.active_schools_7d / data.totals.schools) * 100) : 0;
  const healthy = data.health.critical === 0 && deliveryRate >= 95;
  const accessChannels = [
    { name: 'Cash', value: Number(data.parent_access.cash_paid) },
    { name: 'Google Play', value: Number(data.parent_access.google_play_students) },
    { name: 'Waived', value: Number(data.parent_access.waived) },
  ];
  const accessTotal = accessChannels.reduce((sum, item) => sum + item.value, 0);

  if (loading) return <DashboardSkeleton />;

  return (
    <div className="space-y-6 pb-8">
      <section className="relative overflow-hidden rounded-[28px] bg-slate-950 px-5 py-6 text-white shadow-xl shadow-slate-900/10 sm:px-7">
        <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-teal-400/15 blur-3xl" />
        <div className="absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-sky-500/15 blur-3xl" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${healthy ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-400/15 text-amber-200'}`}>
                <span className={`h-2 w-2 rounded-full ${healthy ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                {healthy ? 'Platform healthy' : 'Attention required'}
              </span>
              <span className="text-xs text-slate-400">Updated {timeAgo(data.generated_at)}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">ClassPulse command center</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">A live view of school adoption, classroom activity, parent access, and service reliability.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PeriodToggle period={period} onChange={setPeriod} />
            <button onClick={() => { setRefreshing(true); void load(); }} disabled={refreshing} className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/15 disabled:opacity-60">
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>
      </section>

      {error && <div className="flex items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><span>{error}</span><button onClick={() => void load()} className="font-bold">Try again</button></div>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<Building2 size={20} />} label="Active schools" value={`${data.totals.active}/${data.totals.schools}`} detail={`${data.totals.new_schools_30d} added in 30 days`} tone="teal" progress={data.totals.schools ? data.totals.active / data.totals.schools * 100 : 0} />
        <MetricCard icon={<GraduationCap size={20} />} label="Students reached" value={data.totals.students.toLocaleString()} detail={`${data.totals.instructors.toLocaleString()} instructors · ${data.totals.admins.toLocaleString()} admins`} tone="blue" />
        <MetricCard icon={<Activity size={20} />} label="Attendance today" value={data.activity.attendance_today.toLocaleString()} detail={`${data.activity.active_schools_today} schools recording today`} tone="violet" />
        <MetricCard icon={<BellRing size={20} />} label="Notification delivery" value={`${deliveryRate}%`} detail={`${data.notifications.failed} failed · ${data.notifications.avg_latency_ms} ms average`} tone={deliveryRate >= 95 ? 'emerald' : 'amber'} progress={deliveryRate} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Panel title="Attendance activity" description={`${period}-day recording volume and school participation`} action={<span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-teal-700">{activeSchoolRate}% active this week</span>}>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={attendanceTrend} margin={{ top: 12, right: 6, left: -18, bottom: 0 }}>
                <defs><linearGradient id="attendanceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0f766e" stopOpacity={0.28} /><stop offset="95%" stopColor="#0f766e" stopOpacity={0.02} /></linearGradient></defs>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={period === 30 ? 26 : 8} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip valueLabel="Attendance records" />} />
                <Area type="monotone" dataKey="records" stroke="#0f766e" strokeWidth={3} fill="url(#attendanceFill)" activeDot={{ r: 5, fill: '#0f766e', stroke: '#fff', strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
            <MiniStat label="Records this week" value={compact.format(data.activity.attendance_7d)} />
            <MiniStat label="Schools active" value={`${data.activity.active_schools_7d}/${data.totals.schools}`} />
            <MiniStat label="Needs attention" value={data.totals.attention.toLocaleString()} warn={data.totals.attention > 0} />
          </div>
        </Panel>

        <Panel title="Parent access" description="Current-month access by activation channel" action={<Link to="/super-admin/parent-revenue" className="text-xs font-bold text-primary hover:underline">View revenue</Link>}>
          {accessTotal > 0 ? <div className="relative mx-auto h-48 max-w-xs">
            <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={accessChannels} dataKey="value" nameKey="name" innerRadius={58} outerRadius={78} paddingAngle={4}>{accessChannels.map((entry, index) => <Cell key={entry.name} fill={PIE_COLORS[index]} />)}</Pie><Tooltip formatter={(value) => Number(value).toLocaleString()} /></PieChart></ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-2xl font-extrabold text-slate-900">{accessTotal.toLocaleString()}</span><span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">access records</span></div>
          </div> : <div className="flex h-48 flex-col items-center justify-center text-center text-sm text-slate-400"><UserRoundCheck className="mb-2" /><span>No parent access recorded this month.</span></div>}
          <div className="space-y-2.5">
            {accessChannels.map((item, index) => <div key={item.name} className="flex items-center justify-between text-sm"><span className="flex items-center gap-2 text-slate-600"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[index] }} />{item.name}</span><strong className="text-slate-900">{item.value.toLocaleString()}</strong></div>)}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3"><MiniStat label="Verified cash" value={money.format(data.parent_access.verified_cash_revenue)} /><MiniStat label="Pending review" value={data.parent_access.pending_cash_records.toLocaleString()} warn={data.parent_access.pending_cash_records > 0} /></div>
        </Panel>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.15fr_1fr]">
        <Panel title="Notification reliability" description={`${period}-day delivery and failure history`} action={<Link to="/super-admin/security-reliability" className="text-xs font-bold text-primary hover:underline">Reliability details</Link>}>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%"><BarChart data={notificationTrend} margin={{ top: 10, right: 4, left: -20, bottom: 0 }}><CartesianGrid stroke="#e2e8f0" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={period === 30 ? 28 : 8} /><YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} /><Tooltip content={<NotificationTooltip />} /><Bar dataKey="delivered" stackId="notifications" fill="#14b8a6" radius={[3, 3, 0, 0]} /><Bar dataKey="failed" stackId="notifications" fill="#fb7185" /><Bar dataKey="no_token" stackId="notifications" fill="#cbd5e1" /></BarChart></ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs font-semibold text-slate-500"><Legend color="#14b8a6" label="Delivered" /><Legend color="#fb7185" label="Failed" /><Legend color="#cbd5e1" label="No token" /></div>
        </Panel>

        <Panel title="Operational monitoring" description="Signals that may need a platform owner" action={<Link to="/super-admin/operations" className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">Open operations <ArrowRight size={12} /></Link>}>
          <div className="grid grid-cols-3 gap-2.5">
            <SignalCard icon={<HeartPulse size={18} />} label="Health events" value={data.health.open} danger={data.health.critical > 0} />
            <SignalCard icon={<Inbox size={18} />} label="Open support" value={data.support.open} danger={data.support.unread > 0} />
            <SignalCard icon={<AlertTriangle size={18} />} label="School alerts" value={actionableSchools.length} danger={actionableSchools.length > 0} />
          </div>
          <div className="mt-4 space-y-2">
            {actionableSchools.length === 0 ? <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-emerald-200 bg-emerald-50/60 text-center"><CheckCircle2 className="mb-2 text-emerald-600" /><p className="text-sm font-bold text-emerald-800">All schools look healthy</p><p className="text-xs text-emerald-600">No operational alerts right now.</p></div> : actionableSchools.slice(0, 5).map(({ school, signal }) => <div key={school.id} className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2.5"><div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${signal.level === 'critical' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'}`}><Building2 size={17} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-800">{school.name}</p><p className="truncate text-xs text-slate-500">{signal.reason}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${signal.level === 'critical' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>{signal.level}</span></div>)}
          </div>
        </Panel>
      </section>

      <Panel title="School adoption and health" description="Usage, setup readiness, parent access, and service signals by school" action={<Link to="/super-admin/schools" className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">Manage schools <ArrowRight size={12} /></Link>}>
        {schoolHealth.length === 0 ? <div className="py-14 text-center text-sm text-slate-400">No schools have been added yet.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead><tr className="border-b border-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-400"><th className="pb-3">School</th><th className="pb-3">Health</th><th className="pb-3 text-right">Students</th><th className="pb-3 text-right">Attendance 7d</th><th className="pb-3 text-right">Play access</th><th className="pb-3 text-right">Last activity</th></tr></thead><tbody className="divide-y divide-slate-100">{schoolHealth.map(({ school, signal }) => <tr key={school.id} className="group"><td className="py-3.5 pr-4"><p className="font-bold text-slate-800">{school.name}</p><p className="max-w-[260px] truncate text-xs text-slate-400">{school.address || 'No address provided'}</p></td><td className="py-3.5"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${signal.level === 'healthy' ? 'bg-emerald-50 text-emerald-700' : signal.level === 'critical' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}><span className={`h-1.5 w-1.5 rounded-full ${signal.level === 'healthy' ? 'bg-emerald-500' : signal.level === 'critical' ? 'bg-rose-500' : 'bg-amber-500'}`} />{signal.level === 'healthy' ? 'Healthy' : signal.reason}</span></td><td className="py-3.5 text-right text-sm font-semibold text-slate-700">{school.students.toLocaleString()}</td><td className="py-3.5 text-right text-sm font-semibold text-slate-700">{school.attendance_7d.toLocaleString()}</td><td className="py-3.5 text-right text-sm font-semibold text-slate-700">{school.google_play_students.toLocaleString()}</td><td className="py-3.5 text-right text-xs text-slate-500">{timeAgo(school.last_attendance)}</td></tr>)}</tbody></table></div>}
      </Panel>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <QuickLink to="/super-admin/operations" icon={<HeartPulse />} title="Platform operations" text="Schools, onboarding, health, and releases" />
        <QuickLink to="/super-admin/parent-revenue" icon={<Banknote />} title="Parent revenue" text="Cash verification and access channels" />
        <QuickLink to="/super-admin/support" icon={<Inbox />} title="Support inbox" text={`${data.support.unread} conversation${data.support.unread === 1 ? '' : 's'} waiting`} />
        <QuickLink to="/super-admin/security-reliability" icon={<ShieldCheck />} title="Security & reliability" text="Auth, jobs, delivery, and system events" />
      </section>
    </div>
  );
}

function getSchoolSignal(school: SchoolRow) {
  if (['suspended', 'archived', 'inactive'].includes(school.operational_status)) return { level: 'critical' as const, reason: school.operational_status, score: 100 };
  if (school.notification_failures_7d > 5) return { level: 'critical' as const, reason: `${school.notification_failures_7d} notification failures`, score: 90 };
  if (school.open_support > 0) return { level: 'attention' as const, reason: `${school.open_support} open support request${school.open_support === 1 ? '' : 's'}`, score: 75 };
  if (!school.has_active_year || school.admins === 0 || school.instructors === 0 || school.sections === 0) return { level: 'attention' as const, reason: 'Setup incomplete', score: 65 };
  if (!school.last_attendance) return { level: 'attention' as const, reason: 'No attendance recorded', score: 55 };
  const age = Date.now() - new Date(school.last_attendance).getTime();
  if (age > 7 * 86_400_000) return { level: 'attention' as const, reason: 'No activity for 7+ days', score: 45 };
  return { level: 'healthy' as const, reason: 'Healthy', score: 0 };
}

function formatDay(value: string, period: Period) {
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString('en-PH', period === 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' });
}

function timeAgo(value: string | null) {
  if (!value) return 'Never';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  const days = Math.floor(seconds / 86_400);
  return days < 30 ? `${days}d ago` : new Date(value).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function PeriodToggle({ period, onChange }: { period: Period; onChange: (period: Period) => void }) {
  return <div className="flex rounded-xl border border-white/15 bg-white/10 p-1">{([7, 30] as Period[]).map((option) => <button key={option} onClick={() => onChange(option)} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${period === option ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-300 hover:text-white'}`}>{option} days</button>)}</div>;
}

function MetricCard({ icon, label, value, detail, tone, progress }: { icon: React.ReactNode; label: string; value: string; detail: string; tone: 'teal' | 'blue' | 'violet' | 'emerald' | 'amber'; progress?: number }) {
  const tones = { teal: 'bg-teal-50 text-teal-700', blue: 'bg-sky-50 text-sky-700', violet: 'bg-violet-50 text-violet-700', emerald: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700' };
  const bars = { teal: 'bg-teal-500', blue: 'bg-sky-500', violet: 'bg-violet-500', emerald: 'bg-emerald-500', amber: 'bg-amber-500' };
  return <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-900/[0.03]"><div className="flex items-start justify-between"><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}>{icon}</div>{typeof progress === 'number' && <span className="text-xs font-bold text-slate-400">{Math.round(progress)}%</span>}</div><p className="mt-4 text-xs font-bold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">{value}</p><p className="mt-1 min-h-5 text-xs text-slate-500">{detail}</p>{typeof progress === 'number' && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${bars[tone]}`} style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} /></div>}</div>;
}

function Panel({ title, description, action, children }: { title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/[0.03]"><div className="mb-5 flex items-start justify-between gap-3"><div><h2 className="text-base font-bold text-slate-900">{title}</h2><p className="mt-0.5 text-xs text-slate-500">{description}</p></div>{action}</div>{children}</section>;
}

function MiniStat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return <div><p className={`text-lg font-extrabold ${warn ? 'text-amber-700' : 'text-slate-900'}`}>{value}</p><p className="text-[11px] font-semibold text-slate-400">{label}</p></div>;
}

function SignalCard({ icon, label, value, danger }: { icon: React.ReactNode; label: string; value: number; danger: boolean }) {
  return <div className={`rounded-xl border p-3 ${danger ? 'border-amber-200 bg-amber-50' : 'border-emerald-100 bg-emerald-50/70'}`}><div className={danger ? 'text-amber-600' : 'text-emerald-600'}>{icon}</div><p className="mt-2 text-xl font-extrabold text-slate-900">{value}</p><p className="text-[10px] font-semibold text-slate-500">{label}</p></div>;
}

function Legend({ color, label }: { color: string; label: string }) { return <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />{label}</span>; }

function QuickLink({ to, icon, title, text }: { to: string; icon: React.ReactNode; title: string; text: string }) {
  return <Link to={to} className="group flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-md"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition group-hover:bg-teal-50 group-hover:text-teal-700">{icon}</span><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-slate-800">{title}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{text}</span></span><ArrowRight size={15} className="mt-1 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-teal-600" /></Link>;
}

function ChartTooltip({ active, payload, label, valueLabel }: { active?: boolean; payload?: Array<{ value?: number }>; label?: string; valueLabel: string }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-sm font-extrabold text-slate-900">{Number(payload[0]?.value ?? 0).toLocaleString()} <span className="font-medium text-slate-400">{valueLabel}</span></p></div>;
}

function NotificationTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey?: string; value?: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg"><p className="mb-1.5 text-xs font-bold text-slate-500">{label}</p>{payload.map((item) => <p key={item.dataKey} className="text-xs font-semibold capitalize" style={{ color: item.color }}>{String(item.dataKey).replace('_', ' ')}: {Number(item.value ?? 0).toLocaleString()}</p>)}</div>;
}

function DashboardSkeleton() {
  return <div className="animate-pulse space-y-6"><div className="h-40 rounded-[28px] bg-slate-200" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-40 rounded-2xl bg-slate-200" />)}</div><div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]"><div className="h-96 rounded-2xl bg-slate-200" /><div className="h-96 rounded-2xl bg-slate-200" /></div></div>;
}
