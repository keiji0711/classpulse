import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import type { Schedule } from '../types';
import { colors } from '../theme/colors';
import GridBackground from '../components/GridBackground';

function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function getTodayKey() {
  return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date().getDay()];
}

export default function InstructorTodayScreen() {
  const { instructorUser, queueCount } = useAuth();
  const insets = useSafeAreaInsets();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [attendanceCounts, setAttendanceCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [yearName, setYearName] = useState<string | null>(null);

  const todayKey = getTodayKey();
  const todayLabel = useMemo(() => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }), []);

  const loadToday = useCallback(async () => {
    if (!instructorUser) {
      return;
    }

    const todayDate = new Date().toISOString().split('T')[0];

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

    let scheduleQuery = supabase
      .from('schedules')
      .select('*, subject:subjects(*), section:sections(*)')
      .eq('instructor_id', instructorUser.id)
      .eq('day_of_week', todayKey)
      .order('time_start');

    if (academicYearId) {
      scheduleQuery = scheduleQuery.eq('academic_year_id', academicYearId);
    }

    const { data: scheduleData } = await scheduleQuery;

    const list = (scheduleData as Schedule[]) ?? [];
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
      .eq('date', todayDate);

    const counts: Record<string, number> = {};
    for (const id of ids) counts[id] = 0;
    (records ?? []).forEach((record) => {
      counts[record.schedule_id] = (counts[record.schedule_id] ?? 0) + 1;
    });
    setAttendanceCounts(counts);
  }, [instructorUser, todayKey]);

  useEffect(() => {
    loadToday().finally(() => setLoading(false));
  }, [loadToday]);

  // Re-fetch when academic year changes
  useEffect(() => {
    if (!instructorUser?.school_id) return;
    const channel = supabase
      .channel(`instructor-year-today-${instructorUser.school_id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'academic_years',
        filter: `school_id=eq.${instructorUser.school_id}`,
      }, () => { void loadToday(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [instructorUser?.school_id, loadToday]);

  async function onRefresh() {
    setRefreshing(true);
    await loadToday();
    setRefreshing(false);
  }

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
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
      >
        <View style={[styles.header, { paddingTop: insets.top + 14 }]}> 
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={styles.headerTitle}>Today Schedule</Text>
            {yearName ? (
              <View style={{ backgroundColor: colors.primary + '18', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>SY {yearName}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.headerSubtitle}>{todayLabel}</Text>
          {queueCount > 0 ? (
            <View style={styles.queuePill}>
              <Ionicons name="cloud-upload-outline" size={14} color={colors.warning} />
              <Text style={styles.queueText}>{queueCount} pending sync</Text>
            </View>
          ) : null}
        </View>

        {schedules.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="calendar-outline" size={44} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No classes today</Text>
            <Text style={styles.emptySubtitle}>You're all set for now. Pull down to refresh.</Text>
          </View>
        ) : (
          <View style={styles.cardsWrap}>
            {schedules.map((schedule) => {
              const isRecorded = (attendanceCounts[schedule.id] ?? 0) > 0;
              return (
                <View key={schedule.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <Text style={styles.subject}>{schedule.subject?.name ?? 'Subject'}</Text>
                    <Text style={styles.subjectCode}>{schedule.subject?.code ?? ''}</Text>
                  </View>

                  <View style={styles.metaRow}>
                    <Ionicons name="time-outline" size={14} color={colors.textMuted} />
                    <Text style={styles.metaText}>{formatTime(schedule.time_start)} - {formatTime(schedule.time_end)}</Text>
                  </View>

                  <View style={styles.metaRow}>
                    <Ionicons name="people-outline" size={14} color={colors.textMuted} />
                    <Text style={styles.metaText}>{schedule.section?.grade_level} - {schedule.section?.name}</Text>
                  </View>

                  {!!schedule.room && (
                    <View style={styles.metaRow}>
                      <Ionicons name="location-outline" size={14} color={colors.textMuted} />
                      <Text style={styles.metaText}>{schedule.room}</Text>
                    </View>
                  )}

                  <View style={[styles.stateBadge, isRecorded ? styles.stateRecorded : styles.statePending]}>
                    <Text style={[styles.stateText, isRecorded ? styles.stateTextRecorded : styles.stateTextPending]}>
                      {isRecorded ? 'Attendance Recorded' : 'Pending Attendance'}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </GridBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingBottom: 28 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: colors.text },
  headerSubtitle: { marginTop: 4, color: colors.textMuted, fontSize: 14 },
  queuePill: {
    marginTop: 10,
    alignSelf: 'flex-start',
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
  queueText: { fontSize: 12, color: '#9a3412', fontWeight: '600' },
  cardsWrap: { paddingHorizontal: 12, paddingTop: 12, gap: 10 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
  },
  cardTop: { marginBottom: 8 },
  subject: { fontSize: 17, fontWeight: '700', color: colors.text },
  subjectCode: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  metaText: { fontSize: 13, color: colors.textMuted },
  stateBadge: {
    marginTop: 12,
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statePending: { backgroundColor: '#fef3c7' },
  stateRecorded: { backgroundColor: '#dcfce7' },
  stateText: { fontSize: 12, fontWeight: '700' },
  stateTextPending: { color: '#92400e' },
  stateTextRecorded: { color: '#166534' },
  emptyContainer: {
    marginTop: 30,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 28,
    marginHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  emptyTitle: { marginTop: 10, fontSize: 18, color: colors.text, fontWeight: '700' },
  emptySubtitle: { marginTop: 5, color: colors.textMuted, fontSize: 13, textAlign: 'center' },
});
