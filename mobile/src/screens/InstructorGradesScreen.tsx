import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
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
import { supabase } from '../lib/supabase';
import type { Schedule, Student } from '../types';
import { colors } from '../theme/colors';
import GridBackground from '../components/GridBackground';

interface CardKey {
  subjectId: string;
  sectionId: string;
  subjectName: string;
  subjectCode: string;
  sectionName: string;
  gradeLevel: string;
}

interface GradeEntry {
  student_id: string;
  q1: string;
  q2: string;
  q3: string;
}

const QUARTERS = [
  { key: 'q1', label: 'Q1', q: 1 },
  { key: 'q2', label: 'Q2', q: 2 },
  { key: 'q3', label: 'Q3', q: 3 },
] as const;

type QuarterKey = (typeof QUARTERS)[number]['key'];

export default function InstructorGradesScreen() {
  const { instructorUser } = useAuth();
  const insets = useSafeAreaInsets();

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [academicYearId, setAcademicYearId] = useState<string | null>(null);
  const [yearName, setYearName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [selected, setSelected] = useState<CardKey | null>(null);
  const [activeQuarter, setActiveQuarter] = useState<QuarterKey>('q1');
  const [students, setStudents] = useState<Student[]>([]);
  const [grades, setGrades] = useState<GradeEntry[]>([]);
  const [loadingGrades, setLoadingGrades] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadSchedules = useCallback(async () => {
    if (!instructorUser) return;

    let yearId: string | null = null;
    if (instructorUser.school_id) {
      const { data: yearRow } = await supabase
        .from('academic_years')
        .select('id, name')
        .eq('school_id', instructorUser.school_id)
        .eq('is_current', true)
        .single();
      yearId = yearRow?.id ?? null;
      setAcademicYearId(yearId);
      setYearName(yearRow?.name ?? null);
    }

    let query = supabase
      .from('schedules')
      .select('*, subject:subjects(*), section:sections(*)')
      .eq('instructor_id', instructorUser.id);
    if (yearId) query = query.eq('academic_year_id', yearId);
    const { data } = await query.order('day_of_week').order('time_start');
    setSchedules((data as Schedule[]) ?? []);
  }, [instructorUser]);

  useEffect(() => {
    loadSchedules().finally(() => setLoading(false));
  }, [loadSchedules]);

  async function onRefresh() {
    setRefreshing(true);
    await loadSchedules();
    setRefreshing(false);
  }

  const groupedCards = useMemo(() => {
    const map = new Map<string, CardKey & { schedules: Schedule[] }>();
    schedules.forEach((s) => {
      const key = `${s.subject_id}__${s.section_id}`;
      if (!map.has(key)) {
        map.set(key, {
          subjectId: s.subject_id,
          sectionId: s.section_id,
          subjectName: s.subject?.name ?? '',
          subjectCode: s.subject?.code ?? '',
          sectionName: s.section?.name ?? '',
          gradeLevel: s.section?.grade_level ?? '',
          schedules: [],
        });
      }
      map.get(key)!.schedules.push(s);
    });
    return [...map.values()];
  }, [schedules]);

  async function selectCard(card: CardKey) {
    setSelected(card);
    setActiveQuarter('q1');
    setLoadingGrades(true);

    const { data: studentData } = await supabase
      .from('students')
      .select('*')
      .eq('section_id', card.sectionId)
      .order('last_name');

    const list = (studentData as Student[]) ?? [];
    setStudents(list);

    let gradesQuery = supabase
      .from('grades')
      .select('*')
      .eq('subject_id', card.subjectId)
      .lte('quarter', 3)
      .in('student_id', list.map((s) => s.id));
    if (academicYearId) gradesQuery = gradesQuery.eq('academic_year_id', academicYearId);
    const { data: existing } = await gradesQuery;

    const gradeMap = new Map<string, Record<number, number>>();
    if (existing) {
      for (const g of existing as { student_id: string; quarter: number; grade: number }[]) {
        if (!gradeMap.has(g.student_id)) gradeMap.set(g.student_id, {});
        gradeMap.get(g.student_id)![g.quarter] = g.grade;
      }
    }

    const entries: GradeEntry[] = list.map((s) => ({
      student_id: s.id,
      q1: gradeMap.get(s.id)?.[1]?.toString() ?? '',
      q2: gradeMap.get(s.id)?.[2]?.toString() ?? '',
      q3: gradeMap.get(s.id)?.[3]?.toString() ?? '',
    }));
    setGrades(entries);
    setLoadingGrades(false);
  }

  function backToCards() {
    setSelected(null);
    setStudents([]);
    setGrades([]);
  }

  function updateGrade(studentId: string, quarter: QuarterKey, raw: string) {
    const cleaned = raw.replace(/[^0-9.]/g, '');
    if (cleaned !== '') {
      const n = Number(cleaned);
      if (isNaN(n) || n < 0 || n > 100) return;
    }
    setGrades((prev) =>
      prev.map((g) => (g.student_id === studentId ? { ...g, [quarter]: cleaned } : g))
    );
  }

  function average(entry: GradeEntry): string {
    const vals = [entry.q1, entry.q2, entry.q3]
      .filter((v) => v !== '')
      .map(Number);
    if (vals.length === 0) return '—';
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  }

  async function handleSave() {
    if (!selected || !instructorUser?.school_id) return;
    setSaving(true);

    const upserts: Array<{
      school_id: string;
      student_id: string;
      subject_id: string;
      quarter: number;
      grade: number;
      created_by: string;
      updated_at: string;
      academic_year_id: string | null;
    }> = [];
    const cleared: Array<{ student_id: string; quarter: number }> = [];
    const now = new Date().toISOString();

    for (const entry of grades) {
      for (const q of QUARTERS) {
        const v = entry[q.key];
        if (v !== '' && !isNaN(Number(v))) {
          upserts.push({
            school_id: instructorUser.school_id,
            student_id: entry.student_id,
            subject_id: selected.subjectId,
            quarter: q.q,
            grade: Number(v),
            created_by: instructorUser.id,
            updated_at: now,
            academic_year_id: academicYearId,
          });
        } else {
          cleared.push({ student_id: entry.student_id, quarter: q.q });
        }
      }
    }

    try {
      if (upserts.length > 0) {
        const { error } = await supabase
          .from('grades')
          .upsert(upserts, { onConflict: 'student_id,subject_id,quarter,academic_year_id' });
        if (error) throw error;
      }

      if (cleared.length > 0) {
        await Promise.all(
          cleared.map(({ student_id, quarter }) =>
            supabase
              .from('grades')
              .delete()
              .eq('subject_id', selected.subjectId)
              .eq('student_id', student_id)
              .eq('quarter', quarter)
              .eq('academic_year_id', academicYearId)
          )
        );
      }

      const updatedStudentIds = [...new Set(upserts.map((u) => u.student_id))];
      if (updatedStudentIds.length > 0) {
        supabase.functions
          .invoke('send-grade-notification', {
            body: {
              student_ids: updatedStudentIds,
              subject_name: selected.subjectName,
              subject_code: selected.subjectCode,
            },
          })
          .catch(() => {});
      }

      Alert.alert('Saved', 'Grades saved successfully.');
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to save grades.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <GridBackground>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </GridBackground>
    );
  }

  if (selected) {
    return (
      <GridBackground>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        >
          <View style={[styles.entryHeader, { paddingTop: insets.top + 12 }]}>
            <TouchableOpacity onPress={backToCards} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={20} color={colors.text} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.entryTitle} numberOfLines={1}>
                {selected.subjectName}
              </Text>
              <Text style={styles.entrySubtitle} numberOfLines={1}>
                {selected.subjectCode} · {selected.gradeLevel} - {selected.sectionName}
              </Text>
            </View>
          </View>

          <View style={styles.quarterRow}>
            {QUARTERS.map((q) => (
              <TouchableOpacity
                key={q.key}
                onPress={() => setActiveQuarter(q.key)}
                style={[styles.quarterChip, activeQuarter === q.key && styles.quarterChipActive]}
              >
                <Text
                  style={[
                    styles.quarterChipText,
                    activeQuarter === q.key && styles.quarterChipTextActive,
                  ]}
                >
                  {q.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {loadingGrades ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : students.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="school-outline" size={44} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>No students</Text>
              <Text style={styles.emptySubtitle}>This section has no enrolled students yet.</Text>
            </View>
          ) : (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 110 }}
              keyboardShouldPersistTaps="handled"
            >
              {students.map((student, idx) => {
                const entry = grades.find((g) => g.student_id === student.id);
                if (!entry) return null;
                const avg = average(entry);
                const numAvg = avg === '—' ? null : Number(avg);
                const avgColor =
                  numAvg === null
                    ? colors.textMuted
                    : numAvg >= 75
                    ? colors.success
                    : colors.danger;

                return (
                  <View key={student.id} style={styles.studentRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.studentName} numberOfLines={1}>
                        {idx + 1}. {student.last_name}, {student.first_name}
                        {student.middle_name ? ` ${student.middle_name.charAt(0)}.` : ''}
                      </Text>
                      <Text style={styles.studentLrn}>
                        LRN {student.lrn} · Avg{' '}
                        <Text style={{ color: avgColor, fontWeight: '700' }}>{avg}</Text>
                      </Text>
                    </View>
                    <TextInput
                      value={entry[activeQuarter]}
                      onChangeText={(v) => updateGrade(student.id, activeQuarter, v)}
                      keyboardType="decimal-pad"
                      placeholder="—"
                      placeholderTextColor={colors.textMuted}
                      style={styles.gradeInput}
                      maxLength={5}
                      returnKeyType="done"
                    />
                  </View>
                );
              })}
            </ScrollView>
          )}

          <View style={[styles.saveBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <TouchableOpacity
              onPress={handleSave}
              disabled={saving || students.length === 0}
              style={[styles.saveBtn, (saving || students.length === 0) && styles.saveBtnDisabled]}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="save-outline" size={18} color="#fff" />
                  <Text style={styles.saveBtnText}>Save Grades</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </GridBackground>
    );
  }

  return (
    <GridBackground>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
      >
        <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={styles.headerTitle}>Grades</Text>
            {yearName ? (
              <View style={styles.yearPill}>
                <Text style={styles.yearPillText}>SY {yearName}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.headerSubtitle}>Tap a class to enter quarterly grades</Text>
        </View>

        {groupedCards.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="book-outline" size={44} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No classes assigned</Text>
            <Text style={styles.emptySubtitle}>Your subjects appear here once admin assigns them.</Text>
          </View>
        ) : (
          <View style={styles.cardsWrap}>
            {groupedCards.map((card) => (
              <TouchableOpacity
                key={`${card.subjectId}__${card.sectionId}`}
                style={styles.classCard}
                onPress={() => selectCard(card)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.classSubject}>{card.subjectName}</Text>
                  <Text style={styles.classCode}>{card.subjectCode}</Text>
                  <View style={styles.classMeta}>
                    <Ionicons name="people-outline" size={13} color={colors.textMuted} />
                    <Text style={styles.classMetaText}>
                      {card.gradeLevel} - {card.sectionName}
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </GridBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingBottom: 28 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 },
  header: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: colors.text },
  headerSubtitle: { marginTop: 4, color: colors.textMuted, fontSize: 14 },
  yearPill: {
    backgroundColor: colors.primary + '18',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  yearPillText: { fontSize: 12, fontWeight: '700', color: colors.primary },

  cardsWrap: { paddingHorizontal: 12, paddingTop: 12, gap: 10 },
  classCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  classSubject: { fontSize: 16, fontWeight: '700', color: colors.text },
  classCode: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  classMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  classMetaText: { fontSize: 13, color: colors.textMuted },

  entryHeader: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 12,
    paddingBottom: 10,
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
  entryTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  entrySubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },

  quarterRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    gap: 8,
  },
  quarterChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  quarterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  quarterChipText: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  quarterChipTextActive: { color: '#fff' },

  studentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    gap: 10,
  },
  studentName: { fontSize: 14, fontWeight: '600', color: colors.text },
  studentLrn: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  gradeInput: {
    width: 64,
    height: 40,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    backgroundColor: colors.surfaceSoft,
  },

  saveBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 13,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  emptyContainer: {
    marginTop: 30,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 28,
    marginHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  emptyTitle: { marginTop: 10, fontSize: 18, color: colors.text, fontWeight: '700' },
  emptySubtitle: { marginTop: 5, color: colors.textMuted, fontSize: 13, textAlign: 'center' },
});
