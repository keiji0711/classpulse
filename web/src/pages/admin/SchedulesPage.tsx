import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear } from '../../contexts/AcademicYearContext';
import { useToast } from '../../contexts/ToastContext';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import { useCachedState, hasCached } from '../../lib/pageCache';
import type { Schedule, Section, Subject, AppUser, DayOfWeek } from '../../types';
import { Plus, Trash2, X, Clock, MapPin, User, Download, FileSpreadsheet } from 'lucide-react';
import { downloadCsv, downloadExcel, type ExportColumn } from '../../lib/export';

const DAYS: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_SHORT: Record<DayOfWeek, string> = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };

const CARD_COLORS = [
  'bg-blue-50 border-blue-200 text-blue-900',
  'bg-emerald-50 border-emerald-200 text-emerald-900',
  'bg-violet-50 border-violet-200 text-violet-900',
  'bg-amber-50 border-amber-200 text-amber-900',
  'bg-rose-50 border-rose-200 text-rose-900',
  'bg-cyan-50 border-cyan-200 text-cyan-900',
  'bg-fuchsia-50 border-fuchsia-200 text-fuchsia-900',
  'bg-lime-50 border-lime-200 text-lime-900',
  'bg-orange-50 border-orange-200 text-orange-900',
  'bg-teal-50 border-teal-200 text-teal-900',
];

function formatTime(t: string) {
  const [h, m] = t.split(':');
  const hr = parseInt(h);
  const ampm = hr >= 12 ? 'PM' : 'AM';
  const h12 = hr % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

export default function SchedulesPage() {
  const { user } = useAuth();
  const { activeYear, canWriteToActiveYear, isSelectedYearDraft } = useAcademicYear();
  const canManageSchedules = canWriteToActiveYear || isSelectedYearDraft;
  const { showToast } = useToast();
  const [schedules, setSchedules] = useCachedState<Schedule[]>('admin-schedules', []);
  const [instructors, setInstructors] = useCachedState<AppUser[]>('admin-schedules-instructors', []);
  const [sections, setSections] = useCachedState<(Section & { section_subjects?: { subject: Subject }[] })[]>('admin-schedules-sections', []);
  const [subjects, setSubjects] = useCachedState<Subject[]>('admin-schedules-subjects', []);
  const [filteredSubjects, setFilteredSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(!hasCached('admin-schedules'));
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ instructor_id: '', subject_id: '', section_id: '', time_start: '08:00', time_end: '09:00', room: '' });
  const [selectedDays, setSelectedDays] = useState<Set<DayOfWeek>>(new Set(DAYS.slice(0, 5))); // Mon-Fri default
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [viewSection, setViewSection] = useState('all');
  const [viewInstructor, setViewInstructor] = useState('all');

  useEffect(() => { fetchData(); }, [activeYear]);

  useRealtimeRefresh(['schedules', 'users', 'sections', 'subjects'], fetchData, { column: 'school_id', value: user?.school_id });

  async function fetchData() {
    const schoolId = user!.school_id!;
    let schedulesQuery = supabase.from('schedules').select('*, subject:subjects(*), section:sections(*), instructor:users(*)').eq('school_id', schoolId);
    if (activeYear?.id) schedulesQuery = schedulesQuery.eq('academic_year_id', activeYear.id);
    schedulesQuery = schedulesQuery.order('day_of_week').order('time_start');

    const [schedulesRes, instructorsRes, sectionsRes, subjectsRes] = await Promise.all([
      schedulesQuery,
      supabase.from('users').select('*').eq('school_id', schoolId).eq('role', 'instructor').order('full_name'),
      supabase.from('sections').select('*, section_subjects(subject:subjects(*))').eq('school_id', schoolId).order('name'),
      supabase.from('subjects').select('*').eq('school_id', schoolId).order('name'),
    ]);
    setSchedules((schedulesRes.data as any) ?? []);
    setInstructors(instructorsRes.data ?? []);
    setSections((sectionsRes.data as any) ?? []);
    setSubjects(subjectsRes.data ?? []);
    setLoading(false);
  }

  function getSubjectsForSection(sectionId: string): Subject[] {
    const section = sections.find((s) => s.id === sectionId);
    const assigned = (section?.section_subjects ?? []).map((ss: any) => ss.subject).filter(Boolean) as Subject[];
    return assigned.length > 0 ? assigned : subjects;
  }

  function openCreate() {
    if (!canManageSchedules) { showToast('This academic year is read-only.', 'warning'); return; }
    const firstSection = sections[0]?.id ?? '';
    const availableSubjects = firstSection ? getSubjectsForSection(firstSection) : subjects;
    setFilteredSubjects(availableSubjects);
    setForm({
      instructor_id: instructors[0]?.id ?? '',
      subject_id: availableSubjects[0]?.id ?? '',
      section_id: firstSection,
      time_start: '08:00',
      time_end: '09:00',
      room: '',
    });
    setSelectedDays(new Set(DAYS.slice(0, 5))); // Mon-Fri
    setError('');
    setShowModal(true);
  }

  function handleSectionChange(sectionId: string) {
    const available = getSubjectsForSection(sectionId);
    setFilteredSubjects(available);
    setForm((prev) => ({ ...prev, section_id: sectionId, subject_id: available[0]?.id ?? '' }));
  }

  function toggleDay(day: DayOfWeek) {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  function toggleAllWeekdays() {
    const weekdays = DAYS.slice(0, 5) as DayOfWeek[];
    const allSelected = weekdays.every((d) => selectedDays.has(d));
    if (allSelected) {
      setSelectedDays(new Set());
    } else {
      setSelectedDays(new Set(weekdays));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canManageSchedules) { setError('This academic year is read-only.'); return; }
    setSaving(true);
    setError('');

    if (selectedDays.size === 0) {
      setError('Select at least one day');
      setSaving(false);
      return;
    }

    if (form.time_start >= form.time_end) {
      setError('Start time must be before end time');
      setSaving(false);
      return;
    }

    // Check conflicts against existing schedules
    const conflicts: string[] = [];
    for (const day of selectedDays) {
      const overlapping = schedules.filter(
        (s) =>
          s.day_of_week === day &&
          s.time_start < form.time_end &&
          s.time_end > form.time_start
      );

      for (const s of overlapping) {
        if (s.instructor_id === form.instructor_id) {
          const instrName = s.instructor?.full_name ?? 'Teacher';
          conflicts.push(`${capitalize(day)}: ${instrName} already has "${s.subject?.name ?? 'a class'}" at ${s.time_start}–${s.time_end}`);
        }
        if (s.section_id === form.section_id) {
          const secName = s.section?.name ?? 'Section';
          conflicts.push(`${capitalize(day)}: ${secName} already has "${s.subject?.name ?? 'a class'}" at ${s.time_start}–${s.time_end}`);
        }
        if (form.room && s.room && s.room === form.room) {
          conflicts.push(`${capitalize(day)}: ${s.room} is occupied by "${s.subject?.name ?? 'a class'}" at ${s.time_start}–${s.time_end}`);
        }
      }
    }

    if (conflicts.length > 0) {
      setError('Schedule conflicts found:\n• ' + [...new Set(conflicts)].join('\n• '));
      setSaving(false);
      return;
    }

    const rows = Array.from(selectedDays).map((day) => ({
      instructor_id: form.instructor_id,
      subject_id: form.subject_id,
      section_id: form.section_id,
      day_of_week: day,
      time_start: form.time_start,
      time_end: form.time_end,
      room: form.room,
      school_id: user!.school_id!,
      academic_year_id: activeYear?.id ?? null,
    }));

    const { error: insertError } = await supabase.from('schedules').insert(rows);

    if (insertError) { setError(insertError.message); setSaving(false); return; }
    setSaving(false);
    setShowModal(false);
    fetchData();
    showToast('Schedule created successfully.');
  }

  async function handleDelete(id: string) {
    if (!canManageSchedules) { showToast('This academic year is read-only.', 'warning'); return; }
    if (!confirm('Delete this schedule?')) return;
    const { error } = await supabase.from('schedules').delete().eq('id', id);
    if (error) { showToast(`Failed to delete: ${error.message}`, 'error'); return; }
    fetchData();
    showToast('Schedule deleted.');
  }

  function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // Build a color map for subjects
  const subjectColorMap = new Map<string, string>();
  const uniqueSubjectIds = [...new Set(schedules.map((s) => s.subject_id))];
  uniqueSubjectIds.forEach((id, i) => { subjectColorMap.set(id, CARD_COLORS[i % CARD_COLORS.length]); });

  // Filter schedules
  const filtered = schedules.filter((s) => {
    if (viewSection !== 'all' && s.section_id !== viewSection) return false;
    if (viewInstructor !== 'all' && s.instructor_id !== viewInstructor) return false;
    return true;
  });
  const scheduleExportRows = [...filtered].sort((a, b) => DAYS.indexOf(a.day_of_week) - DAYS.indexOf(b.day_of_week) || a.time_start.localeCompare(b.time_start));

  const exportColumns: ExportColumn<Schedule>[] = [
    { header: 'Day', value: (schedule) => capitalize(schedule.day_of_week), width: 12 },
    { header: 'Start Time', value: (schedule) => formatTime(schedule.time_start), width: 14 },
    { header: 'End Time', value: (schedule) => formatTime(schedule.time_end), width: 14 },
    { header: 'Subject Code', value: (schedule) => schedule.subject?.code ?? '', width: 16 },
    { header: 'Subject', value: (schedule) => schedule.subject?.name ?? '', width: 28 },
    { header: 'Grade Level', value: (schedule) => schedule.section?.grade_level ?? '', width: 16 },
    { header: 'Section', value: (schedule) => schedule.section?.name ?? '', width: 20 },
    { header: 'Teacher', value: (schedule) => schedule.instructor?.full_name ?? '', width: 26 },
    { header: 'Room', value: (schedule) => schedule.room ?? '', width: 16 },
  ];
  const exportOptions = {
    title: 'Class Schedule',
    subtitle: `Academic Year ${activeYear?.name ?? 'Not selected'}`,
    metadata: [
      { label: 'Section filter', value: viewSection === 'all' ? 'All sections' : sections.find((section) => section.id === viewSection)?.name ?? 'Selected section' },
      { label: 'Teacher filter', value: viewInstructor === 'all' ? 'All teachers' : instructors.find((instructor) => instructor.id === viewInstructor)?.full_name ?? 'Selected teacher' },
    ],
    generatedBy: user?.full_name,
  };

  // Group by day
  const byDay = new Map<DayOfWeek, Schedule[]>();
  DAYS.forEach((d) => byDay.set(d, []));
  filtered.forEach((s) => byDay.get(s.day_of_week)?.push(s));
  // Sort each day by time
  byDay.forEach((arr) => arr.sort((a, b) => a.time_start.localeCompare(b.time_start)));

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div><h2 className="text-2xl font-bold text-slate-800">Schedules</h2><p className="mt-1 text-sm text-slate-500">Weekly timetable for {activeYear?.name ?? 'the selected academic year'}.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => downloadCsv('class-schedule', scheduleExportRows, exportColumns, exportOptions)} disabled={!filtered.length} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Download size={16} /> CSV</button>
          <button onClick={() => downloadExcel('class-schedule', 'Schedule', scheduleExportRows, exportColumns, exportOptions)} disabled={!filtered.length} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><FileSpreadsheet size={16} /> Excel</button>
          <button onClick={openCreate} disabled={!canManageSchedules} className="bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"><Plus size={16} /> Add Schedule</button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">Section:</label>
          <select value={viewSection} onChange={(e) => setViewSection(e.target.value)} className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-primary focus:border-primary outline-none">
            <option value="all">All Sections</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.grade_level} - {s.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">Teacher:</label>
          <select value={viewInstructor} onChange={(e) => setViewInstructor(e.target.value)} className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-primary focus:border-primary outline-none">
            <option value="all">All Teachers</option>
            {instructors.map((i) => <option key={i.id} value={i.id}>{i.full_name}</option>)}
          </select>
        </div>
        {(viewSection !== 'all' || viewInstructor !== 'all') && (
          <button onClick={() => { setViewSection('all'); setViewInstructor('all'); }} className="text-sm text-primary hover:text-primary-dark font-medium cursor-pointer">Clear filters</button>
        )}
      </div>

      {/* Weekly Timetable Grid */}
      <div className="grid grid-cols-6 gap-3">
        {DAYS.map((day) => {
          const daySchedules = byDay.get(day) ?? [];
          return (
            <div key={day} className="min-w-0">
              {/* Day header */}
              <div className="bg-slate-800 text-white text-center py-2 rounded-t-xl">
                <span className="text-sm font-semibold">{DAY_SHORT[day]}</span>
              </div>
              {/* Cards */}
              <div className="bg-slate-50 rounded-b-xl border border-t-0 border-slate-200 min-h-[200px] p-1.5 space-y-1.5">
                {daySchedules.length === 0 && (
                  <div className="text-center py-8 text-slate-300 text-xs">No classes</div>
                )}
                {daySchedules.map((s) => (
                  <div
                    key={s.id}
                    className={`group relative rounded-lg border p-2.5 transition-shadow hover:shadow-md ${subjectColorMap.get(s.subject_id) ?? CARD_COLORS[0]}`}
                  >
                    {/* Delete button */}
                    <button
                      onClick={() => handleDelete(s.id)}
                      disabled={!canManageSchedules}
                      className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-opacity cursor-pointer disabled:hidden"
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>

                    {/* Subject name */}
                    <div className="font-semibold text-xs leading-tight mb-1 pr-4">
                      {s.subject?.code || s.subject?.name || '—'}
                    </div>

                    {/* Time */}
                    <div className="flex items-center gap-1 text-[10px] opacity-75 mb-0.5">
                      <Clock size={10} />
                      {formatTime(s.time_start)} – {formatTime(s.time_end)}
                    </div>

                    {/* Section (only show when not filtered) */}
                    {viewSection === 'all' && (
                      <div className="text-[10px] opacity-75 truncate">{s.section?.grade_level} - {s.section?.name}</div>
                    )}

                    {/* Instructor */}
                    <div className="flex items-center gap-1 text-[10px] opacity-75 truncate">
                      <User size={10} className="shrink-0" />
                      {s.instructor?.full_name ?? '—'}
                    </div>

                    {/* Room */}
                    {s.room && (
                      <div className="flex items-center gap-1 text-[10px] opacity-75">
                        <MapPin size={10} className="shrink-0" />
                        {s.room}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && schedules.length > 0 && (
        <div className="text-center py-4 text-sm text-slate-400 mt-2">No schedules match the selected filters.</div>
      )}

      {/* Add Schedule Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-800">Add Schedule</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {error && <div className="bg-red-50 text-red-600 rounded-lg p-3 text-sm whitespace-pre-line">{error}</div>}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Teacher</label>
                  <select required value={form.instructor_id} onChange={(e) => setForm({ ...form, instructor_id: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none">
                    <option value="">Select</option>
                    {instructors.map((i) => <option key={i.id} value={i.id}>{i.full_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Section</label>
                  <select required value={form.section_id} onChange={(e) => handleSectionChange(e.target.value)} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none">
                    <option value="">Select</option>
                    {sections.map((s) => <option key={s.id} value={s.id}>{s.grade_level} - {s.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Subject</label>
                  <select required value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none">
                    <option value="">Select</option>
                    {filteredSubjects.map((s) => <option key={s.id} value={s.id}>{s.code} – {s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Room</label>
                  <input type="text" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none" placeholder="e.g. Room 101" />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-slate-700">Days</label>
                  <button type="button" onClick={toggleAllWeekdays} className="text-xs text-primary hover:text-primary-dark font-medium cursor-pointer">
                    {DAYS.slice(0, 5).every((d) => selectedDays.has(d)) ? 'Deselect Mon–Fri' : 'Select Mon–Fri'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDay(d)}
                      className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors cursor-pointer ${selectedDays.has(d) ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >{capitalize(d).slice(0, 3)}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Start Time</label>
                  <input type="time" required value={form.time_start} onChange={(e) => setForm({ ...form, time_start: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">End Time</label>
                  <input type="time" required value={form.time_end} onChange={(e) => setForm({ ...form, time_end: e.target.value })} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none" />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-dark rounded-lg transition-colors disabled:opacity-50 cursor-pointer">{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
