import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Search, Building2, School, CornerDownLeft, ArrowUp, ArrowDown } from 'lucide-react';

interface NavItem {
  label: string;
  to: string;
  icon: React.ReactNode;
}

interface Flat {
  id: string;
  group: 'Pages' | 'Schools' | 'School Admins';
  label: string;
  sub?: string;
  icon: React.ReactNode;
  to: string;
}

/**
 * Global ⌘K / Ctrl+K command palette. Jumps to any module, and for super
 * admins live-searches schools and school admins. Mounted once in the layout.
 */
export default function CommandPalette({ navItems, role }: { navItems: NavItem[]; role?: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<Flat[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const isSuper = role === 'super_admin';

  // Toggle with ⌘K / Ctrl+K, close with Esc.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Reset + focus when opened.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setRemote([]);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const pages: Flat[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    return navItems
      .filter((n) => !q || n.label.toLowerCase().includes(q))
      .map((n) => ({ id: `page-${n.to}`, group: 'Pages' as const, label: n.label, icon: n.icon, to: n.to }));
  }, [navItems, query]);

  // Live-search schools + admins (super admin only), debounced.
  useEffect(() => {
    if (!isSuper) return;
    const q = query.trim();
    if (q.length < 2) { setRemote([]); return; }
    const handle = setTimeout(async () => {
      const [schools, admins] = await Promise.all([
        supabase.from('schools').select('id, name').ilike('name', `%${q}%`).limit(6),
        supabase.from('users').select('id, full_name, email').eq('role', 'school_admin').ilike('full_name', `%${q}%`).limit(6),
      ]);
      const items: Flat[] = [];
      for (const s of (schools.data ?? []) as any[]) {
        items.push({ id: `school-${s.id}`, group: 'Schools', label: s.name, icon: <Building2 size={16} className="text-indigo-500" />, to: '/super-admin/schools' });
      }
      for (const a of (admins.data ?? []) as any[]) {
        items.push({ id: `admin-${a.id}`, group: 'School Admins', label: a.full_name, sub: a.email, icon: <School size={16} className="text-violet-500" />, to: '/super-admin/school-admins' });
      }
      setRemote(items);
    }, 200);
    return () => clearTimeout(handle);
  }, [query, isSuper]);

  const results = useMemo(() => [...pages, ...remote], [pages, remote]);

  useEffect(() => { setActive(0); }, [results.length]);

  const select = useCallback((item?: Flat) => {
    if (!item) return;
    setOpen(false);
    navigate(item.to);
  }, [navigate]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); select(results[active]); }
  }

  if (!open) return null;

  // Group results for display while keeping a flat index for keyboard nav.
  const groups: Flat['group'][] = ['Pages', 'Schools', 'School Admins'];
  let runningIndex = -1;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
          <Search size={18} className="text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={isSuper ? 'Search pages, schools, admins...' : 'Search pages...'}
            className="flex-1 text-sm text-slate-700 outline-none bg-transparent"
          />
          <kbd className="text-[10px] font-semibold text-slate-400 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto py-2">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">No results.</p>
          ) : (
            groups.map((g) => {
              const items = results.filter((r) => r.group === g);
              if (items.length === 0) return null;
              return (
                <div key={g} className="mb-1">
                  <p className="px-4 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{g}</p>
                  {items.map((item) => {
                    runningIndex++;
                    const idx = runningIndex;
                    const isActive = idx === active;
                    return (
                      <button
                        key={item.id}
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => select(item)}
                        className={`flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors cursor-pointer ${
                          isActive ? 'bg-primary/10' : 'hover:bg-slate-50'
                        }`}
                      >
                        <span className="shrink-0">{item.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-slate-800 truncate">{item.label}</span>
                          {item.sub && <span className="block text-xs text-slate-400 truncate">{item.sub}</span>}
                        </span>
                        {isActive && <CornerDownLeft size={14} className="text-slate-400 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-100 text-[11px] text-slate-400">
          <span className="flex items-center gap-1"><ArrowUp size={11} /><ArrowDown size={11} /> navigate</span>
          <span className="flex items-center gap-1"><CornerDownLeft size={11} /> open</span>
          <span className="ml-auto flex items-center gap-1"><kbd className="bg-slate-100 border border-slate-200 rounded px-1">⌘</kbd><kbd className="bg-slate-100 border border-slate-200 rounded px-1">K</kbd></span>
        </div>
      </div>
    </div>
  );
}
