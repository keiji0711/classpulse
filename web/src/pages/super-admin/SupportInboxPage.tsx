import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { invokeEdgeFunction } from '../../lib/invokeEdgeFunction';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  Inbox, Send, Search, CheckCircle2, RotateCcw, MessageSquare, User, GraduationCap, Building2,
} from 'lucide-react';

type SenderRole = 'parent' | 'instructor' | 'school_admin';

const ROLE_LABEL: Record<SenderRole, string> = {
  parent: 'Parent',
  instructor: 'Teacher',
  school_admin: 'School Admin',
};

interface SupportThread {
  id: string;
  school_id: string | null;
  parent_id: string | null;
  instructor_user_id: string | null;
  sender_role: SenderRole;
  sender_name: string;
  sender_email: string | null;
  subject: string;
  status: 'open' | 'closed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  category: string;
  assigned_to: string | null;
  internal_notes: string;
  due_at: string | null;
  unread_for_admin: boolean;
  unread_for_user: boolean;
  last_message_at: string;
  last_message_preview: string | null;
  created_at: string;
}

interface SupportMessage {
  id: string;
  thread_id: string;
  sender_role: SenderRole | 'super_admin';
  sender_name: string;
  content: string;
  created_at: string;
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function fullTime(iso: string) {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function SupportInboxPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [reply, setReply] = useState('');
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('open');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    const { data } = await supabase
      .from('support_threads')
      .select('*')
      .order('last_message_at', { ascending: false });
    setThreads((data as SupportThread[]) ?? []);
    setLoading(false);
  }, []);

  const loadMessages = useCallback(async (threadId: string) => {
    const { data } = await supabase
      .from('support_messages')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });
    setMessages((data as SupportMessage[]) ?? []);

    // Mark thread read for admin
    await supabase.from('support_threads').update({ unread_for_admin: false }).eq('id', threadId);
    setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, unread_for_admin: false } : t)));
  }, []);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (activeId) loadMessages(activeId);
    else setMessages([]);
  }, [activeId, loadMessages]);

  // Realtime: refresh on any thread or message change.
  useEffect(() => {
    const channel = supabase
      .channel('support-inbox')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_threads' }, () => {
        loadThreads();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, (payload) => {
        const m = payload.new as SupportMessage;
        if (m.thread_id === activeId) {
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeId, loadThreads]);

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }, [messages.length]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return threads.filter((t) => {
      if (filter !== 'all' && t.status !== filter) return false;
      if (!q) return true;
      return (
        t.sender_name.toLowerCase().includes(q) ||
        (t.sender_email ?? '').toLowerCase().includes(q) ||
        (t.last_message_preview ?? '').toLowerCase().includes(q)
      );
    });
  }, [threads, filter, search]);

  const active = useMemo(() => threads.find((t) => t.id === activeId) ?? null, [threads, activeId]);

  async function sendReply() {
    if (!active || !user || !reply.trim() || sending) return;
    setSending(true);
    const content = reply.trim();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Your session expired. Please sign in again.');

      // Edge function inserts the reply + updates the thread, then pushes an
      // FCM notification to the parent so they're alerted of the response.
      const { error } = await invokeEdgeFunction('support-admin-reply', session.access_token, {
        thread_id: active.id,
        content,
      });
      if (error) throw new Error(error);

      setReply('');
      loadThreads();
    } catch (err: any) {
      showToast(err?.message ?? 'Failed to send reply', 'error');
    } finally {
      setSending(false);
    }
  }

  async function setStatus(threadId: string, status: 'open' | 'closed') {
    await supabase.from('support_threads').update({ status }).eq('id', threadId);
    setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, status } : t)));
    showToast(status === 'closed' ? 'Conversation closed.' : 'Conversation reopened.');
  }

  async function setPriority(threadId: string, priority: SupportThread['priority']) {
    const { error } = await supabase.from('support_threads').update({ priority }).eq('id', threadId);
    if (error) { showToast(error.message, 'error'); return; }
    setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, priority } : t)));
  }

  const unreadCount = threads.filter((t) => t.unread_for_admin && t.status === 'open').length;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Inbox size={22} className="text-primary" /> Support Inbox
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Messages from parents and teachers{unreadCount > 0 ? ` · ${unreadCount} unread` : ''}.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 h-[calc(100vh-220px)] min-h-[520px]">
        {/* Thread list */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col">
          <div className="p-3 border-b border-slate-100 space-y-2">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200">
              <Search size={14} className="text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, email..."
                className="flex-1 text-xs bg-transparent outline-none"
              />
            </div>
            <div className="flex gap-1">
              {(['open', 'all', 'closed'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-colors cursor-pointer ${
                    filter === f
                      ? 'bg-primary text-white'
                      : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {f === 'open' ? 'Open' : f === 'all' ? 'All' : 'Closed'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16 px-6">
                <MessageSquare size={28} className="text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-400">No conversations</p>
              </div>
            ) : (
              <ul>
                {filtered.map((t) => {
                  const isActive = t.id === activeId;
                  return (
                    <li key={t.id}>
                      <button
                        onClick={() => setActiveId(t.id)}
                        className={`w-full text-left px-3 py-3 border-b border-slate-100 transition-colors cursor-pointer ${
                          isActive ? 'bg-primary/5' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          {t.sender_role === 'parent' ? (
                            <User size={13} className="text-emerald-600 shrink-0" />
                          ) : t.sender_role === 'instructor' ? (
                            <GraduationCap size={13} className="text-sky-600 shrink-0" />
                          ) : (
                            <Building2 size={13} className="text-amber-600 shrink-0" />
                          )}
                          <p className={`text-sm font-semibold truncate flex-1 ${t.unread_for_admin ? 'text-slate-900' : 'text-slate-700'}`}>
                            {t.sender_name}
                          </p>
                          {t.unread_for_admin && (
                            <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                          )}
                          <span className="text-[10px] text-slate-400 shrink-0">{timeLabel(t.last_message_at)}</span>
                        </div>
                        <p className="text-xs text-slate-500 line-clamp-2 leading-snug">
                          {t.last_message_preview ?? 'No messages yet'}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                            t.status === 'open' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {t.status}
                          </span>
                          <span className="text-[10px] text-slate-400">{ROLE_LABEL[t.sender_role]}</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Conversation */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col">
          {!active ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
              <MessageSquare size={40} className="mb-2" />
              <p className="text-sm font-medium">Select a conversation</p>
              <p className="text-xs mt-1">Pick a thread on the left to view and reply.</p>
            </div>
          ) : (
            <>
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{active.sender_name}</p>
                  <p className="text-xs text-slate-500 truncate">
                    {ROLE_LABEL[active.sender_role]}
                    {active.sender_email ? ` · ${active.sender_email}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select aria-label="Support priority" value={active.priority ?? 'normal'} onChange={(e) => void setPriority(active.id, e.target.value as SupportThread['priority'])} className={`rounded-lg border px-2 py-1.5 text-xs font-semibold capitalize ${active.priority==='urgent'?'border-rose-200 bg-rose-50 text-rose-700':active.priority==='high'?'border-amber-200 bg-amber-50 text-amber-700':'border-slate-200 bg-white text-slate-600'}`}>
                    <option value="low">Low priority</option><option value="normal">Normal priority</option><option value="high">High priority</option><option value="urgent">Urgent</option>
                  </select>
                  {active.status === 'open' ? (
                    <button
                      onClick={() => setStatus(active.id, 'closed')}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer flex items-center gap-1.5"
                    >
                      <CheckCircle2 size={13} /> Mark closed
                    </button>
                  ) : (
                    <button
                      onClick={() => setStatus(active.id, 'open')}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 cursor-pointer flex items-center gap-1.5"
                    >
                      <RotateCcw size={13} /> Reopen
                    </button>
                  )}
                </div>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-3 bg-slate-50/40">
                {messages.map((m) => {
                  const isAdmin = m.sender_role === 'super_admin';
                  return (
                    <div key={m.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[78%] rounded-2xl px-4 py-2 text-sm border ${
                        isAdmin
                          ? 'bg-primary text-white border-primary'
                          : 'bg-white text-slate-800 border-slate-200'
                      }`}>
                        {!isAdmin && (
                          <p className="text-[10px] font-semibold text-slate-400 mb-0.5">{m.sender_name}</p>
                        )}
                        <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                        <p className={`text-[10px] mt-1 text-right ${isAdmin ? 'text-white/70' : 'text-slate-400'}`}>
                          {fullTime(m.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
                {messages.length === 0 && (
                  <p className="text-center text-xs text-slate-400 py-8">No messages in this conversation.</p>
                )}
              </div>

              <div className="border-t border-slate-100 p-3">
                <div className="flex items-end gap-2">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Type your reply..."
                    rows={2}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        sendReply();
                      }
                    }}
                    className="flex-1 resize-none px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm outline-none focus:border-primary focus:bg-white"
                  />
                  <button
                    onClick={sendReply}
                    disabled={sending || !reply.trim()}
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
    </div>
  );
}
