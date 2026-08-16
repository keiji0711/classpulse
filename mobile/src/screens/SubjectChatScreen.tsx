import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../contexts/AuthContext';
import { useDataCache } from '../contexts/DataCacheContext';
import { colors } from '../theme/colors';
import GridBackground from '../components/GridBackground';
import type { AttendanceRecord, AttendanceStatus, FeedMessage } from '../types';

type Visual = { label: string; color: string; tint: string; icon: keyof typeof Ionicons.glyphMap };

const STATUS_CONFIG: Record<AttendanceStatus, Visual> = {
  present: { label: 'Present', color: colors.success, tint: '#dcfce7', icon: 'checkmark-circle' },
  absent: { label: 'Absent', color: colors.danger, tint: '#fee2e2', icon: 'close-circle' },
  late: { label: 'Late', color: colors.warning, tint: '#fef3c7', icon: 'alert-circle' },
  excused: { label: 'Excused', color: colors.secondary, tint: '#e0f2fe', icon: 'shield-checkmark' },
};

const MESSAGE_VISUAL: Visual = {
  label: 'Message',
  color: colors.primary,
  tint: '#ccfbf1',
  icon: 'chatbubble-ellipses',
};

function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatDateHeader(d: string) {
  const date = new Date(d + 'T00:00:00');
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  if (d === todayStr) return 'Today';

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d === yesterday.toISOString().split('T')[0]) return 'Yesterday';

  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });
}

function formatBubbleTime(isoString: string) {
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

interface DateSection {
  type: 'date';
  date: string;
  id: string;
}

interface RecordItem {
  type: 'record';
  record: AttendanceRecord;
  id: string;
}

interface MessageItem {
  type: 'message';
  message: FeedMessage;
  id: string;
}

type ListItem = DateSection | RecordItem | MessageItem;

export default function SubjectChatScreen({ route, navigation }: any) {
  const { subjectId, subjectName, subjectCode, instructorName, color, isAdviser = false } = route.params;
  const { session } = useAuth();
  const { feed, feedLoading, refreshFeed } = useDataCache();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const records = useMemo(
    () => feed.records.filter((r) => (r.schedule?.subject?.id ?? r.schedule_id) === subjectId),
    [feed.records, subjectId]
  );

  const messages = useMemo(
    () => feed.messages.filter((m) => (
      m.message_type === 'adviser_announcement'
        ? `advisory-${m.section_id}` === subjectId
          || (m.schedule?.subject?.id ?? m.schedule_id) === subjectId
        : (m.schedule?.subject?.id ?? m.schedule_id) === subjectId
    )),
    [feed.messages, subjectId]
  );

  async function onRefresh() {
    setRefreshing(true);
    await refreshFeed();
    setRefreshing(false);
  }

  const listItems: ListItem[] = React.useMemo(() => {
    const sorted = [
      ...records.map((record) => ({
        type: 'record' as const,
        id: record.id,
        occurredAt: record.recorded_at,
        dateKey: record.date,
        record,
      })),
      ...messages.map((message) => ({
        type: 'message' as const,
        id: message.id,
        occurredAt: message.created_at,
        dateKey: message.created_at.split('T')[0],
        message,
      })),
    ].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

    const items: ListItem[] = [];
    let lastDate = '';

    for (const entry of sorted) {
      if (entry.type === 'record') {
        items.push({ type: 'record', record: entry.record, id: entry.id });
      } else {
        items.push({ type: 'message', message: entry.message, id: entry.id });
      }

      if (entry.dateKey !== lastDate) {
        items.push({ type: 'date', date: entry.dateKey, id: `date-${entry.dateKey}` });
        lastDate = entry.dateKey;
      }
    }

    return items;
  }, [messages, records]);

  const stats = React.useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, excused: 0 };
    records.forEach((r) => c[r.status]++);
    return c;
  }, [records]);

  const initials = subjectName
    .split(' ')
    .filter((w: string) => w.length > 0)
    .map((w: string) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <GridBackground>
      <View style={styles.container}>
      {/* Header */}
      <LinearGradient
        colors={['#ffffff', '#f0fdfa', '#e6f7f4']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + 6 }]}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.6}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>

        <View style={[styles.headerAvatar, { backgroundColor: color || colors.secondary }]}>
          {isAdviser ? (
            <>
              <Ionicons name="person" size={22} color="#fff" />
              <View style={styles.headerAdviserBadge}>
                <Ionicons name="school" size={8} color="#fff" />
              </View>
            </>
          ) : (
            <Text style={styles.headerAvatarText}>{initials}</Text>
          )}
        </View>

        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {subjectName}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {[subjectCode, instructorName].filter(Boolean).join(' · ') ||
              `${records.length + messages.length} updates`}
          </Text>
        </View>
        <View style={styles.headerSecureBadge}>
          <Ionicons name="lock-closed" size={12} color={colors.primary} />
        </View>
      </LinearGradient>

      {/* Attendance summary strip */}
      {records.length > 0 && (
        <View style={styles.summaryBar}>
          {(Object.keys(STATUS_CONFIG) as AttendanceStatus[])
            .filter((s) => stats[s] > 0)
            .map((s) => (
              <View key={s} style={styles.summaryItem}>
                <View style={[styles.summaryDot, { backgroundColor: STATUS_CONFIG[s].color }]} />
                <Text style={styles.summaryCount}>{stats[s]}</Text>
                <Text style={styles.summaryLabel}>{STATUS_CONFIG[s].label}</Text>
              </View>
            ))}
        </View>
      )}

      {feedLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : listItems.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconCircle}>
            <Ionicons name="chatbubbles-outline" size={36} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>No updates yet</Text>
          <Text style={styles.emptyText}>
            {isAdviser
              ? `${instructorName || 'Your school adviser'} has not posted an announcement yet. Adviser updates will appear here.`
              : 'Attendance records and teacher messages for this subject will appear here.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={listItems}
          keyExtractor={(item) => item.id}
          inverted
          contentContainerStyle={styles.chatList}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
          }
          renderItem={({ item }) => {
            if (item.type === 'date') {
              return (
                <View style={styles.dateHeader}>
                  <View style={styles.datePill}>
                    <Text style={styles.dateText}>{formatDateHeader(item.date)}</Text>
                  </View>
                </View>
              );
            }

            if (item.type === 'message') {
              const { message } = item;
              const v = MESSAGE_VISUAL;
              const announcementLabel = message.announcement_type
                ? message.announcement_type.charAt(0).toUpperCase() + message.announcement_type.slice(1)
                : v.label;

              return (
                <View style={styles.bubbleRow}>
                  <View style={[styles.avatar, { backgroundColor: v.tint }]}>
                    <Ionicons name={v.icon} size={18} color={v.color} />
                  </View>
                  <View style={[styles.bubble, styles.messageBubble]}>
                    {message.instructor?.full_name && (
                      <Text style={styles.bubbleSender}>{message.instructor.full_name}</Text>
                    )}

                    <View style={[styles.statusChip, { backgroundColor: v.tint }]}>
                      <Ionicons name={v.icon} size={12} color={v.color} />
                      <Text style={[styles.statusChipText, { color: v.color }]}>{announcementLabel}</Text>
                    </View>

                    {message.title ? <Text style={styles.announcementTitle}>{message.title}</Text> : null}
                    <Text style={styles.bubbleMessage}>{message.content}</Text>

                    {message.event_at ? (
                      <View style={styles.bubbleMeta}>
                        <View style={styles.metaPill}>
                          <Ionicons name="calendar" size={11} color={colors.textMuted} />
                          <Text style={styles.metaText}>
                            {new Date(message.event_at).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </Text>
                        </View>
                      </View>
                    ) : null}
                    <Text style={styles.bubbleTimestamp}>{formatBubbleTime(message.created_at)}</Text>
                  </View>
                </View>
              );
            }

            const { record } = item;
            const cfg = STATUS_CONFIG[record.status];

            return (
              <View style={styles.bubbleRow}>
                <View style={[styles.avatar, { backgroundColor: cfg.tint }]}>
                  <Ionicons name={cfg.icon} size={18} color={cfg.color} />
                </View>
                <View style={[styles.bubble, styles.attendanceBubble, { borderLeftColor: cfg.color }]}>
                  {/* Sender name (instructor) */}
                  {record.schedule?.instructor?.full_name && (
                    <Text style={styles.bubbleSender}>{record.schedule.instructor.full_name}</Text>
                  )}

                  {/* Status chip */}
                  <View style={[styles.statusChip, { backgroundColor: cfg.tint }]}>
                    <Ionicons name={cfg.icon} size={12} color={cfg.color} />
                    <Text style={[styles.statusChipText, { color: cfg.color }]}>{cfg.label}</Text>
                  </View>

                  {/* Main message */}
                  <Text style={styles.bubbleMessage}>
                    {session?.student.first_name} was marked{' '}
                    <Text style={{ fontWeight: '600', color: cfg.color }}>{cfg.label.toLowerCase()}</Text>
                    {record.schedule?.time_start
                      ? ` during the ${formatTime(record.schedule.time_start)} – ${formatTime(record.schedule.time_end)} class`
                      : ''}
                    .
                  </Text>

                  {/* Meta chips */}
                  {(record.schedule?.section?.name || record.schedule?.room) && (
                    <View style={styles.bubbleMeta}>
                      {record.schedule?.section?.name && (
                        <View style={styles.metaPill}>
                          <Ionicons name="people" size={11} color={colors.textMuted} />
                          <Text style={styles.metaText}>{record.schedule.section.name}</Text>
                        </View>
                      )}
                      {record.schedule?.room && (
                        <View style={styles.metaPill}>
                          <Ionicons name="location" size={11} color={colors.textMuted} />
                          <Text style={styles.metaText}>{record.schedule.room}</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Timestamp */}
                  <Text style={styles.bubbleTimestamp}>{formatBubbleTime(record.recorded_at)}</Text>
                </View>
              </View>
            );
          }}
          removeClippedSubviews
          maxToRenderPerBatch={8}
          windowSize={7}
          initialNumToRender={15}
        />
      )}

      {/* Bottom read-only bar */}
      <View style={[styles.readOnlyBar, { paddingBottom: insets.bottom + 8 }]}>
        <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
        <Text style={styles.readOnlyText}>
          {isAdviser
            ? 'Private adviser channel · Announcements and school updates'
            : 'Live channel · Teacher messages and attendance updates'}
        </Text>
      </View>
      </View>
    </GridBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#ccece5',
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.78)',
    marginRight: 6,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  headerAvatarText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  headerAdviserBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.secondary,
    borderWidth: 2,
    borderColor: '#f0fdfa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 16, fontWeight: '900', color: colors.text },
  headerSub: { fontSize: 11, color: colors.textMuted, fontWeight: '600', marginTop: 2 },
  headerSecureBadge: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1fae5',
    marginLeft: 6,
  },

  summaryBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.96)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  summaryDot: { width: 8, height: 8, borderRadius: 4 },
  summaryCount: { fontSize: 12, fontWeight: '900', color: colors.text },
  summaryLabel: { fontSize: 10, color: colors.textMuted, fontWeight: '700' },

  chatList: { paddingVertical: 14, paddingHorizontal: 12 },

  dateHeader: { alignItems: 'center', marginVertical: 12 },
  datePill: {
    backgroundColor: 'rgba(255,255,255,0.86)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },

  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
    paddingRight: 36,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    marginTop: 2,
  },
  bubble: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderTopLeftRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  messageBubble: {
    backgroundColor: '#f2fffc',
    borderColor: '#bde8df',
    borderTopLeftRadius: 5,
  },
  attendanceBubble: {
    borderLeftWidth: 3,
    backgroundColor: '#fff',
  },
  bubbleSender: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginBottom: 6,
  },
  statusChipText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  announcementTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 5,
  },
  bubbleMessage: {
    fontSize: 15,
    color: colors.text,
    lineHeight: 21,
  },
  bubbleMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  metaText: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
  bubbleTimestamp: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '400',
    alignSelf: 'flex-end',
    marginTop: 6,
  },

  readOnlyBar: {
    backgroundColor: 'rgba(255,255,255,0.98)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 9,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  readOnlyText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
    textAlign: 'center',
  },

  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#ccfbf1',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
});
