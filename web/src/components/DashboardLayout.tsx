import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAcademicYear } from '../contexts/AcademicYearContext';
import { supabase } from '../lib/supabase';
import { Bell, CalendarRange, ChevronDown, Lock, LogOut, Megaphone, Menu, PanelLeftClose, PanelLeftOpen, Search, X } from 'lucide-react';
import { useState, useMemo, useRef, useEffect } from 'react';
import CommandPalette from './CommandPalette';

interface NavItem {
  label: string;
  to: string;
  icon: React.ReactNode;
  group?: string;
}

interface Props {
  title: string;
  navItems: NavItem[];
  content?: React.ReactNode;
  accordionNav?: boolean;
}

export default function DashboardLayout({ title, navItems, content, accordionNav = false }: Props) {
  const { user, signOut } = useAuth();
  const { years, activeYear, canWriteToActiveYear, isSelectedYearDraft, setActiveYearId } = useAcademicYear();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [announcement, setAnnouncement] = useState<{id:string;title:string;message:string;severity:string}|null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebar-width');
    return saved ? Math.max(56, Math.min(320, parseInt(saved))) : 240;
  });
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const collapsed = sidebarWidth < 100;

  const navGroups = useMemo(() => {
    const groups: Array<{ label: string; items: NavItem[] }> = [];
    for (const item of navItems) {
      const label = item.group ?? '';
      const existing = groups.find((group) => group.label === label);
      if (existing) existing.items.push(item);
      else groups.push({ label, items: [item] });
    }
    return groups;
  }, [navItems]);

  function toggleSidebar() {
    const nextWidth = collapsed ? 240 : 72;
    setSidebarWidth(nextWidth);
    localStorage.setItem('sidebar-width', String(nextWidth));
  }

  function toggleGroup(label: string) {
    setOpenGroups(current => {
      if (accordionNav) return current.has(label) ? new Set() : new Set([label]);
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  useEffect(() => {
    const activeGroup = navGroups.find(group => group.items.some(item => item.to === location.pathname));
    if (!activeGroup?.label) return;
    setOpenGroups(current => {
      if (accordionNav) return new Set([activeGroup.label]);
      if (current.has(activeGroup.label)) return current;
      const next = new Set(current);
      next.add(activeGroup.label);
      return next;
    });
  }, [accordionNav, location.pathname, navGroups]);

  useEffect(() => {
    if (!user) return;
    void supabase.from('platform_announcements').select('id,title,message,severity').not('published_at','is',null).order('published_at',{ascending:false}).limit(1).maybeSingle().then(({data}) => {
      if (data && localStorage.getItem(`dismissed-announcement-${data.id}`) !== '1') setAnnouncement(data);
    });
  }, [user]);

  function onDragStart(e: React.MouseEvent) {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current) return;
      const delta = e.clientX - dragStartX.current;
      const next = Math.max(56, Math.min(320, dragStartWidth.current + delta));
      setSidebarWidth(next);
    }
    function onMouseUp() {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setSidebarWidth(prev => {
        localStorage.setItem('sidebar-width', String(prev));
        return prev;
      });
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return navItems.filter((item) => item.label.toLowerCase().includes(q));
  }, [searchQuery, navItems]);

  // Close search dropdown on route change
  useEffect(() => { setSearchQuery(''); setSearchFocused(false); }, [location.pathname]);

  // Close search on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);

  // Close notification dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function toggleNotifications() {
    if (notifOpen) { setNotifOpen(false); return; }
    setNotifOpen(true);
    setNotifLoading(true);
    try {
      let query = supabase.from('notification_logs').select('id, type, status, created_at, student:students(first_name, last_name)').order('created_at', { ascending: false }).limit(15);
      if (user?.role === 'school_admin' && user.school_id) {
        query = query.eq('school_id', user.school_id);
      }
      const { data } = await query;
      setNotifications(data ?? []);
    } catch {
      setNotifications([]);
    }
    setNotifLoading(false);
  }

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  return (
    <div className="flex h-screen overflow-hidden app-grid">
      {/* Global ⌘K command palette */}
      <CommandPalette navItems={navItems} role={user?.role} />

      {/* Skip to content link for keyboard users */}
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:bg-primary focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:text-sm">
        Skip to main content
      </a>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        role="navigation"
        aria-label="Main navigation"
        style={{ width: sidebarWidth }}
        className={`relative hidden lg:flex inset-y-0 left-0 z-30 bg-sidebar text-white flex-col border-r border-slate-700/50 shrink-0`}
      >
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`absolute top-4 z-40 grid h-8 w-8 place-items-center rounded-lg border border-slate-600 bg-slate-800 text-slate-300 shadow-lg transition-all hover:border-slate-500 hover:bg-slate-700 hover:text-white cursor-pointer ${collapsed ? '-right-4' : 'right-3'}`}
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
        <div className={`border-b border-sidebar-hover/80 ${collapsed ? 'p-3' : 'p-5'}`}>
          <div className={`flex items-center gap-3 ${collapsed ? 'justify-center' : 'mb-3'}`}>
            <div className="brand-logo-shell w-9 h-9 rounded-xl flex items-center justify-center shrink-0">
              <img src="/classPulseLogo.png" alt="ClassPulse" className="brand-logo-image" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <h1 className="text-base font-bold tracking-tight truncate">{title}</h1>
                <p className="text-xs text-slate-400 uppercase tracking-wider">Workspace</p>
              </div>
            )}
          </div>
          {!collapsed && <p className="text-sm text-slate-300 truncate">{user?.full_name}</p>}
        </div>

        <nav className="flex-1 p-2 overflow-y-auto scrollbar-hide">
          {navGroups.map((group, groupIndex) => (
            <div key={group.label || 'navigation'} className={groupIndex > 0 ? 'mt-4' : ''}>
              {group.label && !collapsed && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  aria-expanded={openGroups.has(group.label)}
                  className="mb-1 flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300 cursor-pointer"
                >
                  <span>{group.label}</span>
                  <ChevronDown size={14} className={`transition-transform duration-200 ${openGroups.has(group.label) ? '' : '-rotate-90'}`} />
                </button>
              )}
              {group.label && collapsed && groupIndex > 0 && (
                <div className="mx-2 mb-2 border-t border-slate-700/70" />
              )}
              <div className={`space-y-1 ${!collapsed && group.label && !openGroups.has(group.label) ? 'hidden' : ''}`}>
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all overflow-hidden ${
                        collapsed ? 'justify-center' : ''
                      } ${
                        isActive
                          ? 'bg-gradient-to-r from-primary/90 to-secondary text-white shadow-lg shadow-black/20'
                          : 'text-slate-300 hover:bg-sidebar-hover/70 hover:text-white'
                      }`
                    }
                    title={collapsed ? item.label : undefined}
                  >
                    <span className="shrink-0">{item.icon}</span>
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className={`border-t border-sidebar-hover/80 ${collapsed ? 'p-2' : 'p-3'}`}>
          <button
            onClick={handleSignOut}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-300 hover:bg-sidebar-hover hover:text-white w-full transition-colors cursor-pointer ${
              collapsed ? 'justify-center' : ''
            }`}
            title={collapsed ? 'Sign Out' : undefined}
          >
            <LogOut size={18} className="shrink-0" />
            {!collapsed && 'Sign Out'}
          </button>
        </div>

        {/* Drag handle */}
        <div
          onMouseDown={onDragStart}
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/40 transition-colors"
        />
      </aside>

      {/* Mobile sidebar */}
      <aside
        role="navigation"
        aria-label="Main navigation"
        className={`fixed inset-y-0 left-0 z-30 w-60 bg-sidebar text-white transform transition-transform duration-200 ease-in-out flex flex-col border-r border-slate-700/50 lg:hidden ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-5 border-b border-sidebar-hover/80">
          <div className="flex items-center gap-3 mb-3">
            <div className="brand-logo-shell w-9 h-9 rounded-xl flex items-center justify-center shrink-0">
              <img src="/classPulseLogo.png" alt="ClassPulse" className="brand-logo-image" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight">{title}</h1>
              <p className="text-xs text-slate-400 uppercase tracking-wider">Workspace</p>
            </div>
          </div>
          <p className="text-sm text-slate-300 truncate">{user?.full_name}</p>
        </div>
        <nav className="flex-1 p-3 overflow-y-auto scrollbar-hide">
          {navGroups.map((group, groupIndex) => (
            <div key={group.label || 'navigation'} className={groupIndex > 0 ? 'mt-5' : ''}>
              {group.label && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  aria-expanded={openGroups.has(group.label)}
                  className="mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 hover:bg-slate-800 hover:text-slate-300 cursor-pointer"
                >
                  <span>{group.label}</span>
                  <ChevronDown size={14} className={`transition-transform duration-200 ${openGroups.has(group.label) ? '' : '-rotate-90'}`} />
                </button>
              )}
              <div className={`space-y-1.5 ${group.label && !openGroups.has(group.label) ? 'hidden' : ''}`}>
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                        isActive
                          ? 'bg-gradient-to-r from-primary/90 to-secondary text-white shadow-lg shadow-black/20'
                          : 'text-slate-300 hover:bg-sidebar-hover/70 hover:text-white'
                      }`
                    }
                  >
                    {item.icon}
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="p-3 border-t border-sidebar-hover/80">
          <button onClick={handleSignOut} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-300 hover:bg-sidebar-hover hover:text-white w-full transition-colors cursor-pointer">
            <LogOut size={18} /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="px-4 py-3 lg:px-6 border-b border-slate-200/80 glass-panel">
          <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-slate-600 cursor-pointer"
            aria-label="Open navigation menu"
          >
            <Menu size={24} />
          </button>
            <div ref={searchRef} className="hidden md:block relative">
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 min-w-[260px]">
                <Search size={15} className="text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  placeholder="Search modules and records..."
                  className="text-xs text-slate-600 outline-none w-full bg-transparent"
                  aria-label="Search modules"
                />
                <kbd className="hidden lg:flex items-center gap-0.5 text-[10px] font-semibold text-slate-400 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 shrink-0">⌘K</kbd>
              </div>
              {searchFocused && searchQuery.trim() && (
                <div className="absolute top-full left-0 mt-1 w-full bg-white rounded-xl shadow-lg border border-slate-200 z-50 overflow-hidden">
                  {searchResults.length > 0 ? searchResults.map((item) => (
                    <button
                      key={item.to}
                      onClick={() => { navigate(item.to); setSearchQuery(''); setSearchFocused(false); }}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-primary/5 hover:text-primary transition-colors cursor-pointer"
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  )) : (
                    <p className="px-4 py-3 text-xs text-slate-400">No matching modules.</p>
                  )}
                </div>
              )}
            </div>
            {/* Academic Year Selector */}
            {user?.role !== 'super_admin' && years.length > 0 && (
              <div className="flex items-center gap-2">
                {!canWriteToActiveYear && (
                  <span className={`hidden md:inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold border ${isSelectedYearDraft ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                    <Lock size={12} /> {isSelectedYearDraft ? 'Draft setup' : 'Read-only year'}
                  </span>
                )}
                <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200">
                  <CalendarRange size={15} className="text-primary shrink-0" />
                  <select
                    aria-label="Viewed academic year"
                    value={activeYear?.id ?? ''}
                    onChange={(e) => setActiveYearId(e.target.value)}
                    className="text-sm font-medium text-slate-700 bg-transparent outline-none cursor-pointer pr-1"
                  >
                    {years.map((y) => (
                      <option key={y.id} value={y.id}>
                        {y.name}{y.is_current ? ' (Current)' : ' (Read-only)'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            <div className="flex-1" />
            <div ref={bellRef} className="relative">
              <button onClick={toggleNotifications} className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-700 transition-colors cursor-pointer" aria-label="Notifications">
                <Bell size={16} />
              </button>
              {notifOpen && (
                <div className="absolute right-0 top-full mt-1 w-80 bg-white rounded-xl shadow-lg border border-slate-200 z-50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100">
                    <p className="text-sm font-semibold text-slate-800">Notifications</p>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {notifLoading ? (
                      <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" /></div>
                    ) : notifications.length > 0 ? notifications.map((n) => (
                      <div key={n.id} className="px-4 py-2.5 border-b border-slate-50 hover:bg-slate-50">
                        <p className="text-xs text-slate-700">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${n.status === 'delivered' ? 'bg-green-500' : n.status === 'failed' ? 'bg-red-500' : 'bg-slate-400'}`} />
                          {n.type === 'attendance_push' ? 'Attendance push' : n.type}{' '}
                          {n.status === 'delivered' ? 'sent' : n.status}
                          {(n as any).student && ` — ${(n as any).student.first_name} ${(n as any).student.last_name}`}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{new Date(n.created_at).toLocaleString()}</p>
                      </div>
                    )) : (
                      <p className="px-4 py-6 text-center text-xs text-slate-400">No recent notifications.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="hidden sm:block text-right">
              <p className="text-xs text-slate-400">Signed in as</p>
              <p className="text-sm font-semibold text-slate-700 max-w-[240px] truncate">{user?.email}</p>
            </div>
          </div>
        </header>

        {announcement && <div className={`flex items-start gap-3 border-b px-4 py-3 lg:px-7 ${announcement.severity==='critical'?'border-rose-200 bg-rose-50 text-rose-800':announcement.severity==='warning'||announcement.severity==='maintenance'?'border-amber-200 bg-amber-50 text-amber-800':'border-sky-200 bg-sky-50 text-sky-800'}`}><Megaphone size={18} className="mt-0.5 shrink-0"/><div className="flex-1"><p className="text-sm font-bold">{announcement.title}</p><p className="text-xs opacity-90">{announcement.message}</p></div><button aria-label="Dismiss announcement" onClick={()=>{localStorage.setItem(`dismissed-announcement-${announcement.id}`,'1');setAnnouncement(null)}}><X size={17}/></button></div>}

        {/* Page content */}
        <main id="main-content" role="main" className="flex-1 overflow-y-auto p-4 lg:p-7">
          {content ?? <Outlet />}
        </main>
      </div>
    </div>
  );
}
