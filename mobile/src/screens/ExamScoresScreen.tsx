import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDataCache } from '../contexts/DataCacheContext';
import { colors } from '../theme/colors';
import GridBackground from '../components/GridBackground';
import ParentScreenHeader from '../components/ParentScreenHeader';
import type { ExamScore } from '../types';

const SUBJECT_COLORS = ['#0369a1', '#7c3aed', '#0f766e', '#ea580c', '#be185d', '#4d7c0f'];

interface QuarterScore {
  score: number;
  totalItems: number;
  percentage: number | null;
}

interface SubjectExamScores {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  q1: QuarterScore | null;
  q2: QuarterScore | null;
  q3: QuarterScore | null;
  mps: number | null;
}

function buildSubjectExamScores(scores: ExamScore[]): SubjectExamScores[] {
  const map = new Map<string, SubjectExamScores>();

  for (const score of scores) {
    if (!map.has(score.subject_id)) {
      map.set(score.subject_id, {
        subjectId: score.subject_id,
        subjectName: score.subject?.name ?? 'Unknown subject',
        subjectCode: score.subject?.code ?? '',
        q1: null,
        q2: null,
        q3: null,
        mps: null,
      });
    }

    const subject = map.get(score.subject_id)!;
    const result: QuarterScore = {
      score: score.score,
      totalItems: score.total_items,
      percentage: score.total_items > 0 ? (score.score / score.total_items) * 100 : null,
    };
    if (score.exam_period === '1st_quarter') subject.q1 = result;
    if (score.exam_period === '2nd_quarter') subject.q2 = result;
    if (score.exam_period === '3rd_quarter') subject.q3 = result;
  }

  for (const subject of map.values()) {
    const results = [subject.q1, subject.q2, subject.q3].filter((item): item is QuarterScore => item !== null);
    const earned = results.reduce((sum, item) => sum + item.score, 0);
    const possible = results.reduce((sum, item) => sum + item.totalItems, 0);
    subject.mps = possible > 0 ? (earned / possible) * 100 : null;
  }

  return [...map.values()].sort((a, b) => a.subjectName.localeCompare(b.subjectName));
}

function scoreTone(value: number | null) {
  if (value === null) return { color: '#64748b', tint: '#f1f5f9', track: '#e2e8f0', label: 'Pending' };
  if (value >= 75) return { color: '#047857', tint: '#ecfdf5', track: '#a7f3d0', label: 'On track' };
  if (value >= 50) return { color: '#b45309', tint: '#fffbeb', track: '#fde68a', label: 'Developing' };
  return { color: '#b91c1c', tint: '#fef2f2', track: '#fecaca', label: 'Needs support' };
}

export default function ExamScoresScreen() {
  const { examScores: examData, examScoresLoading, refreshExamScores } = useDataCache();
  const [refreshing, setRefreshing] = useState(false);
  const subjects = useMemo(() => buildSubjectExamScores(examData.exam_scores), [examData.exam_scores]);

  const summary = useMemo(() => {
    const results = subjects.flatMap((subject) => [subject.q1, subject.q2, subject.q3])
      .filter((item): item is QuarterScore => item !== null);
    const earned = results.reduce((sum, item) => sum + item.score, 0);
    const possible = results.reduce((sum, item) => sum + item.totalItems, 0);
    return {
      mps: possible > 0 ? (earned / possible) * 100 : null,
      assessments: results.length,
      earned,
      possible,
    };
  }, [subjects]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshExamScores();
    } finally {
      setRefreshing(false);
    }
  }, [refreshExamScores]);

  const renderSubject = ({ item, index }: { item: SubjectExamScores; index: number }) => {
    const accent = SUBJECT_COLORS[index % SUBJECT_COLORS.length];
    const overallTone = scoreTone(item.mps);
    const quarters = [
      { label: '1st Quarter', data: item.q1 },
      { label: '2nd Quarter', data: item.q2 },
      { label: '3rd Quarter', data: item.q3 },
    ];
    const recorded = quarters.filter((quarter) => quarter.data !== null).length;

    return (
      <View style={styles.subjectCard}>
        <View style={styles.subjectHeader}>
          <View style={[styles.subjectIcon, { backgroundColor: `${accent}14` }]}>
            <Text style={[styles.subjectInitial, { color: accent }]}>{item.subjectName.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.subjectCopy}>
            <Text style={styles.subjectName} numberOfLines={1}>{item.subjectName}</Text>
            <Text style={styles.subjectMeta} numberOfLines={1}>
              {item.subjectCode ? `${item.subjectCode} · ` : ''}{recorded} of 3 exams recorded
            </Text>
          </View>
          <View style={[styles.averagePill, { backgroundColor: overallTone.tint }]}>
            <Text style={[styles.averageValue, { color: overallTone.color }]}>
              {item.mps === null ? '—' : `${item.mps.toFixed(0)}%`}
            </Text>
            <Text style={[styles.averageLabel, { color: overallTone.color }]}>MPS</Text>
          </View>
        </View>

        <View style={styles.overallTrack}>
          <View
            style={[
              styles.overallFill,
              {
                width: `${Math.min(Math.max(item.mps ?? 0, 0), 100)}%`,
                backgroundColor: overallTone.color,
              },
            ]}
          />
        </View>

        <View style={styles.quarterRow}>
          {quarters.map((quarter, quarterIndex) => {
            const tone = scoreTone(quarter.data?.percentage ?? null);
            return (
              <View key={quarter.label} style={[styles.quarterCell, quarterIndex < 2 && styles.quarterDivider]}>
                <Text style={styles.quarterLabel}>{quarter.label}</Text>
                {quarter.data ? (
                  <>
                    <Text style={[styles.quarterPercent, { color: tone.color }]}>
                      {quarter.data.percentage === null ? '—' : `${quarter.data.percentage.toFixed(0)}%`}
                    </Text>
                    <Text style={styles.quarterScore}>{quarter.data.score} / {quarter.data.totalItems}</Text>
                    <Text style={[styles.quarterStatus, { color: tone.color }]} numberOfLines={1}>{tone.label}</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.pendingDash}>—</Text>
                    <Text style={styles.pendingLabel}>Pending</Text>
                  </>
                )}
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  if (examScoresLoading) {
    return (
      <GridBackground>
        <View style={styles.root}>
          <ParentScreenHeader eyebrow="ASSESSMENT RECORD" title="Exam Scores" description="Periodical test results for" />
          <View style={styles.centerState}>
            <View style={styles.stateIcon}><ActivityIndicator size="large" color={colors.secondary} /></View>
            <Text style={styles.stateTitle}>Loading exam scores</Text>
            <Text style={styles.stateCopy}>Getting the latest assessment results from school.</Text>
          </View>
        </View>
      </GridBackground>
    );
  }

  const summaryTone = scoreTone(summary.mps);

  return (
    <GridBackground>
      <View style={styles.root}>
        <ParentScreenHeader eyebrow="ASSESSMENT RECORD" title="Exam Scores" description="Periodical test results for" />
        <FlatList
          data={subjects}
          keyExtractor={(item) => item.subjectId}
          renderItem={renderSubject}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.listContent, subjects.length === 0 && styles.emptyListContent]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.secondary} />}
          ListHeaderComponent={subjects.length ? (
            <>
              <View style={styles.summaryCard}>
                <View style={styles.scorePanel}>
                  <View style={[styles.scoreRing, { borderColor: summaryTone.color }]}>
                    <Text style={[styles.summaryValue, { color: summaryTone.color }]}>
                      {summary.mps === null ? '—' : `${summary.mps.toFixed(0)}%`}
                    </Text>
                    <Text style={styles.scoreRingLabel}>OVERALL MPS</Text>
                  </View>
                </View>
                <View style={styles.summaryDetails}>
                  <Text style={styles.summaryEyebrow}>ASSESSMENT SUMMARY</Text>
                  <Text style={styles.summaryTitle}>Exam performance</Text>
                  <View style={[styles.summaryStatus, { backgroundColor: summaryTone.tint }]}>
                    <Ionicons name="pulse" size={12} color={summaryTone.color} />
                    <Text style={[styles.summaryStatusText, { color: summaryTone.color }]}>{summaryTone.label}</Text>
                  </View>
                  <Text style={styles.summaryNote}>Across all recorded periodical exams</Text>
                </View>
                <View style={styles.summaryStats}>
                  <View style={styles.summaryStat}>
                    <Text style={styles.summaryStatValue}>{subjects.length}</Text>
                    <Text style={styles.summaryStatLabel}>Subjects</Text>
                  </View>
                  <View style={styles.summaryStatDivider} />
                  <View style={styles.summaryStat}>
                    <Text style={styles.summaryStatValue}>{summary.assessments}</Text>
                    <Text style={styles.summaryStatLabel}>Exams posted</Text>
                  </View>
                  <View style={styles.summaryStatDivider} />
                  <View style={styles.summaryStat}>
                    <Text style={styles.summaryStatValue}>{summary.earned}/{summary.possible}</Text>
                    <Text style={styles.summaryStatLabel}>Combined score</Text>
                  </View>
                </View>
              </View>

              <View style={styles.sectionRow}>
                <View>
                  <Text style={styles.sectionEyebrow}>RESULTS BY SUBJECT</Text>
                  <Text style={styles.sectionTitle}>Periodical exams</Text>
                </View>
                <View style={styles.legend}>
                  <View style={styles.legendDot} />
                  <Text style={styles.legendText}>75% target</Text>
                </View>
              </View>
            </>
          ) : null}
          ListEmptyComponent={(
            <View style={styles.centerState}>
              <View style={styles.stateIcon}><Ionicons name="clipboard-outline" size={34} color={colors.secondary} /></View>
              <Text style={styles.stateTitle}>No exam scores yet</Text>
              <Text style={styles.stateCopy}>Periodical test results will appear here as soon as teachers record them.</Text>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={styles.cardGap} />}
          removeClippedSubviews
          maxToRenderPerBatch={8}
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
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', padding: 16,
    borderRadius: 22, borderWidth: 1, borderColor: '#dbeafe', backgroundColor: '#ffffff',
    shadowColor: '#0f172a', shadowOpacity: 0.06, shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 }, elevation: 3,
  },
  scorePanel: { width: 116, alignItems: 'center' },
  scoreRing: {
    width: 100, height: 100, borderRadius: 50, borderWidth: 8,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc',
  },
  summaryValue: { fontSize: 27, lineHeight: 31, fontWeight: '900', letterSpacing: -1 },
  scoreRingLabel: { marginTop: 1, fontSize: 7, fontWeight: '900', color: colors.textMuted, letterSpacing: 0.7 },
  summaryDetails: { flex: 1, paddingLeft: 10 },
  summaryEyebrow: { fontSize: 8, fontWeight: '900', letterSpacing: 1.1, color: colors.secondary },
  summaryTitle: { marginTop: 3, fontSize: 18, fontWeight: '900', color: colors.text, letterSpacing: -0.4 },
  summaryStatus: { alignSelf: 'flex-start', marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  summaryStatusText: { fontSize: 9, fontWeight: '900' },
  summaryNote: { marginTop: 7, fontSize: 9, lineHeight: 13, color: colors.textMuted },
  summaryStats: { width: '100%', marginTop: 16, paddingTop: 13, flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  summaryStat: { flex: 1, alignItems: 'center' },
  summaryStatValue: { fontSize: 15, fontWeight: '900', color: colors.text },
  summaryStatLabel: { marginTop: 2, fontSize: 8, fontWeight: '700', color: colors.textMuted },
  summaryStatDivider: { width: 1, height: 28, backgroundColor: '#e2e8f0' },
  sectionRow: { marginTop: 20, marginBottom: 10, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  sectionEyebrow: { fontSize: 9, fontWeight: '900', color: colors.secondary, letterSpacing: 1.1 },
  sectionTitle: { marginTop: 2, fontSize: 18, fontWeight: '900', color: colors.text, letterSpacing: -0.3 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingBottom: 2 },
  legendDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  legendText: { fontSize: 9, fontWeight: '800', color: colors.textMuted },
  subjectCard: { padding: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: '#ffffff', shadowColor: '#0f172a', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  cardGap: { height: 10 },
  subjectHeader: { flexDirection: 'row', alignItems: 'center' },
  subjectIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  subjectInitial: { fontSize: 18, fontWeight: '900' },
  subjectCopy: { flex: 1, paddingRight: 8 },
  subjectName: { fontSize: 15, fontWeight: '900', color: colors.text, letterSpacing: -0.2 },
  subjectMeta: { marginTop: 2, fontSize: 10, color: colors.textMuted },
  averagePill: { minWidth: 55, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 12, alignItems: 'center' },
  averageValue: { fontSize: 15, lineHeight: 17, fontWeight: '900' },
  averageLabel: { fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  overallTrack: { height: 4, marginTop: 13, borderRadius: 2, overflow: 'hidden', backgroundColor: '#e2e8f0' },
  overallFill: { height: '100%', borderRadius: 2 },
  quarterRow: { marginTop: 13, flexDirection: 'row' },
  quarterCell: { flex: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: 4 },
  quarterDivider: { borderRightWidth: 1, borderRightColor: '#e2e8f0' },
  quarterLabel: { fontSize: 8, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase' },
  quarterPercent: { marginTop: 3, fontSize: 21, lineHeight: 25, fontWeight: '900' },
  quarterScore: { marginTop: 1, fontSize: 11, lineHeight: 14, fontWeight: '700', color: colors.textMuted },
  quarterStatus: { marginTop: 2, fontSize: 8, fontWeight: '700' },
  pendingDash: { marginTop: 3, fontSize: 21, lineHeight: 25, fontWeight: '900', color: '#94a3b8' },
  pendingLabel: { marginTop: 1, fontSize: 10, fontWeight: '700', color: '#94a3b8' },
  centerState: { flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 38 },
  stateIcon: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#dbeafe' },
  stateTitle: { marginTop: 16, fontSize: 18, fontWeight: '900', color: colors.text },
  stateCopy: { marginTop: 6, fontSize: 12, lineHeight: 18, color: colors.textMuted, textAlign: 'center' },
});
