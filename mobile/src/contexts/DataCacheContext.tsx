import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { FUNCTIONS_URL, supabase, getAuthHeaders } from '../lib/supabase';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { useAuth } from './AuthContext';
import type { AttendanceRecord, FeedMessage, Grade, ExamScore, LearnerAssessment } from '../types';

const STALE_MS = 30_000; // 30 seconds

interface FeedData {
  records: AttendanceRecord[];
  messages: FeedMessage[];
  adviserChannel: {
    section_id: string;
    section_name: string;
    grade_level: string;
    adviser_id: string | null;
    adviser_name: string;
  } | null;
}

interface GradesData {
  grades: Grade[];
}

interface ExamScoresData {
  exam_scores: ExamScore[];
}

interface AssessmentsData {
  academic_year: { id: string; name: string } | null;
  assessments: LearnerAssessment[];
}

interface DataCacheContextValue {
  feed: FeedData;
  grades: GradesData;
  examScores: ExamScoresData;
  assessments: AssessmentsData;
  feedLoading: boolean;
  gradesLoading: boolean;
  examScoresLoading: boolean;
  assessmentsLoading: boolean;
  refreshFeed: () => Promise<void>;
  refreshGrades: () => Promise<void>;
  refreshExamScores: () => Promise<void>;
  refreshAssessments: () => Promise<void>;
}

const DataCacheContext = createContext<DataCacheContextValue>({
  feed: { records: [], messages: [], adviserChannel: null },
  grades: { grades: [] },
  examScores: { exam_scores: [] },
  assessments: { academic_year: null, assessments: [] },
  feedLoading: true,
  gradesLoading: true,
  examScoresLoading: true,
  assessmentsLoading: true,
  refreshFeed: async () => {},
  refreshGrades: async () => {},
  refreshExamScores: async () => {},
  refreshAssessments: async () => {},
});

export function useDataCache() {
  return useContext(DataCacheContext);
}

export function DataCacheProvider({ children }: { children: React.ReactNode }) {
  const { session, role, hasAccess, setParentAccessEnabled } = useAuth();

  const [feed, setFeed] = useState<FeedData>({ records: [], messages: [], adviserChannel: null });
  const [grades, setGrades] = useState<GradesData>({ grades: [] });
  const [examScores, setExamScores] = useState<ExamScoresData>({ exam_scores: [] });
  const [assessments, setAssessments] = useState<AssessmentsData>({ academic_year: null, assessments: [] });
  const [feedLoading, setFeedLoading] = useState(true);
  const [gradesLoading, setGradesLoading] = useState(true);
  const [examScoresLoading, setExamScoresLoading] = useState(true);
  const [assessmentsLoading, setAssessmentsLoading] = useState(true);

  const feedFetchedAt = useRef<number>(0);
  const gradesFetchedAt = useRef<number>(0);
  const examScoresFetchedAt = useRef<number>(0);
  const assessmentsFetchedAt = useRef<number>(0);
  const feedFetching = useRef(false);
  const gradesFetching = useRef(false);
  const examScoresFetching = useRef(false);
  const assessmentsFetching = useRef(false);
  const prevStudentId = useRef<string | null>(null);

  const handleRestrictedResponse = useCallback(async (res: Response) => {
    if (res.status !== 403) return false;
    try {
      const body = await res.json();
      if (body?.error === 'Parent access is disabled') {
        await setParentAccessEnabled(false);
        return true;
      }
    } catch {
      // Let the caller handle non-JSON error responses normally.
    }
    return false;
  }, [setParentAccessEnabled]);

  // Reset data when the active child changes (multi-child switcher)
  useEffect(() => {
    const currentId = session?.student?.id ?? null;
    if (prevStudentId.current && currentId && prevStudentId.current !== currentId) {
      setFeed({ records: [], messages: [], adviserChannel: null });
      setGrades({ grades: [] });
      setExamScores({ exam_scores: [] });
      setAssessments({ academic_year: null, assessments: [] });
      setFeedLoading(true);
      setGradesLoading(true);
      setExamScoresLoading(true);
      setAssessmentsLoading(true);
      feedFetchedAt.current = 0;
      gradesFetchedAt.current = 0;
      examScoresFetchedAt.current = 0;
      assessmentsFetchedAt.current = 0;
    }
    prevStudentId.current = currentId;
  }, [session?.student?.id]);

  const fetchFeed = useCallback(async (force = false) => {
    if (!session || role !== 'parent' || !hasAccess) return;
    if (feedFetching.current) return;
    if (!force && Date.now() - feedFetchedAt.current < STALE_MS) return;

    feedFetching.current = true;
    try {
      const res = await fetchWithTimeout(`${FUNCTIONS_URL}/get-student-feed`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ student_id: session.student.id, school_id: session.school.id, limit: 200 }),
      });
      if (!res.ok) {
        const restricted = await handleRestrictedResponse(res);
        if (__DEV__ && !restricted) console.warn(`[fetchFeed] HTTP ${res.status}`);
        return; // keep existing data on error
      }
      const json = await res.json();
      if (json.records || json.messages || json.adviser_channel) {
        setFeed({
          records: json.records ?? [],
          messages: json.messages ?? [],
          adviserChannel: json.adviser_channel ?? null,
        });
        feedFetchedAt.current = Date.now();
      }
    } catch {
      // keep existing data
    } finally {
      feedFetching.current = false;
      setFeedLoading(false);
    }
  }, [handleRestrictedResponse, hasAccess, role, session]);

  const fetchGrades = useCallback(async (force = false) => {
    if (!session || role !== 'parent' || !hasAccess) return;
    if (gradesFetching.current) return;
    if (!force && Date.now() - gradesFetchedAt.current < STALE_MS) return;

    gradesFetching.current = true;
    try {
      const res = await fetchWithTimeout(`${FUNCTIONS_URL}/get-student-grades`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ student_id: session.student.id, school_id: session.school.id }),
      });
      if (!res.ok) {
        const restricted = await handleRestrictedResponse(res);
        if (__DEV__ && !restricted) console.warn(`[fetchGrades] HTTP ${res.status}`);
        return; // keep existing data on error
      }
      const json = await res.json();
      if (json.grades) {
        setGrades({ grades: json.grades ?? [] });
        gradesFetchedAt.current = Date.now();
      }
    } catch {
      // keep existing data
    } finally {
      gradesFetching.current = false;
      setGradesLoading(false);
    }
  }, [handleRestrictedResponse, hasAccess, role, session]);

  const fetchExamScores = useCallback(async (force = false) => {
    if (!session || role !== 'parent' || !hasAccess) return;
    if (examScoresFetching.current) return;
    if (!force && Date.now() - examScoresFetchedAt.current < STALE_MS) return;

    examScoresFetching.current = true;
    try {
      const res = await fetchWithTimeout(`${FUNCTIONS_URL}/get-student-exam-scores`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ student_id: session.student.id, school_id: session.school.id }),
      });
      if (!res.ok) {
        const restricted = await handleRestrictedResponse(res);
        if (__DEV__ && !restricted) console.warn(`[fetchExamScores] HTTP ${res.status}`);
        return;
      }
      const json = await res.json();
      if (json.exam_scores) {
        setExamScores({ exam_scores: json.exam_scores ?? [] });
        examScoresFetchedAt.current = Date.now();
      }
    } catch {
      // keep existing data
    } finally {
      examScoresFetching.current = false;
      setExamScoresLoading(false);
    }
  }, [handleRestrictedResponse, hasAccess, role, session]);

  const fetchAssessments = useCallback(async (force = false) => {
    if (!session || role !== 'parent' || !hasAccess) return;
    if (assessmentsFetching.current) return;
    if (!force && Date.now() - assessmentsFetchedAt.current < STALE_MS) return;

    assessmentsFetching.current = true;
    try {
      const res = await fetchWithTimeout(`${FUNCTIONS_URL}/get-student-assessments`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ student_id: session.student.id, school_id: session.school.id }),
      });
      if (!res.ok) {
        const restricted = await handleRestrictedResponse(res);
        if (__DEV__ && !restricted) console.warn(`[fetchAssessments] HTTP ${res.status}`);
        return;
      }
      const json = await res.json();
      setAssessments({ academic_year: json.academic_year ?? null, assessments: json.assessments ?? [] });
      assessmentsFetchedAt.current = Date.now();
    } catch {
      // Keep the most recent successful data while temporarily offline.
    } finally {
      assessmentsFetching.current = false;
      setAssessmentsLoading(false);
    }
  }, [handleRestrictedResponse, hasAccess, role, session]);

  // Initial fetch
  useEffect(() => {
    if (role === 'parent' && session && hasAccess) {
      void fetchFeed(true);
      void fetchGrades(true);
      void fetchExamScores(true);
      void fetchAssessments(true);
    } else if (role === 'parent' && session && !hasAccess) {
      setFeed({ records: [], messages: [], adviserChannel: null });
      setGrades({ grades: [] });
      setExamScores({ exam_scores: [] });
      setAssessments({ academic_year: null, assessments: [] });
      setFeedLoading(false);
      setGradesLoading(false);
      setExamScoresLoading(false);
      setAssessmentsLoading(false);
      feedFetchedAt.current = 0;
      gradesFetchedAt.current = 0;
      examScoresFetchedAt.current = 0;
      assessmentsFetchedAt.current = 0;
    }
  }, [hasAccess, role, session, fetchFeed, fetchGrades, fetchExamScores, fetchAssessments]);

  // Refetch data when the app comes back to foreground
  useEffect(() => {
    if (role !== 'parent' || !session || !hasAccess) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void fetchFeed(true);
        void fetchGrades(true);
        void fetchExamScores(true);
        void fetchAssessments(true);
      }
    });
    return () => sub.remove();
  }, [hasAccess, role, session, fetchFeed, fetchGrades, fetchExamScores, fetchAssessments]);

  // Keep every notification-backed destination fresh before the user opens it.
  useEffect(() => {
    if (role !== 'parent' || !session || !hasAccess) return;
    const sub = Notifications.addNotificationReceivedListener(() => {
      void fetchFeed(true);
      void fetchGrades(true);
      void fetchExamScores(true);
      void fetchAssessments(true);
    });
    return () => sub.remove();
  }, [hasAccess, role, session, fetchFeed, fetchGrades, fetchExamScores, fetchAssessments]);

  // Single consolidated realtime channel (3→1 to reduce connection count)
  useEffect(() => {
    if (role !== 'parent' || !session || !hasAccess) return;

    const channel = supabase
      .channel(`cache-all-${session.student.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'attendance_records',
          filter: `student_id=eq.${session.student.id}`,
        },
        () => { void fetchFeed(true); }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `student_id=eq.${session.student.id}`,
        },
        () => { void fetchFeed(true); }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'grades',
          filter: `student_id=eq.${session.student.id}`,
        },
        () => { void fetchGrades(true); }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'academic_years',
          filter: `school_id=eq.${session.school.id}`,
        },
        () => { void fetchFeed(true); void fetchGrades(true); void fetchExamScores(true); void fetchAssessments(true); }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'exam_scores',
          filter: `student_id=eq.${session.student.id}`,
        },
        () => { void fetchExamScores(true); }
      )
      .subscribe((status) => {
        if (__DEV__) console.log('[Realtime] channel status:', status);
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [hasAccess, role, session, fetchFeed, fetchGrades, fetchExamScores, fetchAssessments]);

  const refreshFeed = useCallback(() => fetchFeed(true), [fetchFeed]);
  const refreshGrades = useCallback(() => fetchGrades(true), [fetchGrades]);
  const refreshExamScores = useCallback(() => fetchExamScores(true), [fetchExamScores]);
  const refreshAssessments = useCallback(() => fetchAssessments(true), [fetchAssessments]);

  return (
    <DataCacheContext.Provider
      value={{ feed, grades, examScores, assessments, feedLoading, gradesLoading, examScoresLoading, assessmentsLoading, refreshFeed, refreshGrades, refreshExamScores, refreshAssessments }}
    >
      {children}
    </DataCacheContext.Provider>
  );
}
