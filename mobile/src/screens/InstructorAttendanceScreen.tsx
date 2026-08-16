import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { FUNCTIONS_URL, SUPABASE_ANON_KEY, supabase, getAuthHeaders } from '../lib/supabase';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { enqueueAttendancePayload, submitAttendancePayload } from '../lib/instructorAttendanceQueue';
import type { AttendanceStatus, Schedule, Student } from '../types';
import { colors } from '../theme/colors';
import GridBackground from '../components/GridBackground';

const CORRECTION_WINDOW_MINUTES = 180;

const STATUS_OPTIONS: Array<{ status: AttendanceStatus; label: string; color: string; activeColor: string }> = [
  { status: 'present', label: 'P', color: '#14532d', activeColor: '#16a34a' },
  { status: 'absent', label: 'A', color: '#7f1d1d', activeColor: '#dc2626' },
  { status: 'late', label: 'L', color: '#78350f', activeColor: '#d97706' },
  { status: 'excused', label: 'E', color: '#0c4a6e', activeColor: '#0369a1' },
];

function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function getTodayKey() {
  return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date().getDay()];
}

function parseScheduleEnd(date: string, endTime: string) {
  const [h, m] = endTime.split(':').map(Number);
  const end = new Date(`${date}T00:00:00`);
  end.setHours(h, m, 0, 0);
  return end;
}

function canEditExistingAttendance(date: string, schedule: Schedule, hasExisting: boolean) {
  if (!hasExisting) {
    return true;
  }

  const end = parseScheduleEnd(date, schedule.time_end);
  const deadline = new Date(end.getTime() + CORRECTION_WINDOW_MINUTES * 60 * 1000);
  return Date.now() <= deadline.getTime();
}

export default function InstructorAttendanceScreen() {
  const { instructorUser, queueCount, refreshQueueCount, syncQueue } = useAuth();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [attendanceCounts, setAttendanceCounts] = useState<Record<string, number>>({});
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<Record<string, AttendanceStatus>>({});
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  const [messageOpen, setMessageOpen] = useState(false);
  const [messageTarget, setMessageTarget] = useState<Student | null>(null);
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [yearName, setYearName] = useState<string | null>(null);

  const date = getToday();
  const dayKey = getTodayKey();

  const loadClasses = useCallback(async () => {
    if (!instructorUser) {
      return;
    }

    // Get current academic year for this school
    let academicYearId: string | null = null;
    if (instructorUser.school_id) {
      const { data: yearRow } = await supabase
        .from('academic_years')
        .select('id, name')
        .eq('school_id', instructorUser.school_id)
        .eq('is_current', true)
        .single();
      academicYearId = yearRow?.id ?? null;
      setYearName(yearRow?.name ?? null);
    }

    let classQuery = supabase
      .from('schedules')
      .select('*, subject:subjects(*), section:sections(*)')
      .eq('instructor_id', instructorUser.id)
      .eq('day_of_week', dayKey)
      .order('time_start');

    if (academicYearId) {
      classQuery = classQuery.eq('academic_year_id', academicYearId);
    }

    const { data: classRows } = await classQuery;

    const list = (classRows as Schedule[]) ?? [];
    setSchedules(list);

    if (list.length === 0) {
      setAttendanceCounts({});
      return;
    }

    const ids = list.map((item) => item.id);
    const { data: records } = await supabase
      .from('attendance_records')
      .select('schedule_id')
      .in('schedule_id', ids)
      .eq('date', date);

    const counts: Record<string, number> = {};
    for (const id of ids) counts[id] = 0;
    (records ?? []).forEach((record) => {
      counts[record.schedule_id] = (counts[record.schedule_id] ?? 0) + 1;
    });
    setAttendanceCounts(counts);
  }, [date, dayKey, instructorUser]);

  useEffect(() => {
    loadClasses().finally(() => setLoading(false));
  }, [loadClasses]);

  // Re-fetch when academic year changes
  useEffect(() => {
    if (!instructorUser?.school_id) return;
    const channel = supabase
      .channel(`instructor-year-attend-${instructorUser.school_id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'academic_years',
        filter: `school_id=eq.${instructorUser.school_id}`,
      }, () => { void loadClasses(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [instructorUser?.school_id, loadClasses]);

  async function onRefresh() {
    setRefreshing(true);
    await loadClasses();
    if (selectedSchedule) {
      await loadRoster(selectedSchedule);
    }
    setRefreshing(false);
  }

  async function loadRoster(schedule: Schedule) {
    setLoadingRoster(true);
    setSelectedSchedule(schedule);

    // Get current academic year to fetch enrolled students
    let academicYearId: string | null = null;
    if (instructorUser?.school_id) {
      const { data: yearRow } = await supabase
        .from('academic_years')
        .select('id')
        .eq('school_id', instructorUser.school_id)
        .eq('is_current', true)
        .single();
      academicYearId = yearRow?.id ?? null;
    }

    // Fetch students: use enrollments if academic year exists, else fall back to section_id
    let studentsPromise;
    if (academicYearId) {
      studentsPromise = supabase
        .from('student_enrollments')
        .select('student:students(*)')
        .eq('section_id', schedule.section_id)
        .eq('academic_year_id', academicYearId)
        .order('student(last_name)');
    } else {
      studentsPromise = supabase
        .from('students')
        .select('*')
        .eq('section_id', schedule.section_id)
        .order('last_name');
    }

    const [studentsRes, existingRes] = await Promise.all([
      studentsPromise,
      supabase
        .from('attendance_records')
        .select('student_id, status')
        .eq('schedule_id', schedule.id)
        .eq('date', date),
    ]);

    let sectionStudents: Student[];
    if (academicYearId) {
      // Extract students from enrollment join
      sectionStudents = ((studentsRes.data ?? []) as Array<{ student: Student }>)
        .map((e) => e.student)
        .filter(Boolean)
        .sort((a, b) => (a.last_name ?? '').localeCompare(b.last_name ?? ''));
    } else {
      sectionStudents = (studentsRes.data as Student[]) ?? [];
    }

    const existing = existingRes.data ?? [];

    const map: Record<string, AttendanceStatus> = {};
    sectionStudents.forEach((student) => {
      map[student.id] = 'present';
    });

    existing.forEach((record) => {
      map[record.student_id] = record.status as AttendanceStatus;
    });

    setStudents(sectionStudents);
    setAttendance(map);

    const hasExisting = existing.length > 0;
    setIsLocked(!canEditExistingAttendance(date, schedule, hasExisting));
    setLoadingRoster(false);
  }

  function setStatus(studentId: string, status: AttendanceStatus) {
    setAttendance((prev) => ({ ...prev, [studentId]: status }));
  }

  function getWindowMessage(schedule: Schedule) {
    const end = parseScheduleEnd(date, schedule.time_end);
    const deadline = new Date(end.getTime() + CORRECTION_WINDOW_MINUTES * 60 * 1000);
    return `Editable until ${deadline.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  }

  async function saveAttendance() {
    if (!selectedSchedule || !instructorUser) {
      return;
    }

    const hasExisting = (attendanceCounts[selectedSchedule.id] ?? 0) > 0;
    if (!canEditExistingAttendance(date, selectedSchedule, hasExisting)) {
      Alert.alert('Correction window closed', 'Attendance edits are no longer allowed for this class.');
      setIsLocked(true);
      return;
    }

    const payload = {
      schedule_id: selectedSchedule.id,
      date,
      recorded_by: instructorUser.id,
      entries: Object.entries(attendance).map(([student_id, status]) => ({ student_id, status })),
    };

    setSaving(true);
    try {
      const net = await NetInfo.fetch();

      if (net.isConnected) {
        try {
          await submitAttendancePayload(payload);
          Alert.alert('Saved', 'Attendance synced successfully.');
        } catch {
          await enqueueAttendancePayload(payload);
          await refreshQueueCount();
          Alert.alert('Queued', 'No stable connection. Attendance was queued and will auto-sync.');
        }
      } else {
        await enqueueAttendancePayload(payload);
        await refreshQueueCount();
        Alert.alert('Queued', 'You are offline. Attendance was queued and will auto-sync.');
      }

      await loadClasses();
      await loadRoster(selectedSchedule);
    } finally {
      setSaving(false);
    }
  }

  async function manualSync() {
    const result = await syncQueue();
    if (result.synced > 0) {
      Alert.alert('Synced', `${result.synced} queued attendance batch(es) synced.`);
      await loadClasses();
      if (selectedSchedule) {
        await loadRoster(selectedSchedule);
      }
      return;
    }

    Alert.alert('Sync complete', result.remaining > 0 ? `${result.remaining} batch(es) still pending.` : 'Nothing pending.');
  }

  function openMessage(student: Student) {
    setMessageTarget(student);
    setMessageText('');
    setMessageOpen(true);
  }

  async function sendMessage() {
    if (!messageTarget || !selectedSchedule || !instructorUser || !messageText.trim()) {
      return;
    }

    setSendingMessage(true);
    try {
      const res = await fetchWithTimeout(`${FUNCTIONS_URL}/send-message`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          student_id: messageTarget.id,
          schedule_id: selectedSchedule.id,
          instructor_id: instructorUser.id,
          message: messageText.trim(),
        }),
      });

      const json = await res.json();
      if (__DEV__) console.log('[SendMessage] Response:', JSON.stringify(json));
      if (!res.ok) {
        Alert.alert('Send failed', json.error ?? 'Failed to send parent note.');
        return;
      }

      Alert.alert('Sent', json.message ?? 'Parent note sent.');
      setMessageOpen(false);
    } finally {
      setSendingMessage(false);
    }
  }

  const summary = useMemo(() => {
    const counts = { present: 0, absent: 0, late: 0, excused: 0 };
    Object.values(attendance).forEach((status) => {
      counts[status] += 1;
    });
    return counts;
  }, [attendance]);

  if (loading) {
    return (
      <GridBackground>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </GridBackground>
    );
  }

  return (
    <GridBackground>
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 10 }]}> 
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={styles.headerTitle}>{selectedSchedule ? 'Class Roster' : 'Take Attendance'}</Text>
            {yearName ? (
              <View style={{ backgroundColor: colors.primary + '18', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>SY {yearName}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.headerSubtitle}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</Text>
          <View style={styles.headerActions}>
            <View style={styles.queuePill}>
              <Ionicons name="cloud-upload-outline" size={14} color={queueCount > 0 ? '#9a3412' : '#166534'} />
              <Text style={[styles.queueText, { color: queueCount > 0 ? '#9a3412' : '#166534' }]}>
                {queueCount > 0 ? `${queueCount} queued` : 'Queue empty'}
              </Text>
            </View>
            <TouchableOpacity style={styles.syncBtn} onPress={manualSync} activeOpacity={0.7}>
              <Ionicons name="sync" size={14} color={colors.secondary} />
              <Text style={styles.syncText}>Sync now</Text>
            </TouchableOpacity>
          </View>
        </View>

        {!selectedSchedule ? (
          <ScrollView
            contentContainerStyle={styles.cardsWrap}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
          >
            {schedules.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="calendar-outline" size={44} color={colors.textMuted} />
                <Text style={styles.emptyTitle}>No classes today</Text>
                <Text style={styles.emptySubtitle}>Your attendance roster appears here on class days.</Text>
              </View>
            ) : (
              schedules.map((schedule) => {
                const hasExisting = (attendanceCounts[schedule.id] ?? 0) > 0;
                const editable = canEditExistingAttendance(date, schedule, hasExisting);

                return (
                  <TouchableOpacity
                    key={schedule.id}
                    style={styles.classCard}
                    activeOpacity={0.75}
                    onPress={() => loadRoster(schedule)}
                  >
                    <Text style={styles.classSubject}>{schedule.subject?.name}</Text>
                    <Text style={styles.classCode}>{schedule.subject?.code}</Text>

                    <View style={styles.rowMeta}>
                      <Ionicons name="time-outline" size={14} color={colors.textMuted} />
                      <Text style={styles.metaText}>{formatTime(schedule.time_start)} - {formatTime(schedule.time_end)}</Text>
                    </View>

                    <View style={styles.rowMeta}>
                      <Ionicons name="people-outline" size={14} color={colors.textMuted} />
                      <Text style={styles.metaText}>{schedule.section?.grade_level} - {schedule.section?.name}</Text>
                    </View>

                    <View style={styles.rowMeta}>
                      <Ionicons name="create-outline" size={14} color={editable ? colors.secondary : colors.danger} />
                      <Text style={[styles.metaText, { color: editable ? colors.secondary : colors.danger }]}>
                        {hasExisting ? getWindowMessage(schedule) : 'Initial entry available'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        ) : (
          <View style={styles.rosterWrap}>
            <View style={styles.selectedCard}>
              <TouchableOpacity style={styles.backBtn} onPress={() => setSelectedSchedule(null)} activeOpacity={0.7}>
                <Ionicons name="arrow-back" size={16} color={colors.secondary} />
                <Text style={styles.backText}>Back to classes</Text>
              </TouchableOpacity>

              <Text style={styles.classSubject}>{selectedSchedule.subject?.name}</Text>
              <Text style={styles.classCode}>{selectedSchedule.subject?.code} · {selectedSchedule.section?.grade_level} - {selectedSchedule.section?.name}</Text>

              <View style={styles.summaryRow}>
                <Text style={styles.summaryChip}>P {summary.present}</Text>
                <Text style={styles.summaryChip}>A {summary.absent}</Text>
                <Text style={styles.summaryChip}>L {summary.late}</Text>
                <Text style={styles.summaryChip}>E {summary.excused}</Text>
              </View>

              {isLocked ? (
                <View style={styles.lockBanner}>
                  <Ionicons name="lock-closed" size={14} color="#991b1b" />
                  <Text style={styles.lockText}>Correction window closed for this class.</Text>
                </View>
              ) : null}
            </View>

            {loadingRoster ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : (
              <>
                <FlatList
                  data={students}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={{ padding: 12, paddingBottom: 18 }}
                  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
                  renderItem={({ item }) => {
                    const status = attendance[item.id];
                    return (
                      <View style={styles.studentRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.studentName}>{item.last_name}, {item.first_name}</Text>
                          <Text style={styles.studentLrn}>{item.lrn}</Text>
                        </View>

                        <View style={styles.statusButtons}>
                          {STATUS_OPTIONS.map((option) => {
                            const active = status === option.status;
                            return (
                              <TouchableOpacity
                                key={option.status}
                                style={[
                                  styles.statusBtn,
                                  active
                                    ? { backgroundColor: option.activeColor, borderColor: option.activeColor }
                                    : { backgroundColor: '#f8fafc', borderColor: '#cbd5e1' },
                                ]}
                                onPress={() => setStatus(item.id, option.status)}
                                disabled={isLocked}
                                activeOpacity={0.7}
                              >
                                <Text style={[styles.statusBtnText, { color: active ? '#fff' : option.color }]}>{option.label}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>

                        <TouchableOpacity style={styles.messageBtn} onPress={() => openMessage(item)} activeOpacity={0.75}>
                          <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.secondary} />
                        </TouchableOpacity>
                      </View>
                    );
                  }}
                />

                <View style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}> 
                  <TouchableOpacity
                    style={[styles.saveBtn, (saving || isLocked) && { opacity: 0.6 }]}
                    disabled={saving || isLocked}
                    onPress={saveAttendance}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="save-outline" size={16} color="#fff" />
                    <Text style={styles.saveText}>{saving ? 'Saving...' : 'Save Attendance'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        )}
      </View>

      <Modal visible={messageOpen} transparent animationType="fade" onRequestClose={() => setMessageOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Send Parent Note</Text>
              <TouchableOpacity onPress={() => setMessageOpen(false)}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubTitle}>
              Student: {messageTarget?.first_name} {messageTarget?.last_name}
            </Text>

            <TextInput
              style={styles.messageInput}
              multiline
              maxLength={240}
              value={messageText}
              onChangeText={setMessageText}
              placeholder="Enter a short note for the parent"
              placeholderTextColor="#94a3b8"
            />

            <Text style={styles.counterText}>{messageText.length}/240</Text>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setMessageOpen(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sendBtn, (!messageText.trim() || sendingMessage) && { opacity: 0.6 }]}
                disabled={!messageText.trim() || sendingMessage}
                onPress={sendMessage}
              >
                <Text style={styles.sendText}>{sendingMessage ? 'Sending...' : 'Send'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </GridBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: colors.text },
  headerSubtitle: { marginTop: 2, color: colors.textMuted, fontSize: 13 },
  headerActions: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  queuePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  queueText: { fontSize: 12, fontWeight: '700' },
  syncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  syncText: { fontSize: 12, fontWeight: '700', color: colors.secondary },
  cardsWrap: { padding: 12, gap: 10 },
  classCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
  },
  classSubject: { fontSize: 17, fontWeight: '700', color: colors.text },
  classCode: { marginTop: 2, fontSize: 12, color: colors.textMuted },
  rowMeta: { marginTop: 7, flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { color: colors.textMuted, fontSize: 12 },
  emptyCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 30,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  emptyTitle: { marginTop: 8, fontSize: 18, fontWeight: '700', color: colors.text },
  emptySubtitle: { marginTop: 5, fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  rosterWrap: { flex: 1 },
  selectedCard: {
    margin: 12,
    marginBottom: 2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 12,
  },
  backBtn: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  backText: { color: colors.secondary, fontSize: 12, fontWeight: '700' },
  summaryRow: { marginTop: 10, flexDirection: 'row', gap: 8 },
  summaryChip: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 12,
    color: colors.text,
    fontWeight: '700',
  },
  lockBanner: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  lockText: { color: '#991b1b', fontSize: 12, fontWeight: '600' },
  studentRow: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  studentName: { fontSize: 14, fontWeight: '700', color: colors.text },
  studentLrn: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  statusButtons: { flexDirection: 'row', gap: 4 },
  statusBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBtnText: { fontSize: 12, fontWeight: '800' },
  messageBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSoft,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingTop: 10,
    paddingHorizontal: 12,
  },
  saveBtn: {
    borderRadius: 12,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    padding: 14,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  modalSubTitle: { marginTop: 8, color: colors.textMuted, fontSize: 13 },
  messageInput: {
    marginTop: 10,
    minHeight: 95,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surfaceSoft,
    color: colors.text,
    textAlignVertical: 'top',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  counterText: { marginTop: 6, fontSize: 11, color: colors.textMuted, textAlign: 'right' },
  modalActions: { marginTop: 12, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  cancelBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.surfaceSoft,
  },
  cancelText: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  sendBtn: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.primary,
  },
  sendText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
