import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear } from '../../contexts/AcademicYearContext';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import { useCachedState, hasCached } from '../../lib/pageCache';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  ArrowUpRight, ArrowDownRight, ChevronRight, Phone, MessageCircle,
  Mail, CalendarDays, Home, Link2, FileText, AlertCircle,
} from 'lucide-react';

interface BaseCounts {
  instructors: number;
  sections: number;
  subjects: number;
  students: number;
}

interface ParentAccessCounts {
  on: number;
  off: number;
  total: number;
}

interface TodayAttendance {
  present: number;
  absent: number;
  late: number;
  excused: number;
  total: number;
  rate: number;
}

interface DailyPoint {
  date: string;
  rate: number;
}

interface AtRiskEntry {
  id: string;
  name: string;
  section: string;
  rate: number;
  absences: number;
  total: number;
}

interface PendingIntervention {
  id: string;
  student_name: string;
  action_type: string;
  follow_up_date: string | null;
  status: string;
}

interface PriorityItem {
  id: string;
  kind: 'intervention' | 'at_risk';
  title: string;
  subtitle: string;
  badge: { label: string; tone: 'danger' | 'warn' | 'muted' };
  icon: React.ReactNode;
}

function pct(n: number, d: number) {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const actionIcons: Record<string, React.ReactNode> = {
  call_parent: <Phone size={14} />,
  sms: <MessageCircle size={14} />,
  email: <Mail size={14} />,
  meeting_scheduled: <CalendarDays size={14} />,
  home_visit: <Home size={14} />,
  referral: <Link2 size={14} />,
  other: <FileText size={14} />,
};

const actionLabels: Record<string, string> = {
  call_parent: 'Call parent',
  sms: 'SMS',
  email: 'Email',
  meeting_scheduled: 'Meeting',
  home_visit: 'Home visit',
  referral: 'Referral',
  other: 'Follow-up',
};

export default function AdminDashboard() {
  const { user } = useAuth();
  const { activeYear } = useAcademicYear();
  const navigate = useNavigate();

  const [counts, setCounts] = useCachedState<BaseCounts>('admin-dashboard-counts', { instructors: 0, sections: 0, subjects: 0, students: 0 });
  const [parentAccess, setParentAccess] = useCachedState<ParentAccessCounts>('admin-dashboard-parent-access', { on: 0, off: 0, total: 0 });
  const [todayAtt, setTodayAtt] = useState<TodayAttendance>({ present: 0, absent: 0, late: 0, excused: 0, total: 0, rate: 0 });
  const [trend, setTrend] = useState<DailyPoint[]>([]);
  const [weekDelta, setWeekDelta] = useState<number | null>(null);
  const [atRisk, setAtRisk] = useState<AtRiskEntry[]>([]);
  const [pendingInterventions, setPendingInterventions] = useState<PendingIntervention[]>([]);
  const [loading, setLoading] = useState(!hasCached('admin-dashboard-counts'));

  const today = useMemo(() => new Date().toISOString().split('T')[0], []);
  const thirtyDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().split('T')[0];
  }, []);

  const fetchAll = useCallback(async () => {
    if (!user?.school_id) return;
    const schoolId = user.school_id;
    const yearId = activeYear?.id;

    const [instructors, sections, subjects, students, dashboardResult] = await Promise.all([
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('role', 'instructor'),
      supabase.from('sections').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
      supabase.from('subjects').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
      yearId
        ? supabase.from('student_enrollments').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('academic_year_id', yearId)
        : supabase.from('students').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
      yearId
        ? supabase.rpc('get_school_attendance_dashboard', {
            p_academic_year_id: yearId,
            p_date_from: thirtyDaysAgo,
            p_date_to: today,
          })
        : Promise.resolve({ data: null, error: null }),
    ]);

    setCounts({
      instructors: instructors.count ?? 0,
      sections: sections.count ?? 0,
      subjects: subjects.count ?? 0,
      students: students.count ?? 0,
    });

    const dashboard = dashboardResult.data as {
      today?: TodayAttendance;
      trend?: DailyPoint[];
      at_risk?: AtRiskEntry[];
      parent_access?: ParentAccessCounts;
    } | null;
    setParentAccess(dashboard?.parent_access ?? { on: 0, off: 0, total: 0 });

    const todayCounts = dashboard?.today ?? { present: 0, absent: 0, late: 0, excused: 0, total: 0, rate: 0 };
    setTodayAtt({
      ...todayCounts,
      rate: pct(todayCounts.present + todayCounts.late + todayCounts.excused, todayCounts.total),
    });

    const trendPoints = dashboard?.trend ?? [];
    setTrend(trendPoints);
    setWeekDelta(null);

    if (trendPoints.length >= 8) {
      const last7 = trendPoints.slice(-7);
      const prev7 = trendPoints.slice(-14, -7);
      if (prev7.length > 0) {
        const avg = (arr: DailyPoint[]) => arr.reduce((s, p) => s + p.rate, 0) / arr.length;
        setWeekDelta(Math.round((avg(last7) - avg(prev7)) * 10) / 10);
      }
    }

    const arRecords: Array<{ student_id: string; status: string }> = [];
    const allStudents: any[] = [];

    const studentMap = new Map<string, any>();
    for (const enrollment of (allStudents ?? []) as any[]) {
      const student = Array.isArray(enrollment.student) ? enrollment.student[0] : enrollment.student;
      const section = Array.isArray(enrollment.section) ? enrollment.section[0] : enrollment.section;
      if (student) studentMap.set(student.id, { ...student, section });
    }

    const stuCounts = new Map<string, { total: number; absent: number }>();
    for (const r of (arRecords ?? [])) {
      if (!stuCounts.has(r.student_id)) stuCounts.set(r.student_id, { total: 0, absent: 0 });
      const e = stuCounts.get(r.student_id)!;
      e.total++;
      if (r.status === 'absent') e.absent++;
    }
    const riskList: AtRiskEntry[] = [];
    stuCounts.forEach((c, id) => {
      const rate = pct(c.absent, c.total);
      if (rate >= 10 && c.total > 0) {
        const stu = studentMap.get(id);
        if (stu) riskList.push({
          id,
          name: `${stu.last_name}, ${stu.first_name}`,
          section: (stu.section as any)?.name ?? '—',
          rate,
          absences: c.absent,
          total: c.total,
        });
      }
    });
    riskList.sort((a, b) => b.rate - a.rate);
    setAtRisk(dashboard?.at_risk ?? riskList);

    const { data: intData } = await supabase
      .from('attendance_interventions')
      .select('id, action_type, follow_up_date, status, student:students(first_name, last_name)')
      .eq('school_id', schoolId)
      .in('status', ['pending', 'in_progress'])
      .order('follow_up_date', { ascending: true, nullsFirst: false })
      .limit(8);

    setPendingInterventions(
      (intData ?? []).map((i: any) => ({
        id: i.id,
        student_name: i.student ? `${i.student.last_name}, ${i.student.first_name}` : 'Unknown',
        action_type: i.action_type,
        follow_up_date: i.follow_up_date,
        status: i.status,
      }))
    );

    setLoading(false);
  }, [user, activeYear, today, thirtyDaysAgo, setCounts, setParentAccess]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useRealtimeRefresh(
    ['attendance_records', 'attendance_interventions', 'parents', 'student_notification_preferences'],
    fetchAll,
    { column: 'school_id', value: user?.school_id },
  );

  const priority: PriorityItem[] = useMemo(() => {
    const items: PriorityItem[] = [];
    for (const inv of pendingInterventions.slice(0, 6)) {
      const isOverdue = !!inv.follow_up_date && inv.follow_up_date <= today;
      items.push({
        id: `int-${inv.id}`,
        kind: 'intervention',
        title: inv.student_name,
        subtitle: `${actionLabels[inv.action_type] ?? 'Follow-up'}${inv.follow_up_date ? ` · due ${fmtDate(inv.follow_up_date)}` : ''}`,
        badge: isOverdue ? { label: 'Overdue', tone: 'danger' } : { label: 'Pending', tone: 'warn' },
        icon: actionIcons[inv.action_type] ?? <FileText size={14} />,
      });
    }
    for (const stu of atRisk.slice(0, 6)) {
      items.push({
        id: `risk-${stu.id}`,
        kind: 'at_risk',
        title: stu.name,
        subtitle: `${stu.section} · ${stu.absences} absences in ${stu.total} sessions`,
        badge: { label: `${stu.rate.toFixed(0)}% absent`, tone: stu.rate >= 20 ? 'danger' : 'warn' },
        icon: <AlertCircle size={14} />,
      });
    }
    return items.slice(0, 8);
  }, [pendingInterventions, atRisk, today]);

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-64 bg-slate-200 rounded" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {[0,1,2,3,4].map(i => <div key={i} className="h-32 bg-white rounded-2xl border border-slate-200" />)}
        </div>
        <div className="h-72 bg-white rounded-2xl border border-slate-200" />
        <div className="h-64 bg-white rounded-2xl border border-slate-200" />
      </div>
    );
  }

  const overdueCount = pendingInterventions.filter(i => i.follow_up_date && i.follow_up_date <= today).length;
  const heroTone = todayAtt.total === 0
    ? 'text-slate-400'
    : todayAtt.rate >= 90 ? 'text-emerald-600'
    : todayAtt.rate >= 75 ? 'text-amber-600'
    : 'text-red-600';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Dashboard</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="text-xs text-slate-400 flex items-center gap-4">
          <span>{counts.students.toLocaleString()} students</span>
          <span className="w-px h-3 bg-slate-200" />
          <span>{counts.instructors} teachers</span>
          <span className="w-px h-3 bg-slate-200" />
          <span>{counts.sections} sections</span>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {/* Today's rate — hero */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Today's attendance</p>
          <div className="flex items-baseline gap-2 mt-2">
            <p className={`text-4xl font-bold ${heroTone}`}>
              {todayAtt.total === 0 ? '—' : `${todayAtt.rate}%`}
            </p>
            {weekDelta !== null && (
              <span className={`text-xs font-semibold flex items-center gap-0.5 ${weekDelta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {weekDelta >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                {Math.abs(weekDelta).toFixed(1)}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {todayAtt.total === 0 ? 'No records yet today' : `${todayAtt.present + todayAtt.late + todayAtt.excused} of ${todayAtt.total} marked here`}
          </p>
        </div>

        {/* Present / Absent split */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Present today</p>
          <p className="text-4xl font-bold text-slate-900 mt-2">{todayAtt.present}</p>
          <p className="text-xs text-slate-400 mt-1">{todayAtt.absent} absent · {todayAtt.late} late</p>
        </div>

        {/* At-risk */}
        <button
          onClick={() => navigate('/admin/school-analytics')}
          className="bg-white rounded-2xl border border-slate-200 p-5 text-left hover:border-slate-300 hover:shadow-sm transition-all cursor-pointer group"
        >
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">At-risk students</p>
          <p className={`text-4xl font-bold mt-2 ${atRisk.length === 0 ? 'text-slate-900' : 'text-rose-600'}`}>{atRisk.length}</p>
          <p className="text-xs text-slate-400 mt-1 flex items-center gap-1 group-hover:text-slate-600">
            ≥10% absent (30d) <ChevronRight size={11} className="opacity-0 group-hover:opacity-100 transition-opacity" />
          </p>
        </button>

        {/* Pending actions */}
        <button
          onClick={() => navigate('/admin/school-analytics')}
          className="bg-white rounded-2xl border border-slate-200 p-5 text-left hover:border-slate-300 hover:shadow-sm transition-all cursor-pointer group"
        >
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Open actions</p>
          <p className={`text-4xl font-bold mt-2 ${overdueCount > 0 ? 'text-amber-600' : 'text-slate-900'}`}>{pendingInterventions.length}</p>
          <p className="text-xs text-slate-400 mt-1 flex items-center gap-1 group-hover:text-slate-600">
            {overdueCount > 0 ? `${overdueCount} overdue` : 'On track'} <ChevronRight size={11} className="opacity-0 group-hover:opacity-100 transition-opacity" />
          </p>
        </button>

        {/* Parent app access */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Parent access on</p>
          <p className="text-4xl font-bold text-emerald-600 mt-2">{parentAccess.on}</p>
          <p className="text-xs text-slate-400 mt-1">
            {parentAccess.off} off · {parentAccess.total} registered
          </p>
        </div>
      </div>

      {/* Trend chart */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-start justify-between mb-1">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Attendance — last 30 days</h3>
            <p className="text-xs text-slate-400 mt-0.5">Daily school-wide rate</p>
          </div>
          <button
            onClick={() => navigate('/admin/school-analytics')}
            className="text-xs text-slate-500 font-medium flex items-center gap-1 hover:text-slate-900 transition-colors"
          >
            Full analytics <ChevronRight size={12} />
          </button>
        </div>
        {trend.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-slate-400">No attendance data yet</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trend} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradRate" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0f766e" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="#0f766e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={fmtDate}
                fontSize={11}
                stroke="#94a3b8"
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={32}
              />
              <YAxis
                domain={[0, 100]}
                tickFormatter={v => `${v}%`}
                fontSize={11}
                stroke="#94a3b8"
                tickLine={false}
                axisLine={false}
                width={36}
              />
              <Tooltip
                contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '12px', boxShadow: '0 4px 12px rgba(15,23,42,0.06)' }}
                labelFormatter={(label: unknown) => fmtDate(String(label))}
                formatter={(v: unknown) => [`${v}%`, 'Rate']}
              />
              <Area
                type="monotone"
                dataKey="rate"
                stroke="#0f766e"
                strokeWidth={2}
                fill="url(#gradRate)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Needs your attention */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Needs your attention</h3>
            <p className="text-xs text-slate-400 mt-0.5">Overdue follow-ups and at-risk students</p>
          </div>
          {priority.length > 0 && (
            <button
              onClick={() => navigate('/admin/school-analytics')}
              className="text-xs text-slate-500 font-medium flex items-center gap-1 hover:text-slate-900 transition-colors"
            >
              Manage all <ChevronRight size={12} />
            </button>
          )}
        </div>
        {priority.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-slate-500 font-medium">All clear</p>
            <p className="text-xs text-slate-400 mt-1">No overdue actions or at-risk students.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {priority.map(item => (
              <li key={item.id}>
                <button
                  onClick={() => navigate('/admin/school-analytics')}
                  className="w-full px-6 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left cursor-pointer"
                >
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    item.kind === 'intervention' ? 'bg-sky-50 text-sky-600' : 'bg-rose-50 text-rose-600'
                  }`}>
                    {item.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{item.title}</p>
                    <p className="text-xs text-slate-500 truncate">{item.subtitle}</p>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                    item.badge.tone === 'danger' ? 'bg-red-50 text-red-700'
                    : item.badge.tone === 'warn' ? 'bg-amber-50 text-amber-700'
                    : 'bg-slate-100 text-slate-600'
                  }`}>
                    {item.badge.label}
                  </span>
                  <ChevronRight size={14} className="text-slate-300 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
