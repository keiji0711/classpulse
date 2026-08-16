import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useCachedState, hasCached } from '../../lib/pageCache';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { LifeBuoy, Send, MessageSquare } from 'lucide-react';

interface SupportThread {
  id: string;
  status: 'open' | 'closed';
  last_message_at: string;
}

interface SupportMessage {
  id: string;
  sender_role: 'parent' | 'instructor' | 'school_admin' | 'super_admin';
  sender_name: string;
  content: string;
  created_at: string;
}

function fullTime(iso: string) {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function SupportPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const cacheKey = `admin-support-${user?.id ?? 'anon'}`;
  const [thread, setThread] = useCachedState<SupportThread | null>(`${cacheKey}-thread`, null);
  const [messages, setMessages] = useCachedState<SupportMessage[]>(`${cacheKey}-messages`, []);
  // Show cached conversation instantly; only spin on the very first load.
  const [loading, setLoading] = useState(!hasCached(`${cacheKey}-messages`));
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const senderName = user?.full_name || 'School Admin';

  const loadThread = useCallback(async () => {
    if (!user) return;
    const { data: t } = await supabase
      .from('support_threads')
      .select('id, status, last_message_at, unread_for_user')
      .eq('instructor_user_id', user.id)
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
        await supabase.from('support_threads').update({ unread_for_user: false }).eq('id', (t as { id: string }).id);
      }
    } else {
      setThread(null);
      setMessages([]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  // Realtime: append super-admin replies as they arrive.
  useEffect(() => {
    if (!thread?.id) return;
    const channel = supabase
      .channel(`support-admin-${thread.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `thread_id=eq.${thread.id}` },
        (payload) => {
          const m = payload.new as SupportMessage;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [thread?.id]);

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }, [messages.length]);

  async function handleSend() {
    const content = input.trim();
    if (!content || sending || !user) return;
    setSending(true);
    try {
      let activeThread = thread;
      const now = new Date().toISOString();
      const preview = content.slice(0, 140);

      if (!activeThread) {
        const { data: created, error } = await supabase
          .from('support_threads')
          .insert({
            instructor_user_id: user.id,
            school_id: user.school_id,
            sender_role: 'school_admin',
            sender_name: senderName,
            sender_email: user.email,
            unread_for_admin: true,
            unread_for_user: false,
            last_message_at: now,
            last_message_preview: preview,
          })
          .select('id, status, last_message_at')
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
          thread_id: activeThread.id,
          sender_role: 'school_admin',
          sender_name: senderName,
          content,
        })
        .select('id, sender_role, sender_name, content, created_at')
        .single();
      if (msgErr) throw msgErr;

      setMessages((prev) => (prev.some((x) => x.id === (msg as SupportMessage).id) ? prev : [...prev, msg as SupportMessage]));
      setInput('');
    } catch (err: any) {
      showToast(err?.message ?? 'Failed to send message', 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <LifeBuoy size={22} className="text-primary" /> Help & Support
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Send a concern or complaint to the ClassPulse team. We reply right here in the app.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col h-[calc(100vh-220px)] min-h-[480px]">
        {loading ? (
          <div className="flex-1 flex justify-center items-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-3 bg-slate-50/40">
              {messages.length === 0 ? (
                <div className="max-w-md mx-auto text-center mt-10 bg-white rounded-2xl border border-slate-200 p-6">
                  <MessageSquare size={32} className="text-primary mx-auto mb-2" />
                  <p className="text-base font-semibold text-slate-800">How can we help?</p>
                  <p className="text-sm text-slate-500 mt-1">
                    Send us a message and the ClassPulse team will reply here. Common topics:
                    billing, account access, feature requests, or app problems.
                  </p>
                </div>
              ) : (
                messages.map((m) => {
                  const mine = m.sender_role === 'school_admin';
                  return (
                    <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[78%] rounded-2xl px-4 py-2 text-sm border ${
                        mine
                          ? 'bg-primary text-white border-primary'
                          : 'bg-white text-slate-800 border-slate-200'
                      }`}>
                        {!mine && (
                          <p className="text-[10px] font-semibold text-slate-400 mb-0.5">
                            {m.sender_role === 'super_admin' ? 'ClassPulse Team' : m.sender_name}
                          </p>
                        )}
                        <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                        <p className={`text-[10px] mt-1 text-right ${mine ? 'text-white/70' : 'text-slate-400'}`}>
                          {fullTime(m.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="border-t border-slate-100 p-3">
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Describe your concern or complaint..."
                  rows={2}
                  maxLength={2000}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  className="flex-1 resize-none px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm outline-none focus:border-primary focus:bg-white"
                />
                <button
                  onClick={handleSend}
                  disabled={sending || !input.trim()}
                  className="bg-primary hover:bg-primary-dark text-white rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <Send size={14} />
                  {sending ? 'Sending...' : 'Send'}
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1.5 ml-1">Press Ctrl/⌘+Enter to send</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
