import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import { ScrollText, Search, UserPlus, KeyRound, Trash2, MessageSquare, Activity } from 'lucide-react';

interface AuditRow {
  id: string;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

const ACTION_META: Record<string, { label: string; color: string; bg: string; icon: typeof UserPlus }> = {
  'staff.create': { label: 'Created staff', color: 'text-emerald-700', bg: 'bg-emerald-50', icon: UserPlus },
  'staff.update': { label: 'Updated access', color: 'text-indigo-700', bg: 'bg-indigo-50', icon: KeyRound },
  'staff.remove': { label: 'Removed staff', color: 'text-rose-700', bg: 'bg-rose-50', icon: Trash2 },
  'support.reply': { label: 'Support reply', color: 'text-sky-700', bg: 'bg-sky-50', icon: MessageSquare },
};

function meta(action: string) {
  return ACTION_META[action] ?? { label: action, color: 'text-slate-600', bg: 'bg-slate-100', icon: Activity };
}

function fullTime(iso: string) {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string>('all');

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('admin_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300);
    setRows((data as AuditRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(['admin_audit_log'], load);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== 'all' && r.action !== filter) return false;
      if (!q) return true;
      return (
        (r.actor_name ?? '').toLowerCase().includes(q) ||
        (r.actor_email ?? '').toLowerCase().includes(q) ||
        (r.target_label ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, search, filter]);

  const actionTypes = useMemo(() => Array.from(new Set(rows.map((r) => r.action))), [rows]);

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <ScrollText size={22} className="text-primary" /> Audit Log
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">A tamper-resistant record of sensitive platform actions.</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 flex-1 min-w-[220px]">
          <Search size={15} className="text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by actor or target..." className="flex-1 text-sm bg-transparent outline-none" />
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-sm text-slate-600 outline-none cursor-pointer">
          <option value="all">All actions</option>
          {actionTypes.map((a) => <option key={a} value={a}>{meta(a).label}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm">No audit entries{rows.length > 0 ? ' match your filter' : ' yet'}.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((r) => {
              const m = meta(r.action);
              const Icon = m.icon;
              return (
                <li key={r.id} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50">
                  <div className={`mt-0.5 p-2 rounded-lg shrink-0 ${m.bg} ${m.color}`}><Icon size={15} /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-800">
                      <span className="font-semibold">{r.actor_name ?? 'Unknown'}</span>
                      <span className={`mx-1.5 text-xs font-semibold ${m.color}`}>{m.label}</span>
                      {r.target_label && <span className="text-slate-500">— {r.target_label}</span>}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {r.actor_email}{r.details && Object.keys(r.details).length > 0 ? ` · ${summarize(r.details)}` : ''}
                    </p>
                  </div>
                  <span className="text-[11px] text-slate-400 whitespace-nowrap mt-0.5">{fullTime(r.created_at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function summarize(details: Record<string, unknown>): string {
  if (Array.isArray(details.permissions)) {
    const perms = details.permissions as string[];
    return perms.length === 0 ? 'no module access' : `access: ${perms.join(', ')}`;
  }
  if (typeof details.delivered_via_push === 'boolean') {
    return details.delivered_via_push ? 'push delivered' : 'no push';
  }
  return '';
}
