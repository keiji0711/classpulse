import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import type { AcademicYear } from '../types';

interface AcademicYearContextType {
  years: AcademicYear[];
  activeYear: AcademicYear | null;
  currentYear: AcademicYear | null;
  isViewingCurrentYear: boolean;
  canWriteToActiveYear: boolean;
  isSelectedYearDraft: boolean;
  setActiveYearId: (id: string) => void;
  loading: boolean;
  refetch: () => Promise<void>;
}

const AcademicYearContext = createContext<AcademicYearContextType | undefined>(undefined);

export function AcademicYearProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const schoolId = user?.school_id ?? null;
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [activeYearId, setActiveYearId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchYears = useCallback(async () => {
    if (!schoolId) {
      setYears([]);
      setActiveYearId(null);
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from('academic_years')
      .select('*')
      .eq('school_id', schoolId)
      .order('start_date', { ascending: false });

    const list = (data ?? []) as AcademicYear[];
    setYears(list);

    // Resolve against the latest server list without closing over an old
    // selection. This also recovers cleanly after login or a year rollover.
    setActiveYearId((selectedId) => {
      if (selectedId && list.some((year) => year.id === selectedId)) return selectedId;
      const current = list.find((year) => year.is_current);
      return current?.id ?? list[0]?.id ?? null;
    });

    setLoading(false);
  }, [schoolId]);

  useEffect(() => {
    fetchYears();
  }, [fetchYears]);

  // Listen for realtime changes
  useEffect(() => {
    if (!schoolId) return;

    const channel = supabase
      .channel('academic_years_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'academic_years', filter: `school_id=eq.${schoolId}` }, () => {
        fetchYears();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [schoolId, fetchYears]);

  // The current-year fallback prevents a transient null selection between the
  // year query completing and React applying the selected id update.
  const activeYear = years.find(y => y.id === activeYearId) ?? years.find(y => y.is_current) ?? years[0] ?? null;
  const currentYear = years.find(y => y.is_current) ?? null;
  const isViewingCurrentYear = Boolean(activeYear && currentYear && activeYear.id === currentYear.id);
  const canWriteToActiveYear = isViewingCurrentYear && (!activeYear?.status || activeYear.status === 'active');
  const isSelectedYearDraft = activeYear?.status === 'draft';

  return (
    <AcademicYearContext.Provider value={{ years, activeYear, currentYear, isViewingCurrentYear, canWriteToActiveYear, isSelectedYearDraft, setActiveYearId, loading, refetch: fetchYears }}>
      {children}
    </AcademicYearContext.Provider>
  );
}

export function useAcademicYear() {
  const ctx = useContext(AcademicYearContext);
  if (!ctx) throw new Error('useAcademicYear must be used within AcademicYearProvider');
  return ctx;
}
