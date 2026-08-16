import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../contexts/AuthContext';
import { useDataCache } from '../contexts/DataCacheContext';
import GridBackground from '../components/GridBackground';
import { colors } from '../theme/colors';
import { assessmentLabel, assessmentTone, domainMeta, languageLabel, periodLabel } from '../lib/learnerAssessments';
import type { AssessmentDomain, AssessmentPeriod, LearnerAssessment } from '../types';

const descriptions: Record<AssessmentDomain, string> = {
  literacy: 'Official reading assessment results recorded by the school using CRLA or Phil-IRI.',
  numeracy: 'Official Rapid Mathematics Assessment results recorded by the school.',
  nutrition: 'School-recorded nutritional classifications from the approved DepEd/LIS assessment tool.',
};
const domains: AssessmentDomain[] = ['literacy', 'numeracy', 'nutrition'];

export default function LearnerAssessmentDetailsScreen({ navigation, route }: any) {
  const requestedDomain = route.params?.domain as AssessmentDomain | undefined;
  const domain: AssessmentDomain = requestedDomain && domainMeta[requestedDomain] ? requestedDomain : 'literacy';
  const meta = domainMeta[domain];
  const requestedPeriod = route.params?.period as AssessmentPeriod | undefined;
  const { session } = useAuth();
  const { assessments, assessmentsLoading, refreshAssessments } = useDataCache();
  const [period, setPeriod] = useState<AssessmentPeriod>(requestedPeriod === 'eosy' ? 'eosy' : 'bosy');
  const [refreshing, setRefreshing] = useState(false);

  const domainRecords = useMemo(() => assessments.assessments.filter((record) => record.domain === domain), [assessments.assessments, domain]);
  const records = useMemo(() => domainRecords.filter((record) => record.assessment_period === period), [domainRecords, period]);

  const periodCounts = useMemo(() => ({
    bosy: domainRecords.filter((record) => record.assessment_period === 'bosy').length,
    eosy: domainRecords.filter((record) => record.assessment_period === 'eosy').length,
  }), [domainRecords]);

  useEffect(() => {
    setPeriod(requestedPeriod === 'eosy' ? 'eosy' : 'bosy');
  }, [domain, requestedPeriod]);

  function selectDomain(nextDomain: AssessmentDomain) {
    const latest = assessments.assessments
      .filter((record) => record.domain === nextDomain)
      .sort((a, b) => new Date(b.assessment_date).getTime() - new Date(a.assessment_date).getTime())[0];
    navigation.setParams({ domain: nextDomain, period: latest?.assessment_period ?? period });
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await refreshAssessments(); } finally { setRefreshing(false); }
  }, [refreshAssessments]);

  return <GridBackground>
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back"><Ionicons name="arrow-back" size={21} color={colors.text} /></TouchableOpacity>
        <View style={styles.headerCopy}><Text style={styles.headerEyebrow}>{meta.eyebrow}</Text><Text style={styles.headerTitle}>{meta.title}</Text></View>
        <View style={styles.privatePill}><Ionicons name="shield-checkmark" size={12} color={colors.primary} /><Text style={styles.privateText}>PRIVATE</Text></View>
      </View>

      {assessmentsLoading ? <View style={styles.loadingState}><ActivityIndicator size="large" color={meta.accent} /><Text style={styles.loadingTitle}>Loading school record</Text><Text style={styles.loadingCopy}>Getting the latest official assessment for {session?.student.first_name ?? 'your learner'}.</Text></View> :
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={meta.accent} />}>
        <LinearGradient colors={[meta.tint, '#ffffff']} style={[styles.hero, { borderColor: `${meta.accent}28` }]}>
          <View style={[styles.heroIcon, { backgroundColor: `${meta.accent}14` }]}><Ionicons name={meta.icon as any} size={28} color={meta.accent} /></View>
          <View style={styles.heroCopy}><Text style={styles.heroEyebrow}>CURRENT SCHOOL YEAR</Text><Text style={styles.heroYear}>{assessments.academic_year?.name ?? 'No active school year'}</Text><Text style={styles.heroDescription}>{descriptions[domain]}</Text></View>
        </LinearGradient>

        <View style={styles.domainSwitch}>{domains.map((value) => {
          const option = domainMeta[value];
          const active = value === domain;
          return <TouchableOpacity key={value} onPress={() => selectDomain(value)} style={[styles.domainButton, active && { backgroundColor: option.tint, borderColor: `${option.accent}45` }]} accessibilityRole="button"><Ionicons name={option.icon as any} size={16} color={active ? option.accent : colors.textMuted} /><Text style={[styles.domainButtonText, active && { color: option.accent }]}>{value === 'nutrition' ? 'Nutrition' : option.title}</Text></TouchableOpacity>;
        })}</View>

        <View style={styles.periodSwitch}>{(['bosy', 'eosy'] as AssessmentPeriod[]).map((value) => <TouchableOpacity key={value} onPress={() => setPeriod(value)} style={[styles.periodButton, period === value && { backgroundColor: meta.accent }]} accessibilityRole="tab" accessibilityState={{ selected: period === value }}><Text style={[styles.periodButtonText, period === value && styles.periodButtonTextActive]}>{value === 'bosy' ? 'BoSY' : 'EoSY'}</Text><View style={[styles.periodCount, period === value && styles.periodCountActive]}><Text style={[styles.periodCountText, period === value && { color: meta.accent }]}>{periodCounts[value]}</Text></View></TouchableOpacity>)}</View>
        <Text style={styles.periodDescription}>{periodLabel(period)}</Text>

        <View style={styles.resultsHeading}><View><Text style={[styles.resultsEyebrow, { color: meta.accent }]}>OFFICIAL RESULTS</Text><Text style={styles.resultsTitle}>{period === 'bosy' ? 'Starting point' : 'Year-end progress'}</Text></View><Text style={styles.resultsCount}>{records.length} {records.length === 1 ? 'record' : 'records'}</Text></View>

        {records.length ? <View style={styles.results}>
          {records.map((record) => <ResultCard key={record.id} record={record} />)}
        </View> : <View style={styles.emptyCard}><View style={[styles.emptyIcon, { backgroundColor: meta.tint }]}><Ionicons name={meta.icon as any} size={32} color={meta.accent} /></View><Text style={styles.emptyTitle}>No {period === 'bosy' ? 'BoSY' : 'EoSY'} result yet</Text><Text style={styles.emptyCopy}>The result will appear here after an assigned teacher records the official assessment.</Text></View>}

        <View style={styles.infoCard}><Ionicons name="information-circle-outline" size={20} color={colors.secondary} /><View style={styles.infoCopy}><Text style={styles.infoTitle}>About this record</Text><Text style={styles.infoText}>{domain === 'nutrition' ? 'For privacy, the family app shows nutritional classifications but not measurements, z-scores, birth date, or assessor details. Contact the school health personnel for interpretation.' : 'This is the classification copied from the official DepEd scoresheet. It is separate from quarterly grades and exam scores.'}</Text></View></View>
      </ScrollView>}
    </SafeAreaView>
  </GridBackground>;
}

function ResultCard({ record }: { record: LearnerAssessment }) {
  const meta = domainMeta[record.domain];
  const tone = assessmentTone(record);
  const percentage = record.domain === 'numeracy' && record.raw_score !== null && record.total_items
    ? Math.round((Number(record.raw_score) / Number(record.total_items)) * 100) : null;
  const date = new Date(`${record.assessment_date}T00:00:00`).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
  const language = languageLabel(record.language);

  return <View style={styles.resultCard}>
    <View style={styles.resultTop}><View><Text style={[styles.instrument, { color: meta.accent }]}>{record.instrument.replace('_', ' ')}</Text><Text style={styles.resultMeta}>{language ? `${language} · ` : ''}{date}</Text></View><View style={[styles.recordedPill, { backgroundColor: tone.tint }]}><Ionicons name="checkmark-circle" size={13} color={tone.color} /><Text style={[styles.recordedText, { color: tone.color }]}>RECORDED</Text></View></View>
    <View style={[styles.primaryResult, { backgroundColor: tone.tint }]}><Text style={styles.resultLabel}>{record.domain === 'nutrition' ? 'BMI-FOR-AGE STATUS' : 'OFFICIAL CLASSIFICATION'}</Text><Text style={[styles.resultValue, { color: tone.color }]}>{assessmentLabel(record.classification)}</Text>{percentage !== null && <Text style={styles.scoreText}>{record.raw_score} of {record.total_items} items · {percentage}%</Text>}</View>
    {record.domain === 'nutrition' && <View style={styles.secondaryResult}><Text style={styles.secondaryLabel}>HEIGHT-FOR-AGE STATUS</Text><Text style={styles.secondaryValue}>{assessmentLabel(record.secondary_classification)}</Text></View>}
    <View style={styles.toolRow}><Ionicons name="document-text-outline" size={16} color={colors.textMuted} /><View style={styles.toolCopy}><Text style={styles.toolLabel}>Official tool / scoresheet</Text><Text style={styles.toolValue}>{record.instrument_version}</Text></View></View>
    <View style={styles.noteCard}><View style={styles.noteHeading}><Ionicons name="chatbox-ellipses-outline" size={15} color={meta.accent} /><Text style={[styles.noteLabel, { color: meta.accent }]}>TEACHER'S NOTE</Text></View><Text style={[styles.noteText, !record.notes?.trim() && styles.noteEmpty]}>{record.notes?.trim() || 'No note was added for this result.'}</Text></View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { minHeight: 68, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: 'rgba(255,255,255,0.98)' },
  backButton: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  headerCopy: { flex: 1, marginLeft: 11 },
  headerEyebrow: { fontSize: 8, fontWeight: '900', letterSpacing: 1.1, color: colors.primary },
  headerTitle: { marginTop: 1, fontSize: 20, fontWeight: '900', color: colors.text, letterSpacing: -0.4 },
  privatePill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, backgroundColor: '#ecfdf5', paddingHorizontal: 8, paddingVertical: 6 },
  privateText: { fontSize: 7, fontWeight: '900', color: colors.primary, letterSpacing: 0.5 },
  content: { padding: 14, paddingBottom: 38 },
  hero: { flexDirection: 'row', alignItems: 'center', borderRadius: 22, borderWidth: 1, padding: 16 },
  heroIcon: { width: 58, height: 58, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginRight: 13 },
  heroCopy: { flex: 1 },
  heroEyebrow: { fontSize: 8, fontWeight: '900', letterSpacing: 1, color: colors.textMuted },
  heroYear: { marginTop: 2, fontSize: 18, fontWeight: '900', color: colors.text },
  heroDescription: { marginTop: 5, fontSize: 10, lineHeight: 15, color: colors.textMuted },
  domainSwitch: { marginTop: 13, flexDirection: 'row', gap: 7 },
  domainButton: { flex: 1, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', paddingHorizontal: 6 },
  domainButtonText: { fontSize: 9, fontWeight: '900', color: colors.textMuted },
  periodSwitch: { marginTop: 15, padding: 4, flexDirection: 'row', borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  periodButton: { flex: 1, minHeight: 39, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 10, paddingVertical: 8 },
  periodButtonText: { fontSize: 11, fontWeight: '900', color: colors.textMuted },
  periodButtonTextActive: { color: '#fff' },
  periodCount: { minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9' },
  periodCountActive: { backgroundColor: '#fff' },
  periodCountText: { fontSize: 8, fontWeight: '900', color: colors.textMuted },
  periodDescription: { marginTop: 7, textAlign: 'center', fontSize: 9, fontWeight: '700', color: colors.textMuted },
  resultsHeading: { marginTop: 17, marginBottom: 9, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  resultsEyebrow: { fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  resultsTitle: { marginTop: 2, fontSize: 18, fontWeight: '900', color: colors.text, letterSpacing: -0.3 },
  resultsCount: { marginBottom: 2, fontSize: 9, fontWeight: '800', color: colors.textMuted },
  results: { gap: 11 },
  resultCard: { borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', padding: 14, shadowColor: '#0f172a', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  resultTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  instrument: { fontSize: 13, fontWeight: '900' },
  resultMeta: { marginTop: 2, fontSize: 9, color: colors.textMuted },
  recordedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  recordedText: { fontSize: 7, fontWeight: '900', letterSpacing: 0.5 },
  primaryResult: { marginTop: 13, borderRadius: 15, padding: 13 },
  resultLabel: { fontSize: 7, fontWeight: '900', color: colors.textMuted, letterSpacing: 0.8 },
  resultValue: { marginTop: 4, fontSize: 20, lineHeight: 24, fontWeight: '900', letterSpacing: -0.4 },
  scoreText: { marginTop: 3, fontSize: 10, fontWeight: '700', color: colors.textMuted },
  secondaryResult: { marginTop: 9, borderRadius: 13, borderWidth: 1, borderColor: colors.border, padding: 11 },
  secondaryLabel: { fontSize: 7, fontWeight: '900', color: colors.textMuted, letterSpacing: 0.7 },
  secondaryValue: { marginTop: 3, fontSize: 15, fontWeight: '900', color: colors.text },
  toolRow: { marginTop: 13, paddingTop: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  toolCopy: { flex: 1 },
  toolLabel: { fontSize: 8, fontWeight: '800', color: colors.textMuted },
  toolValue: { marginTop: 2, fontSize: 10, lineHeight: 14, color: colors.text },
  noteCard: { marginTop: 11, borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc', padding: 12 },
  noteHeading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noteLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  noteText: { marginTop: 7, fontSize: 11, lineHeight: 17, color: colors.text },
  noteEmpty: { color: colors.textMuted, fontStyle: 'italic' },
  emptyCard: { minHeight: 245, alignItems: 'center', justifyContent: 'center', borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', paddingHorizontal: 30 },
  emptyIcon: { width: 68, height: 68, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { marginTop: 15, fontSize: 17, fontWeight: '900', color: colors.text },
  emptyCopy: { marginTop: 6, fontSize: 11, lineHeight: 17, textAlign: 'center', color: colors.textMuted },
  infoCard: { marginTop: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 16, borderWidth: 1, borderColor: '#dbeafe', backgroundColor: '#eff6ff', padding: 13 },
  infoCopy: { flex: 1 },
  infoTitle: { fontSize: 11, fontWeight: '900', color: '#075985' },
  infoText: { marginTop: 3, fontSize: 9, lineHeight: 14, color: '#475569' },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  loadingTitle: { marginTop: 14, fontSize: 17, fontWeight: '900', color: colors.text },
  loadingCopy: { marginTop: 5, fontSize: 11, lineHeight: 17, textAlign: 'center', color: colors.textMuted },
});
