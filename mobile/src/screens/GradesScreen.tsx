import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useDataCache } from '../contexts/DataCacheContext';
import { colors } from '../theme/colors';
import GridBackground from '../components/GridBackground';
import ParentScreenHeader from '../components/ParentScreenHeader';
import type { Grade } from '../types';

const SUBJECT_COLORS = ['#0f766e', '#0369a1', '#7c3aed', '#ea580c', '#be185d', '#4d7c0f'];

interface SubjectGrades {
  subject_id: string;
  subject_name: string;
  subject_code: string;
  q1: number | null;
  q2: number | null;
  q3: number | null;
  average: number | null;
}

function buildSubjectGrades(grades: Grade[]): SubjectGrades[] {
  const map = new Map<string, SubjectGrades>();

  for (const grade of grades) {
    if (!map.has(grade.subject_id)) {
      map.set(grade.subject_id, {
        subject_id: grade.subject_id,
        subject_name: grade.subject?.name ?? 'Unknown subject',
        subject_code: grade.subject?.code ?? '',
        q1: null,
        q2: null,
        q3: null,
        average: null,
      });
    }

    const subject = map.get(grade.subject_id)!;
    if (grade.quarter === 1) subject.q1 = grade.grade;
    if (grade.quarter === 2) subject.q2 = grade.grade;
    if (grade.quarter === 3) subject.q3 = grade.grade;
  }

  for (const subject of map.values()) {
    const recorded = [subject.q1, subject.q2, subject.q3]
      .filter((value): value is number => value !== null);
    subject.average = recorded.length
      ? recorded.reduce((sum, value) => sum + value, 0) / recorded.length
      : null;
  }

  return [...map.values()].sort((a, b) => a.subject_name.localeCompare(b.subject_name));
}

function gradeTone(value: number | null) {
  if (value === null) return { color: '#64748b', tint: '#f1f5f9', label: 'Pending' };
  if (value >= 90) return { color: '#047857', tint: '#ecfdf5', label: 'Excellent' };
  if (value >= 85) return { color: '#0f766e', tint: '#f0fdfa', label: 'Very good' };
  if (value >= 80) return { color: '#0369a1', tint: '#eff6ff', label: 'Good' };
  if (value >= 75) return { color: '#b45309', tint: '#fffbeb', label: 'Passed' };
  return { color: '#b91c1c', tint: '#fef2f2', label: 'Needs support' };
}

export default function GradesScreen() {
  const { grades: gradesData, gradesLoading, refreshGrades } = useDataCache();
  const [refreshing, setRefreshing] = useState(false);
  const subjects = useMemo(() => buildSubjectGrades(gradesData.grades), [gradesData.grades]);

  const summary = useMemo(() => {
    const averages = subjects.map((subject) => subject.average).filter((value): value is number => value !== null);
    const recordedQuarters = subjects.reduce(
      (count, subject) => count + [subject.q1, subject.q2, subject.q3].filter((value) => value !== null).length,
      0,
    );
    return {
      average: averages.length ? averages.reduce((sum, value) => sum + value, 0) / averages.length : null,
      recordedSubjects: averages.length,
      recordedQuarters,
    };
  }, [subjects]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshGrades();
    } finally {
      setRefreshing(false);
    }
  }, [refreshGrades]);

  const renderSubject = ({ item, index }: { item: SubjectGrades; index: number }) => {
    const accent = SUBJECT_COLORS[index % SUBJECT_COLORS.length];
    const tone = gradeTone(item.average);
    const recorded = [item.q1, item.q2, item.q3].filter((value) => value !== null).length;

    return (
      <View style={styles.subjectCard}>
        <View style={styles.subjectHeader}>
          <View style={[styles.subjectIcon, { backgroundColor: `${accent}14` }]}>
            <Text style={[styles.subjectInitial, { color: accent }]}>{item.subject_name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.subjectCopy}>
            <Text style={styles.subjectName} numberOfLines={1}>{item.subject_name}</Text>
            <Text style={styles.subjectMeta} numberOfLines={1}>
              {item.subject_code ? `${item.subject_code} · ` : ''}{recorded} of 3 quarters recorded
            </Text>
          </View>
          <View style={[styles.averagePill, { backgroundColor: tone.tint }]}>
            <Text style={[styles.averagePillValue, { color: tone.color }]}>
              {item.average === null ? '—' : item.average.toFixed(1)}
            </Text>
            <Text style={[styles.averagePillLabel, { color: tone.color }]}>AVG</Text>
          </View>
        </View>

        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.min(Math.max(item.average ?? 0, 0), 100)}%`, backgroundColor: tone.color },
            ]}
          />
        </View>

        <View style={styles.quarterRow}>
          {[
            { label: '1st Quarter', value: item.q1 },
            { label: '2nd Quarter', value: item.q2 },
            { label: '3rd Quarter', value: item.q3 },
          ].map((quarter, quarterIndex) => {
            const quarterTone = gradeTone(quarter.value);
            return (
              <View
                key={quarter.label}
                style={[styles.quarterCell, quarterIndex < 2 && styles.quarterDivider]}
              >
                <Text style={styles.quarterLabel}>{quarter.label}</Text>
                <Text style={[styles.quarterValue, { color: quarterTone.color }]}>
                  {quarter.value === null ? '—' : quarter.value.toFixed(0)}
                </Text>
                <Text style={[styles.quarterStatus, { color: quarterTone.color }]} numberOfLines={1}>
                  {quarter.value === null ? 'Pending' : quarterTone.label}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  if (gradesLoading) {
    return (
      <GridBackground>
        <View style={styles.root}>
          <ParentScreenHeader eyebrow="ACADEMIC RECORD" title="Grades" description="Quarterly performance for" />
          <View style={styles.centerState}>
            <View style={styles.stateIcon}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
            <Text style={styles.stateTitle}>Loading grades</Text>
            <Text style={styles.stateCopy}>Getting the latest academic record from school.</Text>
          </View>
        </View>
      </GridBackground>
    );
  }

  const overallTone = gradeTone(summary.average);

  return (
    <GridBackground>
      <View style={styles.root}>
        <ParentScreenHeader eyebrow="ACADEMIC RECORD" title="Grades" description="Quarterly performance for" />
        <FlatList
          data={subjects}
          keyExtractor={(item) => item.subject_id}
          renderItem={renderSubject}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.listContent, subjects.length === 0 && styles.emptyListContent]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={subjects.length ? (
            <>
              <LinearGradient
                colors={['#0f766e', '#0d9488', '#0891b2']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.summaryCard}
              >
                <View pointerEvents="none" style={styles.summaryOrb} />
                <View style={styles.summaryTopRow}>
                  <View>
                    <Text style={styles.summaryEyebrow}>CURRENT PERFORMANCE</Text>
                    <Text style={styles.summaryLabel}>General average</Text>
                  </View>
                  <View style={styles.summaryIcon}>
                    <Ionicons name="school" size={22} color="#ffffff" />
                  </View>
                </View>
                <View style={styles.summaryMainRow}>
                  <Text style={styles.summaryValue}>
                    {summary.average === null ? '—' : summary.average.toFixed(1)}
                  </Text>
                  <View style={styles.summaryStatus}>
                    <Ionicons name="sparkles" size={12} color="#ffffff" />
                    <Text style={styles.summaryStatusText}>{overallTone.label}</Text>
                  </View>
                </View>
                <Text style={styles.summaryNote}>Calculated from all currently recorded subject grades.</Text>
                <View style={styles.summaryStats}>
                  <View style={styles.summaryStat}>
                    <Text style={styles.summaryStatValue}>{summary.recordedSubjects}</Text>
                    <Text style={styles.summaryStatLabel}>Subjects</Text>
                  </View>
                  <View style={styles.summaryStatDivider} />
                  <View style={styles.summaryStat}>
                    <Text style={styles.summaryStatValue}>{summary.recordedQuarters}</Text>
                    <Text style={styles.summaryStatLabel}>Grades posted</Text>
                  </View>
                  <View style={styles.summaryStatDivider} />
                  <View style={styles.summaryStat}>
                    <Text style={styles.summaryStatValue}>{subjects.length * 3 - summary.recordedQuarters}</Text>
                    <Text style={styles.summaryStatLabel}>Pending</Text>
                  </View>
                </View>
              </LinearGradient>

              <View style={styles.sectionRow}>
                <View>
                  <Text style={styles.sectionEyebrow}>SUBJECT BREAKDOWN</Text>
                  <Text style={styles.sectionTitle}>Quarterly grades</Text>
                </View>
                <View style={styles.livePill}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>School data</Text>
                </View>
              </View>
            </>
          ) : null}
          ListEmptyComponent={(
            <View style={styles.centerState}>
              <View style={styles.stateIcon}>
                <Ionicons name="reader-outline" size={34} color={colors.primary} />
              </View>
              <Text style={styles.stateTitle}>No grades posted yet</Text>
              <Text style={styles.stateCopy}>Quarterly grades will appear here as soon as the school records them.</Text>
              <View style={styles.pullHint}>
                <Ionicons name="arrow-down" size={13} color={colors.primary} />
                <Text style={styles.pullHintText}>Pull down to check again</Text>
              </View>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={styles.cardGap} />}
          removeClippedSubviews
          maxToRenderPerBatch={10}
          windowSize={5}
        />
      </View>
    </GridBackground>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  listContent: { padding: 14, paddingBottom: 100 },
  emptyListContent: { flexGrow: 1 },
  summaryCard: {
    borderRadius: 22,
    padding: 18,
    overflow: 'hidden',
    shadowColor: '#0f766e',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  summaryOrb: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    right: -56,
    top: -70,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  summaryTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryEyebrow: { fontSize: 9, fontWeight: '900', letterSpacing: 1.2, color: '#99f6e4' },
  summaryLabel: { marginTop: 3, fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.82)' },
  summaryIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  summaryMainRow: { marginTop: 3, flexDirection: 'row', alignItems: 'center', gap: 12 },
  summaryValue: { fontSize: 43, lineHeight: 50, fontWeight: '900', color: '#ffffff', letterSpacing: -1.5 },
  summaryStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  summaryStatusText: { fontSize: 10, fontWeight: '800', color: '#ffffff' },
  summaryNote: { fontSize: 10, lineHeight: 15, color: 'rgba(255,255,255,0.72)' },
  summaryStats: {
    marginTop: 15,
    paddingTop: 13,
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.18)',
  },
  summaryStat: { flex: 1, alignItems: 'center' },
  summaryStatValue: { fontSize: 16, fontWeight: '900', color: '#ffffff' },
  summaryStatLabel: { marginTop: 1, fontSize: 8, fontWeight: '700', color: 'rgba(255,255,255,0.68)' },
  summaryStatDivider: { width: 1, height: 27, backgroundColor: 'rgba(255,255,255,0.18)' },
  sectionRow: {
    marginTop: 20,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  sectionEyebrow: { fontSize: 9, fontWeight: '900', color: colors.primary, letterSpacing: 1.1 },
  sectionTitle: { marginTop: 2, fontSize: 18, fontWeight: '900', color: colors.text, letterSpacing: -0.3 },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#d1fae5',
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  liveText: { fontSize: 8, fontWeight: '900', color: '#047857' },
  subjectCard: {
    padding: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardGap: { height: 10 },
  subjectHeader: { flexDirection: 'row', alignItems: 'center' },
  subjectIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  subjectInitial: { fontSize: 18, fontWeight: '900' },
  subjectCopy: { flex: 1, paddingRight: 8 },
  subjectName: { fontSize: 15, fontWeight: '900', color: colors.text, letterSpacing: -0.2 },
  subjectMeta: { marginTop: 2, fontSize: 10, color: colors.textMuted },
  averagePill: { minWidth: 52, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 12, alignItems: 'center' },
  averagePillValue: { fontSize: 15, lineHeight: 17, fontWeight: '900' },
  averagePillLabel: { fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  progressTrack: { height: 4, marginTop: 13, borderRadius: 2, overflow: 'hidden', backgroundColor: '#e2e8f0' },
  progressFill: { height: '100%', borderRadius: 2 },
  quarterRow: { marginTop: 13, flexDirection: 'row' },
  quarterCell: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  quarterDivider: { borderRightWidth: 1, borderRightColor: '#e2e8f0' },
  quarterLabel: { fontSize: 8, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase' },
  quarterValue: { marginTop: 3, fontSize: 19, fontWeight: '900' },
  quarterStatus: { marginTop: 1, fontSize: 8, fontWeight: '700' },
  centerState: { flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 38 },
  stateIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0fdfa',
    borderWidth: 1,
    borderColor: '#ccfbf1',
  },
  stateTitle: { marginTop: 16, fontSize: 18, fontWeight: '900', color: colors.text },
  stateCopy: { marginTop: 6, fontSize: 12, lineHeight: 18, color: colors.textMuted, textAlign: 'center' },
  pullHint: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 5 },
  pullHintText: { fontSize: 10, fontWeight: '800', color: colors.primary },
});
