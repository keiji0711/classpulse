import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear } from '../../contexts/AcademicYearContext';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import { useCachedState, hasCached } from '../../lib/pageCache';
import type { Schedule } from '../../types';
import { Clock, MapPin, BookOpen, CalendarDays, GraduationCap, Layers, RefreshCw } from 'lucide-react';

type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
const DAYS: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS: Record<DayOfWeek, string> = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };
const DAY_FULL: Record<DayOfWeek, string> = { monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday' };

const CARD_COLORS = [
  'bg-blue-50 border-blue-200 text-blue-900',
  'bg-emerald-50 border-emerald-200 text-emerald-900',
  'bg-violet-50 border-violet-200 text-violet-900',
  'bg-amber-50 border-amber-200 text-amber-900',
  'bg-rose-50 border-rose-200 text-rose-900',
  'bg-cyan-50 border-cyan-200 text-cyan-900',
  'bg-pink-50 border-pink-200 text-pink-900',
  'bg-teal-50 border-teal-200 text-teal-900',
  'bg-orange-50 border-orange-200 text-orange-900',
  'bg-indigo-50 border-indigo-200 text-indigo-900',
];

const BADGE_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-violet-100 text-violet-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-cyan-100 text-cyan-700',
  'bg-pink-100 text-pink-700',
  'bg-teal-100 text-teal-700',
  'bg-orange-100 text-orange-700',
  'bg-indigo-100 text-indigo-700',
];

function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function getTodayKey(): DayOfWeek | null {
  const jsDay = new Date().getDay(); // 0=Sun
  const map: Record<number, DayOfWeek> = { 0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday', 4: 'thursday', 5: 'friday', 6: 'saturday' };
  return map[jsDay] ?? null;
}

export default function MySchedulePage() {
  const { user } = useAuth();
  const { activeYear } = useAcademicYear();
  const userId = user?.id;
  const activeYearId = activeYear?.id;
  const [schedules, setSchedules] = useCachedState<Schedule[]>('inst-schedules', []);
  const [loading, setLoading] = useState(!hasCached('inst-schedules'));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [activeDay, setActiveDay] = useState<DayOfWeek | 'all'>('all');

  const today = getTodayKey();

  const loadSchedules = useCallback(async (showRefresh = false) => {
    if (!userId) return;
    if (showRefresh) setRefreshing(true);
    setError('');

    let query = supabase
      .from('schedules')
      .select('*, subject:subjects(*), section:sections(*)')
      .eq('instructor_id', userId);
    if (activeYearId) query = query.eq('academic_year_id', activeYearId);

    const { data, error: scheduleError } = await query
      .order('day_of_week')
      .order('time_start');

    if (scheduleError) {
      setError('Unable to load your schedule. Please try again.');
    } else {
      setSchedules((data as Schedule[] | null) ?? []);
    }
    setLoading(false);
    setRefreshing(false);
  }, [activeYearId, setSchedules, userId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void loadSchedules();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loadSchedules]);

  useRealtimeRefresh(
    ['schedules'],
    () => { void loadSchedules(); },
    { column: 'instructor_id', value: userId },
  );

  // Color map keyed by subject id
  const subjectColorMap = useMemo(() => {
    const map = new Map<string, number>();
    const ids = [...new Set(schedules.map((s) => s.subject_id))];
    ids.forEach((id, i) => map.set(id, i % CARD_COLORS.length));
    return map;
  }, [schedules]);

  // Stats
  const stats = useMemo(() => {
    const subjects = new Set(schedules.map((s) => s.subject_id));
    const sections = new Set(schedules.map((s) => s.section_id));
    const days = new Set(schedules.map((s) => s.day_of_week));
    return { total: schedules.length, subjects: subjects.size, sections: sections.size, days: days.size };
  }, [schedules]);

  // Group by day
  const byDay = useMemo(() => {
    const map = new Map<DayOfWeek, Schedule[]>();
    DAYS.forEach((d) => map.set(d, []));
    schedules.forEach((s) => map.get(s.day_of_week as DayOfWeek)?.push(s));
    map.forEach((arr) => arr.sort((a, b) => a.time_start.localeCompare(b.time_start)));
    return map;
  }, [schedules]);

  // Today's schedule
  const todaySchedules = today ? (byDay.get(today) ?? []) : [];

  // Filtered days for grid
  const visibleDays = activeDay === 'all' ? DAYS : [activeDay];

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">My Schedule</h2>
          <p className="text-sm text-slate-500 mt-1">
            {today ? `Today is ${DAY_FULL[today]} — you have ${todaySchedules.length} class${todaySchedules.length !== 1 ? 'es' : ''} today.` : 'Enjoy your day off!'}
            {activeYear ? ` · ${activeYear.name}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadSchedules(true)}
          disabled={refreshing}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Classes', value: stats.total, icon: CalendarDays, color: 'text-blue-600 bg-blue-50' },
          { label: 'Subjects', value: stats.subjects, icon: BookOpen, color: 'text-emerald-600 bg-emerald-50' },
          { label: 'Sections', value: stats.sections, icon: GraduationCap, color: 'text-violet-600 bg-violet-50' },
          { label: 'Active Days', value: stats.days, icon: Layers, color: 'text-amber-600 bg-amber-50' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${stat.color}`}>
              <stat.icon size={20} />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{stat.value}</p>
              <p className="text-xs text-slate-500">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Today's Up Next (only show on a weekday with classes) */}
      {today && todaySchedules.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Today&apos;s Classes</h3>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {todaySchedules.map((s) => {
              const ci = subjectColorMap.get(s.subject_id) ?? 0;
              return (
                <div key={s.id} className={`flex-shrink-0 w-56 rounded-xl border p-4 ${CARD_COLORS[ci]}`}>
                  <div className="font-semibold text-sm mb-1">{s.subject?.name}</div>
                  <div className="text-xs opacity-75 mb-2">{s.subject?.code}</div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs opacity-80">
                      <Clock size={12} /> {formatTime(s.time_start)} – {formatTime(s.time_end)}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs opacity-80">
                      <GraduationCap size={12} /> {s.section?.grade_level} - {s.section?.name}
                    </div>
                    {s.room && (
                      <div className="flex items-center gap-1.5 text-xs opacity-80">
                        <MapPin size={12} /> {s.room}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Day filter tabs */}
      <div className="flex items-center gap-1 bg-white rounded-xl border border-slate-200 p-1.5 overflow-x-auto">
        <button
          onClick={() => setActiveDay('all')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${activeDay === 'all' ? 'bg-primary text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
        >All Days</button>
        {DAYS.map((d) => {
          const count = byDay.get(d)?.length ?? 0;
          const isToday = d === today;
          return (
            <button
              key={d}
              onClick={() => setActiveDay(d)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                activeDay === d
                  ? 'bg-primary text-white shadow-sm'
                  : isToday
                    ? 'bg-primary/10 text-primary hover:bg-primary/20'
                    : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {DAY_LABELS[d]}
              {count > 0 && (
                <span className={`text-[10px] font-bold rounded-full w-4.5 h-4.5 flex items-center justify-center ${
                  activeDay === d ? 'bg-white/25' : 'bg-slate-200/80 text-slate-600'
                }`}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Timetable Grid */}
      {schedules.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <CalendarDays size={48} className="text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">No schedules assigned yet</p>
          <p className="text-slate-400 text-sm mt-1">Your schedule will appear here once the admin assigns classes to you.</p>
        </div>
      ) : activeDay === 'all' ? (
        /* Full week grid */
        <div className="overflow-x-auto pb-2">
          <div className="grid min-w-[1120px] grid-cols-7 gap-3">
          {visibleDays.map((day) => {
            const daySchedules = byDay.get(day) ?? [];
            const isToday = day === today;
            return (
              <div key={day} className="min-w-0">
                <div className={`text-center py-2.5 rounded-t-xl ${isToday ? 'bg-primary text-white' : 'bg-slate-800 text-white'}`}>
                  <span className="text-sm font-semibold">{DAY_LABELS[day]}</span>
                  {isToday && <span className="block text-[10px] font-medium opacity-75">Today</span>}
                </div>
                <div className={`rounded-b-xl border border-t-0 min-h-[180px] p-1.5 space-y-1.5 ${isToday ? 'bg-primary/5 border-primary/20' : 'bg-slate-50 border-slate-200'}`}>
                  {daySchedules.length === 0 && (
                    <div className="text-center py-10 text-slate-300 text-xs">No classes</div>
                  )}
                  {daySchedules.map((s) => {
                    const ci = subjectColorMap.get(s.subject_id) ?? 0;
                    return (
                      <div key={s.id} className={`rounded-lg border p-2.5 transition-shadow hover:shadow-md ${CARD_COLORS[ci]}`}>
                        <div className="font-semibold text-xs leading-tight mb-1">{s.subject?.code || s.subject?.name || '—'}</div>
                        <div className="flex items-center gap-1 text-[10px] opacity-75 mb-0.5">
                          <Clock size={10} /> {formatTime(s.time_start)} – {formatTime(s.time_end)}
                        </div>
                        <div className="text-[10px] opacity-75 truncate">{s.section?.grade_level} - {s.section?.name}</div>
                        {s.room && (
                          <div className="flex items-center gap-1 text-[10px] opacity-75">
                            <MapPin size={10} /> {s.room}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          </div>
        </div>
      ) : (
        /* Single day detail view */
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className={`px-5 py-3 border-b ${activeDay === today ? 'bg-primary/5 border-primary/20' : 'bg-slate-50 border-slate-200'}`}>
            <h3 className="text-base font-semibold text-slate-800">{DAY_FULL[activeDay]}{activeDay === today ? ' (Today)' : ''}</h3>
            <p className="text-xs text-slate-500">{byDay.get(activeDay)?.length ?? 0} class{(byDay.get(activeDay)?.length ?? 0) !== 1 ? 'es' : ''}</p>
          </div>
          <div className="divide-y divide-slate-100">
            {(byDay.get(activeDay) ?? []).length === 0 && (
              <div className="px-5 py-12 text-center text-slate-400 text-sm">No classes on {DAY_FULL[activeDay]}.</div>
            )}
            {(byDay.get(activeDay) ?? []).map((s) => {
              const ci = subjectColorMap.get(s.subject_id) ?? 0;
              return (
                <div key={s.id} className="flex items-stretch hover:bg-slate-50 transition-colors">
                  {/* Time column */}
                  <div className="w-28 shrink-0 flex flex-col items-center justify-center py-4 px-3 border-r border-slate-100">
                    <span className="text-sm font-bold text-slate-800">{formatTime(s.time_start)}</span>
                    <span className="text-[10px] text-slate-400">to</span>
                    <span className="text-sm font-bold text-slate-800">{formatTime(s.time_end)}</span>
                  </div>
                  {/* Details */}
                  <div className="flex-1 p-4 flex items-center gap-4">
                    <div className={`w-1.5 h-12 rounded-full ${BADGE_COLORS[ci].split(' ')[0]}`} />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-800">{s.subject?.name}</div>
                      <div className="text-sm text-slate-500">{s.subject?.code}</div>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-slate-500">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${BADGE_COLORS[ci]}`}>
                        {s.section?.grade_level} - {s.section?.name}
                      </span>
                      {s.room && (
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          <MapPin size={12} /> {s.room}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
