import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { FUNCTIONS_URL, getAuthHeaders, supabase } from '../lib/supabase';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { colors } from '../theme/colors';
import GridBackground from '../components/GridBackground';

interface SupportMessage {
  id: string;
  sender_role: 'parent' | 'instructor' | 'super_admin';
  sender_name: string;
  content: string;
  created_at: string;
}

interface SupportThread {
  id: string;
  status: 'open' | 'closed';
  last_message_at: string;
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// In-memory cache so reopening Support within a session shows the conversation
// instantly instead of reloading (and flashing a spinner) every time.
const threadCache = new Map<string, { thread: SupportThread | null; messages: SupportMessage[] }>();

export default function SupportChatScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { session, instructorUser, role } = useAuth();
  const isParent = role === 'parent';

  const cacheKey = isParent
    ? `parent-${session?.student?.id ?? 'me'}`
    : `instructor-${instructorUser?.id ?? 'me'}`;

  const [thread, setThread] = useState<SupportThread | null>(
    () => threadCache.get(cacheKey)?.thread ?? null
  );
  const [messages, setMessages] = useState<SupportMessage[]>(
    () => threadCache.get(cacheKey)?.messages ?? []
  );
  const [loading, setLoading] = useState(() => !threadCache.has(cacheKey));
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState('');
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const myRole: 'parent' | 'instructor' = isParent ? 'parent' : 'instructor';
  const myName = isParent
    ? session?.parent?.guardian_name ?? 'Parent'
    : instructorUser?.full_name ?? 'Teacher';

  // Persist to the in-memory cache whenever the conversation changes.
  useEffect(() => {
    threadCache.set(cacheKey, { thread, messages });
  }, [cacheKey, thread, messages]);

  const loadThread = useCallback(async () => {
    try {
      if (isParent) {
        const res = await fetchWithTimeout(`${FUNCTIONS_URL}/support-list-thread`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({}),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Failed to load support thread');
        setThread(json.thread);
        setMessages(json.messages ?? []);
      } else if (instructorUser) {
        const { data: t } = await supabase
          .from('support_threads')
          .select('*')
          .eq('instructor_user_id', instructorUser.id)
          .maybeSingle();
        if (t) {
          setThread(t as SupportThread);
          const { data: m } = await supabase
            .from('support_messages')
            .select('id, sender_role, sender_name, content, created_at')
            .eq('thread_id', (t as { id: string }).id)
            .order('created_at', { ascending: true });
          setMessages((m as SupportMessage[]) ?? []);
          if ((t as { unread_for_user: boolean }).unread_for_user) {
            await supabase
              .from('support_threads')
              .update({ unread_for_user: false })
              .eq('id', (t as { id: string }).id);
          }
        } else {
          setThread(null);
          setMessages([]);
        }
      }
    } catch (err: any) {
      console.error('[Support] load error:', err);
    } finally {
      setLoading(false);
    }
  }, [isParent, instructorUser]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  // Realtime: instructor can subscribe directly; parent re-polls on focus.
  useEffect(() => {
    if (isParent || !thread?.id) return;
    const channel = supabase
      .channel(`support-thread-${thread.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `thread_id=eq.${thread.id}` },
        (payload) => {
          setMessages((prev) => {
            const m = payload.new as SupportMessage;
            if (prev.some((x) => x.id === m.id)) return prev;
            return [...prev, m];
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isParent, thread?.id]);

  // Refetch when screen regains focus (parents in particular).
  useEffect(() => {
    const unsub = navigation?.addListener?.('focus', () => {
      loadThread();
    });
    return unsub;
  }, [navigation, loadThread]);

  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [messages.length]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, () => {
      setKeyboardVisible(true);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  async function handleSend() {
    const content = input.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      if (isParent) {
        const res = await fetchWithTimeout(`${FUNCTIONS_URL}/support-send-message`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ content, sender_name: myName }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Failed to send');
        setThread(json.thread);
        setMessages((prev) => [...prev, json.message]);
      } else if (instructorUser) {
        let activeThread = thread;
        const now = new Date().toISOString();
        const preview = content.slice(0, 140);

        if (!activeThread) {
          const { data: created, error } = await supabase
            .from('support_threads')
            .insert({
              instructor_user_id: instructorUser.id,
              school_id: instructorUser.school_id,
              sender_role: 'instructor',
              sender_name: myName,
              sender_email: instructorUser.email,
              unread_for_admin: true,
              unread_for_user: false,
              last_message_at: now,
              last_message_preview: preview,
            })
            .select('*')
            .single();
          if (error) throw error;
          activeThread = created as SupportThread;
          setThread(activeThread);
        } else {
          await supabase
            .from('support_threads')
            .update({
              last_message_at: now,
              last_message_preview: preview,
              unread_for_admin: true,
              status: 'open',
            })
            .eq('id', activeThread.id);
        }

        const { data: msg, error: msgErr } = await supabase
          .from('support_messages')
          .insert({
            thread_id: activeThread!.id,
            sender_role: 'instructor',
            sender_name: myName,
            content,
          })
          .select('id, sender_role, sender_name, content, created_at')
          .single();
        if (msgErr) throw msgErr;
        setMessages((prev) => [...prev, msg as SupportMessage]);
      }
      setInput('');
    } catch (err: any) {
      Alert.alert('Could not send', err?.message ?? 'Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <GridBackground>
      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity onPress={() => navigation?.goBack?.()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Help & Support</Text>
            <Text style={styles.subtitle}>
              {thread?.status === 'closed' ? 'Closed conversation' : 'Chat with the ClassPulse team'}
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 14, paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            {messages.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="chatbubbles-outline" size={36} color={colors.primary} />
                <Text style={styles.emptyTitle}>How can we help?</Text>
                <Text style={styles.emptyText}>
                  Send us a message and the ClassPulse team will reply here. Common questions:
                  account access, login issues, feature requests, and app problems.
                </Text>
              </View>
            ) : (
              messages.map((m) => {
                const mine = m.sender_role === myRole;
                return (
                  <View
                    key={m.id}
                    style={[styles.bubbleRow, mine ? styles.bubbleRowRight : styles.bubbleRowLeft]}
                  >
                    <View
                      style={[
                        styles.bubble,
                        mine ? styles.bubbleMine : styles.bubbleOther,
                        m.sender_role === 'super_admin' && !mine && styles.bubbleAdmin,
                      ]}
                    >
                      {!mine ? (
                        <Text style={styles.bubbleSender}>
                          {m.sender_role === 'super_admin' ? 'ClassPulse Team' : m.sender_name}
                        </Text>
                      ) : null}
                      <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>
                        {m.content}
                      </Text>
                      <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>
                        {timeLabel(m.created_at)}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        )}

        <View style={[styles.inputBar, { paddingBottom: keyboardVisible ? 8 : Math.max(insets.bottom, 10) }]}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Type your message..."
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={2000}
            editable={!sending}
            onFocus={() => requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))}
          />
          <TouchableOpacity
            onPress={handleSend}
            disabled={sending || !input.trim()}
            style={[styles.sendBtn, (sending || !input.trim()) && styles.sendBtnDisabled]}
          >
            {sending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons name="send" size={18} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </GridBackground>
  );
}

const styles = StyleSheet.create({
  keyboardContainer: { flex: 1, overflow: 'hidden' },
  header: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 12,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSoft,
  },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    alignItems: 'center',
    marginTop: 30,
  },
  emptyTitle: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  emptyText: {
    marginTop: 6,
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },

  bubbleRow: { flexDirection: 'row', marginBottom: 8 },
  bubbleRowLeft: { justifyContent: 'flex-start' },
  bubbleRowRight: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
  },
  bubbleMine: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  bubbleOther: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  bubbleAdmin: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
  },
  bubbleSender: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '700',
    marginBottom: 2,
  },
  bubbleText: { fontSize: 14, color: colors.text, lineHeight: 19 },
  bubbleTextMine: { color: '#fff' },
  bubbleTime: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  bubbleTimeMine: { color: 'rgba(255,255,255,0.75)' },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    paddingTop: 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 14,
    color: colors.text,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.5 },
});
