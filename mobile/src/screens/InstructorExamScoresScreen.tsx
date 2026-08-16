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
import type { ExamPeriod, Schedule, Student } from '../types';
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

interface ScoreEntry {
  student_id: string;
  score: string;
}

const PERIODS: { key: ExamPeriod; label: string }[] = [
  { key: '1st_quarter', label: 'Q1' },
  { key: '2nd_quarter', label: 'Q2' },
  { key: '3rd_quarter', label: 'Q3' },
];

export default function InstructorExamScoresScreen() {
  const { instructorUser } = useAuth();
  const insets = useSafeAreaInsets();

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [academicYearId, setAcademicYearId] = useState<string | null>(null);
  const [yearName, setYearName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [selected, setSelected] = useState<CardKey | null>(null);
  const [period, setPeriod] = useState<ExamPeriod>('1st_quarter');
  const [students, setStudents] = useState<Student[]>([]);
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [totalItems, setTotalItems] = useState('');
  const [loadingScores, setLoadingScores] = useState(false);
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

  async function loadScoresFor(card: CardKey, p: ExamPeriod) {
    setLoadingScores(true);
    const { data: studentData } = await supabase
      .from('students')
      .select('*')
      .eq('section_id', card.sectionId)
      .order('last_name');
    const list = (studentData as Student[]) ?? [];
    setStudents(list);

    let scoresQuery = supabase
      .from('exam_scores')
      .select('*')
      .eq('subject_id', card.subjectId)
      .eq('exam_period', p)
      .in('student_id', list.map((s) => s.id));
    if (academicYearId) scoresQuery = scoresQuery.eq('academic_year_id', academicYearId);
    const { data: existing } = await scoresQuery;

    const firstWithItems = (existing as { total_items: number }[] | null)?.find((s) => s.total_items);
    setTotalItems(firstWithItems ? String(firstWithItems.total_items) : '');

    const scoreMap = new Map<string, number>();
    if (existing) {
      for (const s of existing as { student_id: string; score: number }[]) {
        scoreMap.set(s.student_id, s.score);
      }
    }

    const entries: ScoreEntry[] = list.map((s) => ({
      student_id: s.id,
      score: scoreMap.has(s.id) ? String(scoreMap.get(s.id)) : '',
    }));
    setScores(entries);
    setLoadingScores(false);
  }

  async function selectCard(card: CardKey) {
    setSelected(card);
    setPeriod('1st_quarter');
    await loadScoresFor(card, '1st_quarter');
  }

  async function changePeriod(p: ExamPeriod) {
    setPeriod(p);
    if (selected) await loadScoresFor(selected, p);
  }

  function backToCards() {
    setSelected(null);
    setStudents([]);
    setScores([]);
    setTotalItems('');
  }

  function updateScore(studentId: string, raw: string) {
    const cleaned = raw.replace(/[^0-9.]/g, '');
    if (cleaned !== '') {
      const max = totalItems ? Number(totalItems) : 200;
      const n = Number(cleaned);
      if (isNaN(n) || n < 0 || n > max) return;
    }
    setScores((prev) => prev.map((s) => (s.student_id === studentId ? { ...s, score: cleaned } : s)));
  }

  function updateTotalItems(raw: string) {
    const cleaned = raw.replace(/[^0-9]/g, '');
    if (cleaned !== '') {
      const n = Number(cleaned);
      if (isNaN(n) || n < 1 || n > 200) return;
    }
    setTotalItems(cleaned);
  }

  const mps = useMemo(() => {
    const items = Number(totalItems);
    if (!items || items <= 0) return null;
    const filled = scores.filter((s) => s.score !== '').map((s) => Number(s.score));
    if (filled.length === 0) return null;
    const sum = filled.reduce((a, b) => a + b, 0);
    return (sum / (filled.length * items)) * 100;
  }, [scores, totalItems]);

  async function handleSave() {
    if (!selected || !instructorUser?.school_id) return;
    if (!totalItems || Number(totalItems) <= 0) {
      Alert.alert('Total items required', 'Please set the total items for this exam first.');
      return;
    }
    setSaving(true);

    const items = Number(totalItems);
    const upserts: any[] = [];
    const cleared: string[] = [];
    const now = new Date().toISOString();

    for (const entry of scores) {
      if (entry.score !== '' && !isNaN(Number(entry.score))) {
        upserts.push({
          school_id: instructorUser.school_id,
          student_id: entry.student_id,
          subject_id: selected.subjectId,
          exam_period: period,
          total_items: items,
          score: Number(entry.score),
          created_by: instructorUser.id,
          updated_at: now,
          academic_year_id: academicYearId,
        });
      } else {
        cleared.push(entry.student_id);
      }
    }

    try {
      if (upserts.length > 0) {
        const { error } = await supabase
          .from('exam_scores')
          .upsert(upserts, { onConflict: 'student_id,subject_id,exam_period,academic_year_id' });
        if (error) throw error;
      }

      if (cleared.length > 0) {
        let del = supabase
          .from('exam_scores')
          .delete()
          .eq('subject_id', selected.subjectId)
          .eq('exam_period', period)
          .in('student_id', cleared);
        if (academicYearId) del = del.eq('academic_year_id', academicYearId);
        await del;
      }

      const updatedStudentIds = [...new Set(upserts.map((u) => u.student_id))];
      if (updatedStudentIds.length > 0) {
        supabase.functions
          .invoke('send-grade-notification', {
            body: {
              student_ids: updatedStudentIds,
              subject_name: selected.subjectName,
              subject_code: selected.subjectCode,
              notification_type: 'exam_score',
            },
          })
          .catch(() => {});
      }

      Alert.alert('Saved', 'Exam scores saved successfully.');
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to save exam scores.');
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

          <View style={styles.periodRow}>
            {PERIODS.map((p) => (
              <TouchableOpacity
                key={p.key}
                onPress={() => changePeriod(p.key)}
                style={[styles.periodChip, period === p.key && styles.periodChipActive]}
              >
                <Text
                  style={[
                    styles.periodChipText,
                    period === p.key && styles.periodChipTextActive,
                  ]}
                >
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.itemsBar}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemsLabel}>Total Items</Text>
              <TextInput
                value={totalItems}
                onChangeText={updateTotalItems}
                placeholder="e.g. 50"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                style={styles.itemsInput}
                maxLength={3}
                returnKeyType="done"
              />
            </View>
            {mps !== null ? (
              <View
                style={[
                  styles.mpsBadge,
                  { backgroundColor: mps >= 75 ? '#dcfce7' : '#fee2e2' },
                ]}
              >
                <Text
                  style={[
                    styles.mpsText,
                    { color: mps >= 75 ? '#166534' : '#991b1b' },
                  ]}
                >
                  MPS {mps.toFixed(1)}%
                </Text>
              </View>
            ) : null}
          </View>

          {loadingScores ? (
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
                const entry = scores.find((s) => s.student_id === student.id);
                if (!entry) return null;
                let pctText = '—';
                let pctColor = colors.textMuted;
                if (entry.score !== '' && totalItems && Number(totalItems) > 0) {
                  const n = (Number(entry.score) / Number(totalItems)) * 100;
                  pctText = `${n.toFixed(1)}%`;
                  pctColor = n >= 75 ? colors.success : colors.danger;
                }
                return (
                  <View key={student.id} style={styles.studentRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.studentName} numberOfLines={1}>
                        {idx + 1}. {student.last_name}, {student.first_name}
                        {student.middle_name ? ` ${student.middle_name.charAt(0)}.` : ''}
                      </Text>
                      <Text style={styles.studentLrn}>
                        LRN {student.lrn} ·{' '}
                        <Text style={{ color: pctColor, fontWeight: '700' }}>{pctText}</Text>
                      </Text>
                    </View>
                    <TextInput
                      value={entry.score}
                      onChangeText={(v) => updateScore(student.id, v)}
                      keyboardType="number-pad"
                      placeholder="—"
                      placeholderTextColor={colors.textMuted}
                      style={styles.scoreInput}
                      maxLength={3}
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
                  <Text style={styles.saveBtnText}>Save Scores</Text>
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
            <Text style={styles.headerTitle}>Exam Scores</Text>
            {yearName ? (
              <View style={styles.yearPill}>
                <Text style={styles.yearPillText}>SY {yearName}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.headerSubtitle}>Tap a class to enter periodical test scores</Text>
        </View>

        {groupedCards.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="clipboard-outline" size={44} color={colors.textMuted} />
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

  periodRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    gap: 8,
  },
  periodChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  periodChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  periodChipText: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  periodChipTextActive: { color: '#fff' },

  itemsBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 6,
  },
  itemsLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '600', marginBottom: 4 },
  itemsInput: {
    height: 38,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    backgroundColor: colors.surface,
  },
  mpsBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  mpsText: { fontSize: 13, fontWeight: '700' },

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
  scoreInput: {
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
