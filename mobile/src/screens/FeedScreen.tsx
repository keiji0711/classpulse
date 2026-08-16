import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDataCache } from '../contexts/DataCacheContext';
import { colors } from '../theme/colors';
import GridBackground from '../components/GridBackground';
import ParentScreenHeader from '../components/ParentScreenHeader';
import type { AttendanceStatus } from '../types';

const READ_KEY = 'classpulse_read_timestamps';

const STATUS_CONFIG: Record<AttendanceStatus, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  present: { label: 'Present', color: colors.success, icon: 'checkmark-circle' },
  absent: { label: 'Absent', color: colors.danger, icon: 'close-circle' },
  late: { label: 'Late', color: colors.warning, icon: 'alert-circle' },
  excused: { label: 'Excused', color: colors.secondary, icon: 'shield-checkmark' },
};

const SUBJECT_COLORS = [
  '#0f766e', '#0369a1', '#0ea5e9', '#14b8a6', '#16a34a',
  '#0891b2', '#0284c7', '#2dd4bf', '#f97316', '#22c55e',
];

function getSubjectColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return SUBJECT_COLORS[Math.abs(hash) % SUBJECT_COLORS.length];
}

function formatChatTime(isoString: string) {
  const date = new Date(isoString);
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const dateStr = date.toISOString().split('T')[0];

  if (dateStr === todayStr) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateStr === yesterday.toISOString().split('T')[0]) {
    return 'Yesterday';
  }

  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  }

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTimeShort(t: string) {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

interface SubjectThread {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  instructorName: string;
  isAdviser: boolean;
  lastItem: FeedActivity;
  activities: FeedActivity[];
  unreadCount: number;
}

interface FeedActivity {
  id: string;
  kind: 'attendance' | 'message';
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  instructorName: string;
  occurredAt: string;
  preview: string;
}

export default function FeedScreen({ navigation }: any) {
  const { feed, feedLoading, refreshFeed } = useDataCache();
  const records = feed.records;
  const messages = feed.messages;
  const adviserChannel = feed.adviserChannel;
  const [refreshing, setRefreshing] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [readTimestamps, setReadTimestamps] = useState<Record<string, string>>({});
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(READ_KEY).then((val) => {
      if (val) setReadTimestamps(JSON.parse(val));
    });
  }, []);

  async function markAsRead(subjectId: string) {
    const updated = { ...readTimestamps, [subjectId]: new Date().toISOString() };
    setReadTimestamps(updated);
    await AsyncStorage.setItem(READ_KEY, JSON.stringify(updated));
  }

  useEffect(() => {
    if (!feedLoading) {
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    }
  }, [feedLoading]);

  async function onRefresh() {
    setRefreshing(true);
    await refreshFeed();
    setRefreshing(false);
  }

  const threads: SubjectThread[] = React.useMemo(() => {
    const threadMap = new Map<string, SubjectThread>();
    if (adviserChannel) {
      const grade = String(adviserChannel.grade_level ?? '').trim();
      const gradeLabel = grade
        ? grade.toLowerCase().startsWith('grade') ? grade : `Grade ${grade}`
        : '';
      const sectionLabel = [gradeLabel, adviserChannel.section_name].filter(Boolean).join(' · ');
      const subjectId = `advisory-${adviserChannel.section_id}`;

      threadMap.set(subjectId, {
        subjectId,
        subjectName: 'School Adviser',
        subjectCode: sectionLabel,
        instructorName: adviserChannel.adviser_name,
        isAdviser: true,
        lastItem: {
          id: 'adviser-channel-placeholder',
          kind: 'message',
          subjectId,
          subjectName: 'School Adviser',
          subjectCode: sectionLabel,
          instructorName: adviserChannel.adviser_name,
          occurredAt: new Date(0).toISOString(),
          preview: 'Private adviser announcements will appear here.',
        },
        activities: [],
        unreadCount: 0,
      });
    }

    const activities: FeedActivity[] = [
      ...records.map((rec) => {
        const status = STATUS_CONFIG[rec.status];
        const dateLabel = rec.date
          ? new Date(rec.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : null;

        return {
          id: rec.id,
          kind: 'attendance' as const,
          subjectId: rec.schedule?.subject?.id ?? rec.schedule_id,
          subjectName: rec.schedule?.subject?.name ?? 'Unknown Subject',
          subjectCode: rec.schedule?.subject?.code ?? '',
          instructorName: rec.schedule?.instructor?.full_name ?? '',
          occurredAt: rec.recorded_at,
          preview: `Marked ${status.label}${dateLabel ? ` on ${dateLabel}` : ''}${rec.schedule?.time_start ? ` · ${formatTimeShort(rec.schedule.time_start)}` : ''}`,
        };
      }),
      ...messages.map((message) => {
        const isAnnouncement = message.message_type === 'adviser_announcement';
        const announcementLabel = message.announcement_type
          ? message.announcement_type.charAt(0).toUpperCase() + message.announcement_type.slice(1)
          : 'Announcement';
        return {
          id: message.id,
          kind: 'message' as const,
          subjectId: isAnnouncement
            ? `advisory-${message.section_id}`
            : message.schedule?.subject?.id ?? message.schedule_id ?? `message-${message.id}`,
          subjectName: isAnnouncement
            ? 'Advisory Announcements'
            : message.schedule?.subject?.name ?? 'Teacher Message',
          subjectCode: isAnnouncement
            ? `${message.section?.grade_level ?? ''} ${message.section?.name ?? announcementLabel}`.trim()
            : message.schedule?.subject?.code ?? '',
          instructorName: message.instructor?.full_name ?? '',
          occurredAt: message.created_at,
          preview: isAnnouncement
            ? `${announcementLabel}: ${message.title ? `${message.title} — ` : ''}${message.content}`
            : message.content,
        };
      }),
    ];

    for (const activity of activities) {
      const { subjectId, subjectName } = activity;

      if (!threadMap.has(subjectId)) {
        threadMap.set(subjectId, {
          subjectId,
          subjectName,
          subjectCode: activity.subjectCode,
          instructorName: activity.instructorName,
          isAdviser: activity.subjectId.startsWith('advisory-'),
          lastItem: activity,
          activities: [],
          unreadCount: 0,
        });
      }

      const thread = threadMap.get(subjectId)!;
      thread.activities.push(activity);
      if (!thread.instructorName && activity.instructorName) {
        thread.instructorName = activity.instructorName;
      }

      const lastRead = readTimestamps[subjectId];
      if (!lastRead || new Date(activity.occurredAt) > new Date(lastRead)) {
        thread.unreadCount++;
      }

      if (new Date(activity.occurredAt) > new Date(thread.lastItem.occurredAt)) {
        thread.lastItem = activity;
      }
    }

    return Array.from(threadMap.values()).sort((a, b) => {
      if (a.isAdviser !== b.isAdviser) return a.isAdviser ? -1 : 1;
      return new Date(b.lastItem.occurredAt).getTime() - new Date(a.lastItem.occurredAt).getTime();
    });
  }, [adviserChannel, messages, records, readTimestamps]);

  const unreadTotal = threads.reduce((total, thread) => total + thread.unreadCount, 0);
  const visibleThreads = showUnreadOnly
    ? threads.filter((thread) => thread.unreadCount > 0)
    : threads;

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
      <Animated.View style={[styles.container, { opacity: fadeAnim }]}> 
      <ParentScreenHeader eyebrow="PARENT INBOX" title="Chats" description="School updates for" />

      {threads.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIcon}>
            <Ionicons name="chatbubbles-outline" size={56} color="#B0C4D8" />
          </View>
          <Text style={styles.emptyTitle}>No chats yet</Text>
          <Text style={styles.emptySubtitle}>
            Teacher messages and attendance updates will appear here, grouped by subject.
          </Text>
        </View>
      ) : (
        <FlatList
          data={visibleThreads}
          keyExtractor={(item) => item.subjectId}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={(
            <View>
              <LinearGradient
                colors={['#064e4b', '#0f766e', '#0284c7']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.inboxOverview}
              >
                <View style={styles.inboxOverviewIcon}>
                  <Ionicons name="chatbubbles" size={22} color="#fff" />
                </View>
                <View style={styles.inboxOverviewCopy}>
                  <Text style={styles.inboxOverviewLabel}>CONNECTED CONVERSATIONS</Text>
                  <Text style={styles.inboxOverviewTitle}>
                    {unreadTotal > 0 ? `${unreadTotal} new update${unreadTotal === 1 ? '' : 's'}` : 'You’re all caught up'}
                  </Text>
                  <Text style={styles.inboxOverviewText}>{threads.length} school channel{threads.length === 1 ? '' : 's'} in one place</Text>
                </View>
              </LinearGradient>

              <View style={styles.filterRow}>
                <Text style={styles.sectionLabel}>CONVERSATIONS</Text>
                <View style={styles.filterGroup}>
                  <TouchableOpacity
                    style={[styles.filterChip, !showUnreadOnly && styles.filterChipActive]}
                    onPress={() => setShowUnreadOnly(false)}
                  >
                    <Text style={[styles.filterText, !showUnreadOnly && styles.filterTextActive]}>All</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.filterChip, showUnreadOnly && styles.filterChipActive]}
                    onPress={() => setShowUnreadOnly(true)}
                  >
                    <Text style={[styles.filterText, showUnreadOnly && styles.filterTextActive]}>Unread</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
          ListEmptyComponent={(
            <View style={styles.filteredEmpty}>
              <Ionicons name="checkmark-circle" size={32} color={colors.success} />
              <Text style={styles.filteredEmptyTitle}>No unread conversations</Text>
              <Text style={styles.filteredEmptyText}>You’re up to date with every school channel.</Text>
            </View>
          )}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
          }
          renderItem={({ item: thread }) => {
            const color = getSubjectColor(thread.subjectName);
            const initials = thread.subjectName
              .split(' ')
              .filter((w) => w.length > 0)
              .map((w) => w[0])
              .join('')
              .slice(0, 2)
              .toUpperCase();

            return (
              <TouchableOpacity
                style={[styles.chatItem, thread.isAdviser && styles.adviserChatItem]}
                activeOpacity={0.6}
                onPress={() => {
                  markAsRead(thread.subjectId);
                  navigation.navigate('SubjectChat', {
                    subjectId: thread.subjectId,
                    subjectName: thread.subjectName,
                    subjectCode: thread.subjectCode,
                  instructorName: thread.instructorName,
                  color,
                  isAdviser: thread.isAdviser,
                });
                }}
              >
                {/* Round avatar */}
                <View style={[
                  styles.avatar,
                  { backgroundColor: thread.isAdviser ? colors.primaryDark : color },
                ]}>
                  {thread.isAdviser ? (
                    <>
                      <Ionicons name="person" size={27} color="#fff" />
                      <View style={styles.adviserBadge}>
                        <Ionicons name="school" size={11} color="#fff" />
                      </View>
                    </>
                  ) : (
                    <Text style={styles.avatarText}>{initials}</Text>
                  )}
                </View>

                {/* Content */}
                <View style={styles.chatContent}>
                  <View style={styles.chatTopRow}>
                    <Text style={[styles.chatSubject, thread.unreadCount > 0 && styles.chatSubjectBold]} numberOfLines={1}>
                      {thread.subjectName}
                    </Text>
                    <View style={styles.timeRow}>
                      {thread.unreadCount === 0 && (
                        <Ionicons name="checkmark-done" size={16} color={colors.secondary} style={{ marginRight: 2 }} />
                      )}
                      {thread.lastItem.id !== 'adviser-channel-placeholder' && (
                        <Text
                          style={[
                            styles.chatTime,
                            thread.unreadCount > 0 && styles.chatTimeUnread,
                          ]}
                        >
                          {formatChatTime(thread.lastItem.occurredAt)}
                        </Text>
                      )}
                    </View>
                  </View>

                  <View style={styles.chatBottomRow}>
                    <Text style={[styles.lastMsgText, thread.unreadCount > 0 && styles.lastMsgBold]} numberOfLines={2}>
                      <Text style={styles.senderName}>
                        {thread.lastItem.id === 'adviser-channel-placeholder'
                          ? `${thread.instructorName} · `
                          : thread.instructorName ? `${thread.instructorName}: ` : ''}
                      </Text>
                      {thread.lastItem.preview}
                    </Text>
                    {thread.unreadCount > 0 && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{thread.unreadCount}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
          ItemSeparatorComponent={() => (
            <View style={styles.separator}>
              <View style={styles.separatorLine} />
            </View>
          )}
          removeClippedSubviews
          maxToRenderPerBatch={10}
          windowSize={5}
        />
      )}
      </Animated.View>
    </GridBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent' },

  listContent: { paddingTop: 12, paddingBottom: 18 },
  inboxOverview: {
    marginHorizontal: 12,
    marginBottom: 14,
    borderRadius: 20,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  inboxOverviewIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginRight: 12,
  },
  inboxOverviewCopy: { flex: 1 },
  inboxOverviewLabel: { fontSize: 8, fontWeight: '900', color: '#99f6e4', letterSpacing: 1 },
  inboxOverviewTitle: { marginTop: 3, fontSize: 18, fontWeight: '900', color: '#fff' },
  inboxOverviewText: { marginTop: 2, fontSize: 11, color: 'rgba(236,254,255,0.75)' },
  filterRow: {
    marginHorizontal: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: { fontSize: 9, fontWeight: '900', color: colors.textMuted, letterSpacing: 1.2 },
  filterGroup: { flexDirection: 'row', gap: 6 },
  filterChip: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, backgroundColor: colors.surfaceSoft },
  filterChipActive: { backgroundColor: colors.primary },
  filterText: { fontSize: 10, fontWeight: '800', color: colors.textMuted },
  filterTextActive: { color: '#fff' },

  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginVertical: 4,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    shadowColor: '#0f172a',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  adviserChatItem: {
    backgroundColor: '#f0fdfa',
    borderColor: '#99e5d8',
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: { fontSize: 19, fontWeight: '600', color: '#fff' },
  adviserBadge: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 21,
    height: 21,
    borderRadius: 11,
    backgroundColor: colors.secondary,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatContent: { flex: 1 },
  chatTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  chatSubject: { fontSize: 15, fontWeight: '700', color: colors.text, flex: 1, marginRight: 8 },
  chatSubjectBold: { fontWeight: '900' },
  timeRow: { flexDirection: 'row', alignItems: 'center' },
  chatTime: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  chatTimeUnread: { color: colors.secondary, fontWeight: '700' },
  chatBottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  senderName: { color: colors.secondary, fontWeight: '700' },
  lastMsgText: { fontSize: 13, color: colors.textMuted, flex: 1, marginRight: 8, lineHeight: 18 },
  lastMsgBold: { color: colors.text },
  badge: {
    backgroundColor: colors.primary,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  separator: { height: 2 },
  separatorLine: { height: 0, backgroundColor: 'transparent' },
  filteredEmpty: { alignItems: 'center', paddingHorizontal: 30, paddingVertical: 36 },
  filteredEmptyTitle: { marginTop: 9, fontSize: 15, fontWeight: '900', color: colors.text },
  filteredEmptyText: { marginTop: 4, fontSize: 12, color: colors.textMuted, textAlign: 'center' },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(15,118,110,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  emptySubtitle: { fontSize: 14, color: colors.textMuted, textAlign: 'center', marginTop: 8, lineHeight: 20 },
});
