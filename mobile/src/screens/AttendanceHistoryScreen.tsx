import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ChildSwitcher from '../components/ChildSwitcher';
import GridBackground from '../components/GridBackground';
import { useDataCache } from '../contexts/DataCacheContext';
import { colors } from '../theme/colors';
import type { AttendanceRecord, AttendanceStatus } from '../types';

type FilterType = 'all' | AttendanceStatus;

const STATUS_CONFIG: Record<
  AttendanceStatus,
  { label: string; color: string; tint: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  present: { label: 'Present', color: colors.success, tint: '#ecfdf3', icon: 'checkmark' },
  absent: { label: 'Absent', color: colors.danger, tint: '#fff1f2', icon: 'close' },
  late: { label: 'Late', color: colors.warning, tint: '#fffbeb', icon: 'time-outline' },
  excused: { label: 'Excused', color: colors.secondary, tint: '#eff6ff', icon: 'shield-checkmark-outline' },
};

const FILTERS: { key: FilterType; label: string }[] = [
  { key: 'all', label: 'All records' },
  { key: 'present', label: 'Present' },
  { key: 'absent', label: 'Absent' },
  { key: 'late', label: 'Late' },
  { key: 'excused', label: 'Excused' },
];

function formatTime(value?: string) {
  if (!value) return null;
  const [hour, minute] = value.split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function toLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00`);
  const today = new Date();
  if (dateKey === toLocalDateKey(today)) return 'Today';

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dateKey === toLocalDateKey(yesterday)) return 'Yesterday';

  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

function AttendanceRow({ record, isLast }: { record: AttendanceRecord; isLast: boolean }) {
  const status = STATUS_CONFIG[record.status];
  const start = formatTime(record.schedule?.time_start);
  const end = formatTime(record.schedule?.time_end);
  const time = start && end ? `${start} – ${end}` : start;
  const room = record.schedule?.room?.trim();

  return (
    <View style={[styles.recordRow, !isLast && styles.recordDivider]}>
      <View style={[styles.statusIcon, { backgroundColor: status.tint }]}>
        <Ionicons name={status.icon} size={17} color={status.color} />
      </View>

      <View style={styles.recordBody}>
        <Text style={styles.subjectName} numberOfLines={1}>
          {record.schedule?.subject?.name ?? 'Class attendance'}
        </Text>
        <Text style={styles.recordMeta} numberOfLines={1}>
          {[time, room].filter(Boolean).join('  ·  ') || 'Schedule unavailable'}
        </Text>
        {record.schedule?.instructor?.full_name ? (
          <Text style={styles.teacherName} numberOfLines={1}>
            {record.schedule.instructor.full_name}
          </Text>
        ) : null}
      </View>

      <Text style={[styles.statusLabel, { color: status.color }]}>{status.label}</Text>
    </View>
  );
}

export default function AttendanceHistoryScreen() {
  const { feed, feedLoading, refreshFeed } = useDataCache();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<FilterType>('all');
  const [refreshing, setRefreshing] = useState(false);

  const stats = useMemo(() => {
    const counts = { present: 0, absent: 0, late: 0, excused: 0, total: feed.records.length };
    feed.records.forEach((record) => counts[record.status]++);
    return counts;
  }, [feed.records]);

  const attendanceRate = stats.total
    ? Math.round(((stats.present + stats.late + stats.excused) / stats.total) * 100)
    : 0;

  const dateGroups = useMemo(() => {
    const groups = new Map<string, AttendanceRecord[]>();
    const visibleRecords = filter === 'all'
      ? feed.records
      : feed.records.filter((record) => record.status === filter);

    visibleRecords.forEach((record) => {
      const group = groups.get(record.date) ?? [];
      group.push(record);
      groups.set(record.date, group);
    });

    return Array.from(groups.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, records]) => ({
        date,
        records: records.sort((a, b) =>
          (a.schedule?.time_start ?? '').localeCompare(b.schedule?.time_start ?? ''),
        ),
      }));
  }, [feed.records, filter]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await refreshFeed();
    } finally {
      setRefreshing(false);
    }
  }

  if (feedLoading) {
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
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.eyebrow}>ATTENDANCE</Text>
            <Text style={styles.title}>History</Text>
          </View>
          <ChildSwitcher />
        </View>
      </View>

      <FlatList
        data={dateGroups}
        keyExtractor={(group) => group.date}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.listContent, dateGroups.length === 0 && styles.emptyListContent]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        ListHeaderComponent={
          <>
            <View style={styles.summaryCard}>
              <View style={styles.summaryTopRow}>
                <View>
                  <Text style={styles.summaryLabel}>Attendance rate</Text>
                  <Text style={styles.summaryHint}>Present, late, and excused</Text>
                </View>
                <Text style={styles.rateValue}>{attendanceRate}%</Text>
              </View>

              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${attendanceRate}%` }]} />
              </View>

              <View style={styles.countRow}>
                {(['present', 'absent', 'late', 'excused'] as AttendanceStatus[]).map((statusKey) => {
                  const status = STATUS_CONFIG[statusKey];
                  return (
                    <View key={statusKey} style={styles.countItem}>
                      <View style={[styles.countDot, { backgroundColor: status.color }]} />
                      <Text style={styles.countValue}>{stats[statusKey]}</Text>
                      <Text style={styles.countLabel}>{status.label}</Text>
                    </View>
                  );
                })}
              </View>
            </View>

            <View style={styles.filterBlock}>
              <Text style={styles.recordsLabel}>{stats.total} recorded {stats.total === 1 ? 'class' : 'classes'}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterContent}
              >
                {FILTERS.map((item) => {
                  const active = filter === item.key;
                  return (
                    <TouchableOpacity
                      key={item.key}
                      style={[styles.filterButton, active && styles.filterButtonActive]}
                      onPress={() => setFilter(item.key)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.filterText, active && styles.filterTextActive]}>{item.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </>
        }
        renderItem={({ item: group }) => (
          <View style={styles.dayGroup}>
            <View style={styles.dayHeader}>
              <Text style={styles.dayTitle}>{formatDate(group.date)}</Text>
              <Text style={styles.dayCount}>{group.records.length} {group.records.length === 1 ? 'class' : 'classes'}</Text>
            </View>
            <View style={styles.recordCard}>
              {group.records.map((record, index) => (
                <AttendanceRow
                  key={record.id}
                  record={record}
                  isLast={index === group.records.length - 1}
                />
              ))}
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="calendar-outline" size={24} color={colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>{filter === 'all' ? 'No attendance yet' : `No ${filter} records`}</Text>
            <Text style={styles.emptyMessage}>
              {filter === 'all'
                ? 'Attendance recorded by the school will appear here.'
                : 'Try another filter to view attendance history.'}
            </Text>
            {filter !== 'all' ? (
              <TouchableOpacity style={styles.clearFilterButton} onPress={() => setFilter('all')}>
                <Text style={styles.clearFilterText}>Show all records</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        }
        maxToRenderPerBatch={8}
        windowSize={5}
      />
    </GridBackground>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    backgroundColor: colors.surface,
    paddingHorizontal: 18,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.1, color: colors.primary },
  title: { marginTop: 2, fontSize: 25, lineHeight: 30, fontWeight: '700', color: colors.text },
  listContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 },
  emptyListContent: { flexGrow: 1 },
  summaryCard: {
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryLabel: { fontSize: 15, fontWeight: '700', color: colors.text },
  summaryHint: { marginTop: 2, fontSize: 12, color: colors.textMuted },
  rateValue: { fontSize: 28, fontWeight: '800', letterSpacing: -0.8, color: colors.primaryDark },
  progressTrack: {
    height: 6,
    marginTop: 14,
    overflow: 'hidden',
    borderRadius: 3,
    backgroundColor: '#e2e8f0',
  },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: colors.primary },
  countRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  countItem: { flexDirection: 'row', alignItems: 'center' },
  countDot: { width: 6, height: 6, marginRight: 5, borderRadius: 3 },
  countValue: { marginRight: 3, fontSize: 13, fontWeight: '800', color: colors.text },
  countLabel: { fontSize: 11, color: colors.textMuted },
  filterBlock: { marginTop: 20, marginHorizontal: -16 },
  recordsLabel: { marginBottom: 9, paddingHorizontal: 16, fontSize: 12, fontWeight: '600', color: colors.textMuted },
  filterContent: { paddingHorizontal: 16, gap: 8 },
  filterButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterButtonActive: { borderColor: colors.primaryDark, backgroundColor: colors.primaryDark },
  filterText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  filterTextActive: { color: '#ffffff' },
  dayGroup: { marginTop: 22 },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  dayTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  dayCount: { fontSize: 12, color: colors.textMuted },
  recordCard: {
    overflow: 'hidden',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  recordRow: { flexDirection: 'row', alignItems: 'center', minHeight: 76, paddingHorizontal: 13, paddingVertical: 12 },
  recordDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  statusIcon: {
    width: 34,
    height: 34,
    marginRight: 11,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordBody: { flex: 1, minWidth: 0, paddingRight: 8 },
  subjectName: { fontSize: 15, lineHeight: 19, fontWeight: '700', color: colors.text },
  recordMeta: { marginTop: 3, fontSize: 12, color: colors.textMuted },
  teacherName: { marginTop: 2, fontSize: 11, color: '#94a3b8' },
  statusLabel: { fontSize: 12, fontWeight: '700' },
  emptyState: { alignItems: 'center', justifyContent: 'center', flex: 1, paddingHorizontal: 32, paddingBottom: 30 },
  emptyIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: '#f0fdfa',
  },
  emptyTitle: { marginTop: 14, fontSize: 16, fontWeight: '700', color: colors.text },
  emptyMessage: { marginTop: 5, textAlign: 'center', fontSize: 13, lineHeight: 19, color: colors.textMuted },
  clearFilterButton: { marginTop: 14, paddingHorizontal: 14, paddingVertical: 9 },
  clearFilterText: { fontSize: 13, fontWeight: '700', color: colors.primary },
});
