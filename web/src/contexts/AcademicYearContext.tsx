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
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [activeYearId, setActiveYearId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchYears = useCallback(async () => {
    if (!user?.school_id) {
      setYears([]);
      setActiveYearId(null);
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from('academic_years')
      .select('*')
      .eq('school_id', user.school_id)
      .order('start_date', { ascending: false });

    const list = (data ?? []) as AcademicYear[];
    setYears(list);

    // If no active year selected yet, pick the current one or the most recent
    if (!activeYearId || !list.find(y => y.id === activeYearId)) {
      const current = list.find(y => y.is_current);
      setActiveYearId(current?.id ?? list[0]?.id ?? null);
    }

    setLoading(false);
  }, [user?.school_id]);

  useEffect(() => {
    fetchYears();
  }, [fetchYears]);

  // Listen for realtime changes
  useEffect(() => {
    if (!user?.school_id) return;

    const channel = supabase
      .channel('academic_years_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'academic_years', filter: `school_id=eq.${user.school_id}` }, () => {
        fetchYears();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.school_id, fetchYears]);

  const activeYear = years.find(y => y.id === activeYearId) ?? null;
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
