import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear } from '../../contexts/AcademicYearContext';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import { useToast } from '../../contexts/ToastContext';
import { useCachedState, hasCached } from '../../lib/pageCache';
import { mapEnrollmentRoster } from '../../lib/academicYearRoster';
import { friendlyReadError, resilientRead } from '../../lib/resilientRequest';
import type { Schedule, Student, AttendanceStatus } from '../../types';
import { Check, Save, ArrowLeft, Clock, MapPin, GraduationCap, Users, BookOpen, CheckCircle2, XCircle, AlertCircle, ShieldCheck, MessageSquare, X, Send } from 'lucide-react';

const CARD_COLORS = [
  { bg: 'bg-blue-50', border: 'border-blue-200', accent: 'bg-blue-500', text: 'text-blue-700', light: 'text-blue-500' },
  { bg: 'bg-emerald-50', border: 'border-emerald-200', accent: 'bg-emerald-500', text: 'text-emerald-700', light: 'text-emerald-500' },
  { bg: 'bg-violet-50', border: 'border-violet-200', accent: 'bg-violet-500', text: 'text-violet-700', light: 'text-violet-500' },
  { bg: 'bg-amber-50', border: 'border-amber-200', accent: 'bg-amber-500', text: 'text-amber-700', light: 'text-amber-500' },
  { bg: 'bg-rose-50', border: 'border-rose-200', accent: 'bg-rose-500', text: 'text-rose-700', light: 'text-rose-500' },
  { bg: 'bg-cyan-50', border: 'border-cyan-200', accent: 'bg-cyan-500', text: 'text-cyan-700', light: 'text-cyan-500' },
  { bg: 'bg-pink-50', border: 'border-pink-200', accent: 'bg-pink-500', text: 'text-pink-700', light: 'text-pink-500' },
  { bg: 'bg-teal-50', border: 'border-teal-200', accent: 'bg-teal-500', text: 'text-teal-700', light: 'text-teal-500' },
];

function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

const STATUS_CONFIG: { value: AttendanceStatus; label: string; icon: typeof Check; inactive: string; active: string }[] = [
  { value: 'present', label: 'Present', icon: CheckCircle2, inactive: 'bg-slate-100 text-slate-400 hover:bg-green-50 hover:text-green-500', active: 'bg-green-500 text-white shadow-sm shadow-green-200' },
  { value: 'absent', label: 'Absent', icon: XCircle, inactive: 'bg-slate-100 text-slate-400 hover:bg-red-50 hover:text-red-500', active: 'bg-red-500 text-white shadow-sm shadow-red-200' },
  { value: 'late', label: 'Late', icon: AlertCircle, inactive: 'bg-slate-100 text-slate-400 hover:bg-amber-50 hover:text-amber-500', active: 'bg-amber-500 text-white shadow-sm shadow-amber-200' },
  { value: 'excused', label: 'Excused', icon: ShieldCheck, inactive: 'bg-slate-100 text-slate-400 hover:bg-blue-50 hover:text-blue-500', active: 'bg-blue-500 text-white shadow-sm shadow-blue-200' },
];

export default function TakeAttendancePage() {
  const { user, hasFeature } = useAuth();
  const { activeYear, isViewingCurrentYear, canWriteToActiveYear } = useAcademicYear();
  const { showToast } = useToast();
  const [schedules, setSchedules] = useCachedState<Schedule[]>('inst-take-attendance', []);
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<Record<string, AttendanceStatus>>({});
  const [loading, setLoading] = useState(!hasCached('inst-take-attendance'));
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [takenScheduleIds, setTakenScheduleIds] = useState<Set<string>>(new Set());
  const [messageModal, setMessageModal] = useState<{ open: boolean; studentId: string; studentName: string } | null>(null);
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);

  const attendanceEnabled = hasFeature('attendance_take');
  const messagingEnabled = hasFeature('parent_messaging');
  const attendanceWritable = attendanceEnabled && canWriteToActiveYear;
  const messagingWritable = messagingEnabled && canWriteToActiveYear;

  useEffect(() => {
    async function load() {
      let query = supabase
        .from('schedules')
        .select('*, subject:subjects(*), section:sections(*)')
        .eq('instructor_id', user!.id);
      if (activeYear?.id) query = query.eq('academic_year_id', activeYear.id);
      const { data } = await query.order('day_of_week').order('time_start');
      setSchedules((data as any) ?? []);
      setLoading(false);
    }
    load();
  }, [user, activeYear]);

  useRealtimeRefresh(['schedules', 'attendance_records'], () => {
    let query = supabase.from('schedules').select('*, subject:subjects(*), section:sections(*)').eq('instructor_id', user!.id);
    if (activeYear?.id) query = query.eq('academic_year_id', activeYear.id);
    query.order('day_of_week').order('time_start').then(({ data }) => setSchedules((data as any) ?? []));
  }, { column: 'instructor_id', value: user?.id });

  // Check which schedules already have attendance for the selected date
  useEffect(() => {
    async function checkTaken() {
      if (schedules.length === 0 || !activeYear?.id) return;
      try {
        const { data, error } = await resilientRead((signal) => supabase
          .rpc('get_taken_attendance_schedule_ids', {
            p_academic_year_id: activeYear.id,
            p_date: date,
          })
          .abortSignal(signal));
        if (error) return;
        const taken = new Set<string>();
        if (data) for (const r of data) taken.add(r.schedule_id);
        setTakenScheduleIds(taken);
      } catch (requestError) {
        console.error('Could not check taken attendance schedules:', requestError);
      }
    }
    checkTaken();
  }, [schedules, date, activeYear?.id]);

  // Re-fetch attendance when date changes
  useEffect(() => {
    if (selectedSchedule) {
      selectSchedule(selectedSchedule);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Group schedules by subject+section for card view
  const groupedCards = useMemo(() => {
    const map = new Map<string, { subjectName: string; subjectCode: string; sectionName: string; gradeLevel: string; sectionId: string; subjectId: string; schedules: Schedule[] }>();
    schedules.forEach((s) => {
      const key = `${s.subject_id}__${s.section_id}`;
      if (!map.has(key)) {
        map.set(key, {
          subjectName: s.subject?.name ?? '',
          subjectCode: s.subject?.code ?? '',
          sectionName: s.section?.name ?? '',
          gradeLevel: s.section?.grade_level ?? '',
          sectionId: s.section_id,
          subjectId: s.subject_id,
          schedules: [],
        });
      }
      map.get(key)!.schedules.push(s);
    });
    return [...map.values()];
  }, [schedules]);

  // Color map by subject
  const subjectColorMap = useMemo(() => {
    const map = new Map<string, number>();
    const ids = [...new Set(schedules.map((s) => s.subject_id))];
    ids.forEach((id, i) => map.set(id, i % CARD_COLORS.length));
    return map;
  }, [schedules]);

  async function selectSchedule(schedule: Schedule) {
    setSelectedSchedule(schedule);
    setSaved(false);
    setSearchQuery('');
    setLoadingStudents(true);

    const yearId = schedule.academic_year_id ?? activeYear?.id;
    try {
      const enrollmentResponse = yearId
        ? await resilientRead((signal) => supabase
            .from('student_enrollments')
            .select('student_id, section_id, student:students!inner(*), section:sections!inner(*)')
            .eq('school_id', user!.school_id!)
            .eq('academic_year_id', yearId)
            .eq('section_id', schedule.section_id)
            .order('last_name', { foreignTable: 'student' })
            .abortSignal(signal))
        : { data: [], error: null };
      if (enrollmentResponse.error) throw new Error(enrollmentResponse.error.message);
      const enrollmentData = enrollmentResponse.data;
      const studentData = mapEnrollmentRoster((enrollmentData ?? []) as any) as Student[];
      setStudents(studentData);

      const { data: existingRecords, error: recordsError } = await resilientRead((signal) => supabase
        .from('attendance_records')
        .select('student_id, status')
        .eq('schedule_id', schedule.id)
        .eq('date', date)
        .abortSignal(signal));
      if (recordsError) throw new Error(recordsError.message);

      const existing: Record<string, AttendanceStatus> = {};
      if (existingRecords) {
        for (const r of existingRecords) {
          existing[r.student_id] = r.status as AttendanceStatus;
        }
      }

      const att: Record<string, AttendanceStatus> = {};
      for (const s of studentData) {
        att[s.id] = existing[s.id] ?? 'present';
      }
      setAttendance(att);
    } catch (requestError) {
      setStudents([]);
      setAttendance({});
      showToast(friendlyReadError(requestError), 'error');
    } finally {
      setLoadingStudents(false);
    }
  }

  function setStatus(studentId: string, status: AttendanceStatus) {
    setAttendance((prev) => ({ ...prev, [studentId]: status }));
    setSaved(false);
  }

  function markAll(status: AttendanceStatus) {
    setAttendance((prev) => {
      const updated = { ...prev };
      for (const id of Object.keys(updated)) updated[id] = status;
      return updated;
    });
    setSaved(false);
  }

  async function handleSave() {
    if (!selectedSchedule) return;
    if (!attendanceWritable) {
      alert(isViewingCurrentYear ? 'Attendance write access is currently unavailable.' : 'Historical academic years are read-only.');
      return;
    }
    setSaving(true);

    const records = Object.entries(attendance).map(([student_id, status]) => ({
      student_id,
      status,
    }));

    const { data: saveResult, error: saveError } = await supabase.rpc('replace_class_attendance', {
      p_schedule_id: selectedSchedule.id,
      p_date: date,
      p_records: records,
    });

    if (saveError) {
      setSaving(false);
      showToast(`Attendance was not saved: ${saveError.message}`, 'error');
      return;
    }

    const insertedRecords = ((saveResult as { records?: any[] } | null)?.records ?? []);

    // Fire push notifications to parents in ONE batch call (non-blocking)
    let alertsSent = 0;

    if (insertedRecords) {
      // ── Batch push: single edge-function call for all records ──
      supabase.functions
        .invoke('send-push-notification-batch', {
          body: {
            records: insertedRecords.map((r) => ({
              id: r.id,
              student_id: r.student_id,
              schedule_id: r.schedule_id,
              status: r.status,
              date: r.date,
            })),
          },
        })
        .then(({ data, error }) => {
          if (error) {
            console.error('[batch-push] invoke error:', error);
          } else {
            console.log('[batch-push] summary:', data?.summary);
          }
        })
        .catch((err: unknown) => {
          console.error('[batch-push] unexpected error:', err);
        });

      // ── Auto-alert parents on 3 consecutive absences ──
      const absentStudentIds = insertedRecords
        .filter(r => r.status === 'absent')
        .map(r => r.student_id);

      for (const studentId of absentStudentIds) {
        try {
          const { data: recentRecords } = await supabase
            .from('attendance_records')
            .select('status')
            .eq('schedule_id', selectedSchedule.id)
            .eq('student_id', studentId)
            .order('date', { ascending: false })
            .limit(4);

          if (recentRecords && recentRecords.length >= 3) {
            const last3AllAbsent = recentRecords.slice(0, 3).every(r => r.status === 'absent');
            const fourthIsAbsent = recentRecords.length >= 4 && recentRecords[3].status === 'absent';

            // Only send on exactly the 3rd consecutive absence (not 4th, 5th, etc.)
            if (last3AllAbsent && !fourthIsAbsent) {
              const student = students.find(s => s.id === studentId);
              const studentName = student ? `${student.first_name} ${student.last_name}` : 'Your child';
              const subjectName = selectedSchedule.subject?.name || 'a subject';

              await supabase.functions.invoke('send-message', {
                body: {
                  student_id: studentId,
                  schedule_id: selectedSchedule.id,
                  instructor_id: user!.id,
                  message: `⚠️ Attendance Alert: ${studentName} has been absent for 3 consecutive class sessions in ${subjectName}. Please coordinate with the school regarding your child's attendance.`,
                },
              });
              alertsSent++;
              console.log(`[auto-alert] Sent 3-absence alert for student ${studentId}`);
            }
          }
        } catch (err) {
          console.error(`[auto-alert] Error checking consecutive absences for ${studentId}:`, err);
        }
      }
    }

    setSaving(false);
    setSaved(true);
    if (alertsSent > 0) {
      showToast(`Attendance saved. ${alertsSent} parent${alertsSent > 1 ? 's' : ''} alerted for 3 consecutive absences.`, 'warning');
    } else {
      showToast('Attendance saved successfully.');
    }
  }

  // Attendance summary
  const summary = useMemo(() => {
    const counts = { present: 0, absent: 0, late: 0, excused: 0 };
    Object.values(attendance).forEach((s) => counts[s]++);
    return counts;
  }, [attendance]);

  const filteredStudents = students.filter((s) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return s.last_name.toLowerCase().includes(q) || s.first_name.toLowerCase().includes(q) || (s.lrn?.toLowerCase().includes(q));
  });

  async function sendMessage() {
    if (!messageModal || !messageText.trim() || !selectedSchedule || !user) return;
    if (!messagingWritable) {
      showToast(isViewingCurrentYear ? 'Parent messaging is currently unavailable.' : 'Historical academic years are read-only.', 'warning');
      return;
    }
    setSendingMessage(true);

    try {
      const { data: json, error } = await supabase.functions.invoke('send-message', {
        body: {
          student_id: messageModal.studentId,
          schedule_id: selectedSchedule.id,
          instructor_id: user.id,
          message: messageText.trim(),
        },
      });

      console.log('[send-message] response:', { json, error });

      if (!error) {
        const msg = (json as any)?.message || 'Message sent to parent!';
        const pushOk = (json as any)?.delivered_via_push;
        const details = (json as any)?.details;
        if (!pushOk && details) {
          showToast(`${msg} (Push failed: ${details})`, 'warning');
        } else {
          showToast(msg);
        }
        setMessageModal(null);
        setMessageText('');
      } else {
        console.error('[send-message] error:', error);
        showToast((json as any)?.error || error.message || 'Failed to send message', 'error');
      }
    } catch {
      showToast('Error sending message', 'error');
    } finally {
      setSendingMessage(false);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  // ── Attendance Sheet View ──
  if (selectedSchedule) {
    return (
      <>
        <div className="space-y-4">
        {/* Top bar */}
        <div className="flex items-center gap-3">
          <button onClick={() => { setSelectedSchedule(null); setStudents([]); }} className="w-9 h-9 flex items-center justify-center rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors cursor-pointer">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-slate-800">{selectedSchedule.subject?.name}</h2>
            <p className="text-sm text-slate-500">{selectedSchedule.subject?.code} &middot; {selectedSchedule.section?.grade_level} - {selectedSchedule.section?.name} &middot; {capitalize(selectedSchedule.day_of_week)} {formatTime(selectedSchedule.time_start)}–{formatTime(selectedSchedule.time_end)}{selectedSchedule.room ? ` &middot; ${selectedSchedule.room}` : ''}</p>
          </div>
        </div>

        {/* Controls bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">Date:</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none" />
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Mark all:</span>
            {STATUS_CONFIG.map((s) => (
              <button key={s.value} onClick={() => markAll(s.value)} disabled={!attendanceWritable} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-50 ${s.inactive}`} title={`Mark all ${s.label}`}>{s.label}</button>
            ))}
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !attendanceWritable}
            className="bg-primary hover:bg-primary-dark text-white px-5 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {saved ? <><Check size={16} /> Saved!</> : saving ? 'Saving...' : <><Save size={16} /> Save</>}
          </button>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Present', count: summary.present, color: 'bg-green-50 text-green-700 border-green-200' },
            { label: 'Absent', count: summary.absent, color: 'bg-red-50 text-red-700 border-red-200' },
            { label: 'Late', count: summary.late, color: 'bg-amber-50 text-amber-700 border-amber-200' },
            { label: 'Excused', count: summary.excused, color: 'bg-blue-50 text-blue-700 border-blue-200' },
          ].map((s) => (
            <div key={s.label} className={`rounded-xl border px-4 py-3 flex items-center justify-between ${s.color}`}>
              <span className="text-sm font-medium">{s.label}</span>
              <span className="text-xl font-bold">{s.count}</span>
            </div>
          ))}
        </div>

        {/* Student search */}
        {students.length > 10 && (
          <input
            type="text"
            placeholder="Search student name or LRN..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none"
          />
        )}

        {/* Student list */}
        {loadingStudents ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
        ) : students.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <Users size={40} className="text-slate-300 mx-auto mb-2" />
            <p className="text-slate-500 font-medium">No students in this section</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {filteredStudents.map((student, idx) => {
              const status = attendance[student.id];
              const statusConf = STATUS_CONFIG.find((s) => s.value === status)!;
              return (
                <div key={student.id} className={`flex items-center gap-4 px-5 py-3 ${idx > 0 ? 'border-t border-slate-100' : ''} hover:bg-slate-50/50 transition-colors`}>
                  {/* Number */}
                  <span className="w-7 text-xs text-slate-400 text-right shrink-0">{idx + 1}</span>
                  {/* Avatar */}
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0 ${statusConf.active.split(' ')[0]}`}>
                    {student.first_name.charAt(0)}{student.last_name.charAt(0)}
                  </div>
                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">{student.last_name}, {student.first_name}{student.middle_name ? ` ${student.middle_name.charAt(0)}.` : ''}</div>
                    <div className="text-xs text-slate-400">{student.lrn}</div>
                  </div>
                  {/* Status buttons */}
                  <div className="flex gap-1.5">
                    {STATUS_CONFIG.map((s) => (
                      <button
                        key={s.value}
                        onClick={() => setStatus(student.id, s.value)}
                        disabled={!attendanceWritable}
                        className={`px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-50 ${attendance[student.id] === s.value ? s.active : s.inactive}`}
                        title={s.label}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {/* Message button */}
                  <button
                    onClick={() => setMessageModal({ open: true, studentId: student.id, studentName: `${student.first_name} ${student.last_name}` })}
                    disabled={!messagingWritable}
                    className="p-2 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors cursor-pointer disabled:opacity-50"
                    title="Send message to parent"
                  >
                    <MessageSquare size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Message Modal */}
      {messageModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-full w-[500px] p-6 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-slate-800">Send Message to Parent</h3>
              <button onClick={() => setMessageModal(null)} className="text-slate-400 hover:text-slate-600">
                <X size={24} />
              </button>
            </div>
            <p className="text-sm text-slate-600 mb-4">Student: <strong>{messageModal.studentName}</strong></p>
            <textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="Enter message (max 160 characters for SMS)"
              maxLength={160}
              className="w-full px-4 py-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none resize-none h-24 mb-2"
            />
            <div className="text-xs text-slate-400 mb-4">{messageText.length}/160</div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setMessageModal(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                Cancel
              </button>
              <button
                onClick={sendMessage}
                disabled={sendingMessage || !messageText.trim() || !messagingWritable}
                className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-dark rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                <Send size={16} /> Send
              </button>
            </div>
          </div>
        </div>
      )}
      </>
    );
  }

  // ── Card Selection View ──
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Take Attendance</h2>
        <p className="text-sm text-slate-500 mt-1">Select a subject and section to begin.</p>
      </div>

      {/* Date picker */}
      <div className="bg-white rounded-xl border border-slate-200 px-5 py-3 flex items-center gap-3 w-fit">
        <label className="text-sm font-medium text-slate-600">Date:</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none" />
      </div>

      {groupedCards.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <BookOpen size={48} className="text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">No schedules assigned yet</p>
          <p className="text-slate-400 text-sm mt-1">Your classes will appear here once the admin assigns them.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groupedCards.map((card) => {
            const ci = subjectColorMap.get(card.subjectId) ?? 0;
            const color = CARD_COLORS[ci];
            // Get days list: e.g. "Mon, Tue, Wed, Thu, Fri"
            const daysSet = new Set(card.schedules.map((s) => s.day_of_week));
            const dayLabels = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
              .filter((d) => daysSet.has(d as any))
              .map((d) => capitalize(d).slice(0, 3));
            // Get time (assume same block)
            const first = card.schedules[0];

            return (
              <button
                key={`${card.subjectId}__${card.sectionId}`}
                onClick={() => {
                  // Check if any schedule in this card already has attendance
                  const todayKey = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date().getDay()];
                  const todaySchedule = card.schedules.find((s) => s.day_of_week === todayKey);
                  const targetSchedule = todaySchedule ?? first;
                  const alreadyTaken = card.schedules.some(s => takenScheduleIds.has(s.id));
                  if (alreadyTaken) {
                    if (!confirm('Attendance has already been taken for this subject today. Do you want to edit it?')) return;
                  }
                  selectSchedule(targetSchedule);
                }}
                className={`text-left rounded-2xl border-2 ${color.border} ${color.bg} p-5 hover:shadow-lg transition-all cursor-pointer group`}
              >
                {/* Accent bar */}
                <div className={`w-10 h-1.5 rounded-full ${color.accent} mb-4`} />

                {/* Already taken badge */}
                {card.schedules.some(s => takenScheduleIds.has(s.id)) && (
                  <div className="flex items-center gap-1.5 mb-3">
                    <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded-full flex items-center gap-1">
                      <Check size={10} /> Taken today
                    </span>
                  </div>
                )}

                {/* Subject */}
                <h3 className={`text-lg font-bold ${color.text} mb-0.5`}>{card.subjectName}</h3>
                <p className="text-sm opacity-60 mb-4">{card.subjectCode}</p>

                {/* Section */}
                <div className="flex items-center gap-2 text-sm mb-2">
                  <GraduationCap size={14} className={color.light} />
                  <span className={color.text}>{card.gradeLevel} - {card.sectionName}</span>
                </div>

                {/* Time */}
                <div className="flex items-center gap-2 text-sm mb-2">
                  <Clock size={14} className={color.light} />
                  <span className={color.text}>{formatTime(first.time_start)} – {formatTime(first.time_end)}</span>
                </div>

                {/* Room */}
                {first.room && (
                  <div className="flex items-center gap-2 text-sm mb-2">
                    <MapPin size={14} className={color.light} />
                    <span className={color.text}>{first.room}</span>
                  </div>
                )}

                {/* Days */}
                <div className="flex flex-wrap gap-1 mt-3">
                  {dayLabels.map((d) => (
                    <span key={d} className={`px-2 py-0.5 rounded text-[10px] font-semibold ${color.accent} text-white`}>{d}</span>
                  ))}
                </div>

                {/* Hover indicator */}
                <div className={`mt-4 text-xs font-medium ${color.light} opacity-0 group-hover:opacity-100 transition-opacity`}>
                  Click to take attendance &rarr;
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
