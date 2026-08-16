import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageSourcePropType,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../contexts/AuthContext';
import { useDataCache } from '../contexts/DataCacheContext';
import { colors } from '../theme/colors';
import GridBackground from '../components/GridBackground';
import ChildSwitcher from '../components/ChildSwitcher';
import SchoolLogo from '../components/SchoolLogo';
import { assessmentLabel, latestForDomain } from '../lib/learnerAssessments';
import type { AssessmentDomain, LearnerAssessment } from '../types';

const literacyIcon = require('../../assets/dashboard-icons/literacy-mobile.png');
const numeracyIcon = require('../../assets/dashboard-icons/numeracy-mobile.png');
const nutritionIcon = require('../../assets/dashboard-icons/nutrition-mobile.png');
const studentGroupGraphic = require('../../assets/dashboard-icons/student-group-light-mobile.png');

interface LearningMetric {
  status: string;
  source: string;
  recorded: boolean;
}

function metricFromAssessment(record: LearnerAssessment | null): LearningMetric {
  if (!record) return { status: 'Not recorded', source: 'Waiting for official school result', recorded: false };
  return {
    status: assessmentLabel(record.classification),
    source: `${record.assessment_period === 'bosy' ? 'BoSY' : 'EoSY'} · ${record.instrument.replace('_', ' ')}`,
    recorded: true,
  };
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatUpdateTime(isoString: string): string {
  const date = new Date(isoString);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function MetricCard({
  title,
  metric,
  imageSource,
  accent,
  onPress,
}: {
  title: string;
  metric: LearningMetric;
  imageSource: ImageSourcePropType;
  accent: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.metricCard} onPress={onPress} activeOpacity={0.76} accessibilityRole="button" accessibilityLabel={`Open ${title} assessment`}>
      <Image source={imageSource} style={styles.metricImage} resizeMode="contain" />
      <View style={styles.metricDetails}>
        <View style={styles.metricTitleRow}>
          <Text style={styles.metricTitle}>{title}</Text>
          <Ionicons name="chevron-forward" size={14} color="#94a3b8" />
        </View>
        <Text style={[styles.metricValue, { color: metric.recorded ? accent : colors.textMuted }]} numberOfLines={2}>{metric.status}</Text>
        <Text style={styles.metricStatus} numberOfLines={1}>{metric.source}</Text>
      </View>
      <View style={[styles.recordIndicator, { backgroundColor: metric.recorded ? accent : '#cbd5e1' }]} />
    </TouchableOpacity>
  );
}

export default function HomeScreen({ navigation }: any) {
  const { session } = useAuth();
  const {
    feed,
    assessments,
    feedLoading,
    assessmentsLoading,
  } = useDataCache();

  const literacyRecord = useMemo(() => latestForDomain(assessments.assessments, 'literacy'), [assessments.assessments]);
  const numeracyRecord = useMemo(() => latestForDomain(assessments.assessments, 'numeracy'), [assessments.assessments]);
  const literacy = useMemo(() => metricFromAssessment(literacyRecord), [literacyRecord]);
  const numeracy = useMemo(() => metricFromAssessment(numeracyRecord), [numeracyRecord]);
  const nutritionRecord = useMemo(() => latestForDomain(assessments.assessments, 'nutrition'), [assessments.assessments]);
  const nutrition = useMemo(() => metricFromAssessment(nutritionRecord), [nutritionRecord]);

  const learnerClass = useMemo(() => {
    const channel = feed.adviserChannel;
    if (!channel) return `LRN ${session?.student.lrn ?? ''}`.trim();
    const gradeValue = String(channel.grade_level ?? '').trim();
    const grade = gradeValue
      ? gradeValue.toLowerCase().startsWith('grade') ? gradeValue : `Grade ${gradeValue}`
      : '';
    return [grade, String(channel.section_name ?? '').trim()].filter(Boolean).join(' · ');
  }, [feed.adviserChannel, session?.student.lrn]);

  const latestSchoolUpdate = useMemo(() => {
    const messageUpdates = feed.messages.map((message) => {
      const isAdviser = message.message_type === 'adviser_announcement';
      return {
        occurredAt: message.created_at,
        title: isAdviser
          ? message.title || 'Adviser announcement'
          : message.schedule?.subject?.name || 'Teacher message',
        preview: message.content,
        icon: (isAdviser ? 'megaphone' : 'chatbubble-ellipses') as keyof typeof Ionicons.glyphMap,
        accent: isAdviser ? '#d97706' : colors.primary,
        tint: isAdviser ? '#fff7ed' : '#ecfdf5',
      };
    });

    const attendanceUpdates = feed.records.map((record) => {
      const status = record.status.charAt(0).toUpperCase() + record.status.slice(1);
      const subject = record.schedule?.subject?.name || 'Class attendance';
      return {
        occurredAt: record.recorded_at,
        title: subject,
        preview: `${session?.student.first_name || 'Your learner'} was marked ${status.toLowerCase()}.`,
        icon: 'checkmark-circle' as keyof typeof Ionicons.glyphMap,
        accent: record.status === 'absent' ? colors.danger : record.status === 'late' ? colors.warning : colors.success,
        tint: record.status === 'absent' ? '#fef2f2' : record.status === 'late' ? '#fffbeb' : '#f0fdf4',
      };
    });

    return [...messageUpdates, ...attendanceUpdates]
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())[0] ?? null;
  }, [feed.messages, feed.records, session?.student.first_name]);

  if (!session) return null;
  const loading = feedLoading || assessmentsLoading;

  return (
    <GridBackground>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.content}>
          <LinearGradient
            colors={['#ffffff', '#f0fdfa', '#e6f7f4']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroCard}
          >
            <View style={styles.topBar}>
              <View style={styles.schoolIdentity}>
                <SchoolLogo logoUrl={session.school.logo_url} schoolName={session.school.name} size={45} />
                <View style={styles.schoolText}>
                  <Text style={styles.appName}>CLASSPULSE FAMILY</Text>
                  <Text style={styles.schoolName} numberOfLines={2}>{session.school.name}</Text>
                </View>
              </View>
              <ChildSwitcher />
            </View>
            <View style={styles.heroDivider} />
            <View pointerEvents="none" style={styles.heroOrbTop} />
            <View pointerEvents="none" style={styles.heroOrbBottom} />
            <View style={styles.heroEyebrowRow}>
              <View style={styles.heroEyebrow}>
                <Ionicons name="sparkles" size={13} color="#d97706" />
                <Text style={styles.heroEyebrowText}>LEARNER OVERVIEW</Text>
              </View>
              {loading && <ActivityIndicator size="small" color={colors.primary} />}
            </View>

            <View style={styles.heroMainRow}>
              <View style={styles.heroCopy}>
                <Text style={styles.greeting} numberOfLines={2}>
                  {greeting()}, {session.parent?.guardian_name.split(' ')[0] || 'Parent'}!
                </Text>
                <Text style={styles.greetingSubtitle} numberOfLines={2}>
                  Every learner seen.{`\n`}Every milestone shared.
                </Text>
              </View>
              <View style={styles.heroVisualFrame}>
                <Image
                  source={studentGroupGraphic}
                  style={styles.heroStudentGraphic}
                  resizeMode="contain"
                  accessible
                  accessibilityLabel="Illustration of three students"
                />
              </View>
            </View>

            <View style={styles.learnerIdentity}>
              <View style={styles.learnerAvatar}>
                <Text style={styles.learnerAvatarText}>{session.student.first_name.charAt(0)}</Text>
              </View>
              <View style={styles.learnerText}>
                <Text style={styles.learnerName} numberOfLines={1}>
                  {session.student.first_name} {session.student.last_name}
                </Text>
                <Text style={styles.learnerClass} numberOfLines={1}>{learnerClass}</Text>
              </View>
              <View style={styles.connectedBadge}>
                <Ionicons name="shield-checkmark" size={11} color="#059669" />
                <Text style={styles.connectedText}>Connected</Text>
              </View>
            </View>

          </LinearGradient>

          <View style={styles.sectionHeadingRow}>
            <View>
              <Text style={styles.sectionEyebrow}>WHAT MATTERS MOST</Text>
              <Text style={styles.sectionTitle}>{session.student.first_name}’s essentials</Text>
            </View>
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>School data</Text>
            </View>
          </View>

          <View style={styles.metricRow}>
            <MetricCard title="Literacy" metric={literacy} imageSource={literacyIcon} accent={colors.primary} onPress={() => navigation.navigate('LearnerAssessmentDetails', { domain: 'literacy' as AssessmentDomain, period: literacyRecord?.assessment_period ?? 'bosy' })} />
            <MetricCard title="Numeracy" metric={numeracy} imageSource={numeracyIcon} accent={colors.secondary} onPress={() => navigation.navigate('LearnerAssessmentDetails', { domain: 'numeracy' as AssessmentDomain, period: numeracyRecord?.assessment_period ?? 'bosy' })} />
          </View>

          <TouchableOpacity style={styles.nutritionCard} onPress={() => navigation.navigate('LearnerAssessmentDetails', { domain: 'nutrition' as AssessmentDomain, period: nutritionRecord?.assessment_period ?? 'bosy' })} activeOpacity={0.76} accessibilityRole="button" accessibilityLabel="Open nutritional status assessment">
            <Image source={nutritionIcon} style={styles.nutritionImage} resizeMode="contain" />
            <View style={styles.nutritionContent}>
              <View style={styles.nutritionTitleRow}>
                <Text style={styles.nutritionTitle}>Nutritional Status</Text>
              </View>
              <Text style={[styles.nutritionValue, nutrition.recorded && { color: '#c2410c' }]}>{nutrition.status}</Text>
              <Text style={styles.nutritionNote}>{nutritionRecord?.secondary_classification ? `Height-for-age: ${assessmentLabel(nutritionRecord.secondary_classification)}` : nutrition.source}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
          </TouchableOpacity>

          <View style={styles.latestSection}>
            <View style={styles.latestHeadingRow}>
              <Text style={styles.latestEyebrow}>LATEST FROM SCHOOL</Text>
              <Text style={styles.latestHint}>Live updates</Text>
            </View>
            <TouchableOpacity
              style={styles.latestCard}
              onPress={() => navigation.navigate('Feed')}
              activeOpacity={0.74}
            >
              <View style={[
                styles.latestIcon,
                { backgroundColor: latestSchoolUpdate?.tint || '#ecfdf5' },
              ]}>
                <Ionicons
                  name={latestSchoolUpdate?.icon || 'checkmark-done-circle'}
                  size={21}
                  color={latestSchoolUpdate?.accent || colors.primary}
                />
              </View>
              <View style={styles.latestCopy}>
                <View style={styles.latestTitleRow}>
                  <Text style={styles.latestTitle} numberOfLines={1}>
                    {latestSchoolUpdate?.title || 'You’re all caught up'}
                  </Text>
                  {latestSchoolUpdate && (
                    <Text style={styles.latestTime}>{formatUpdateTime(latestSchoolUpdate.occurredAt)}</Text>
                  )}
                </View>
                <Text style={styles.latestPreview} numberOfLines={2}>
                  {latestSchoolUpdate?.preview || 'New teacher messages and attendance updates will appear here.'}
                </Text>
              </View>
              <View style={styles.latestArrow}>
                <Ionicons name="arrow-forward" size={16} color={colors.primary} />
              </View>
            </TouchableOpacity>
          </View>

        </View>
      </SafeAreaView>
    </GridBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flex: 1, paddingTop: 4, paddingBottom: 8 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 53,
    paddingBottom: 7,
  },
  schoolIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  schoolText: { flex: 1 },
  appName: { fontSize: 9, fontWeight: '900', color: colors.primary, letterSpacing: 1.15 },
  schoolName: { marginTop: 1, fontSize: 13, lineHeight: 16, fontWeight: '800', color: colors.text },
  heroCard: {
    borderRadius: 0,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 13,
    overflow: 'hidden',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#ccece5',
    shadowColor: '#0f766e',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  heroDivider: { height: 1, backgroundColor: 'rgba(15,118,110,0.10)', marginBottom: 8 },
  heroOrbTop: {
    position: 'absolute',
    top: -75,
    right: -40,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(34,211,238,0.10)',
  },
  heroOrbBottom: {
    position: 'absolute',
    bottom: -90,
    left: -50,
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: 'rgba(45,212,191,0.10)',
  },
  heroMainRow: {
    minHeight: 116,
    marginTop: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heroCopy: { flex: 1 },
  heroVisualFrame: {
    width: 122,
    height: 122,
    marginRight: -5,
    marginBottom: -5,
  },
  heroStudentGraphic: {
    width: '100%',
    height: '100%',
    borderRadius: 0,
  },
  heroEyebrowRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroEyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fed7aa',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  heroEyebrowText: { fontSize: 8, fontWeight: '900', color: '#9a3412', letterSpacing: 1 },
  greeting: { fontSize: 20, lineHeight: 24, fontWeight: '900', color: '#12363d', letterSpacing: -0.4 },
  greetingSubtitle: { marginTop: 4, fontSize: 10, lineHeight: 14, fontWeight: '700', color: '#4b7777' },
  learnerIdentity: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ccece5',
    backgroundColor: 'rgba(255,255,255,0.76)',
    padding: 7,
  },
  learnerAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    marginRight: 10,
  },
  learnerAvatarText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  learnerText: { flex: 1 },
  learnerName: { fontSize: 14, fontWeight: '900', color: colors.text },
  learnerClass: { marginTop: 2, fontSize: 11, color: colors.textMuted },
  connectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 6,
    borderRadius: 999,
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  connectedText: { fontSize: 8, fontWeight: '900', color: '#047857' },
  sectionHeadingRow: {
    marginHorizontal: 14,
    marginTop: 14,
    marginBottom: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionEyebrow: { marginBottom: 3, fontSize: 9, fontWeight: '900', color: colors.primary, letterSpacing: 1.25 },
  sectionTitle: { fontSize: 17, fontWeight: '900', color: colors.text, letterSpacing: -0.3 },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d1fae5',
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  liveText: { fontSize: 9, fontWeight: '800', color: '#047857' },
  metricRow: { marginHorizontal: 14, flexDirection: 'row', gap: 10 },
  metricCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 9,
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  metricImage: {
    width: 68,
    height: 68,
    alignSelf: 'center',
    borderRadius: 15,
    marginBottom: 6,
    backgroundColor: '#f8fafc',
  },
  metricDetails: { minHeight: 61 },
  metricTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  metricTitle: { fontSize: 12, lineHeight: 15, fontWeight: '800', color: colors.text },
  metricValue: { marginTop: 4, minHeight: 34, fontSize: 15, lineHeight: 17, fontWeight: '900', letterSpacing: -0.25 },
  metricStatus: { marginTop: 2, fontSize: 8, fontWeight: '700', color: colors.textMuted },
  recordIndicator: { height: 4, borderRadius: 3, marginTop: 6 },
  nutritionCard: {
    marginHorizontal: 14,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 8,
  },
  nutritionImage: { width: 58, height: 58, borderRadius: 13, marginRight: 11 },
  nutritionContent: { flex: 1 },
  nutritionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  nutritionTitle: { fontSize: 12, fontWeight: '800', color: colors.text },
  nutritionValue: { marginTop: 1, fontSize: 16, fontWeight: '900', color: colors.textMuted },
  nutritionNote: { marginTop: 1, fontSize: 9, lineHeight: 12, color: colors.textMuted },
  latestSection: { marginTop: 10, marginHorizontal: 14 },
  latestHeadingRow: {
    marginBottom: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  latestEyebrow: { fontSize: 9, fontWeight: '900', color: colors.primary, letterSpacing: 1.2 },
  latestHint: { fontSize: 9, fontWeight: '700', color: colors.textMuted },
  latestCard: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.96)',
    padding: 10,
    shadowColor: '#0f172a',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  latestIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  latestCopy: { flex: 1 },
  latestTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  latestTitle: { flex: 1, fontSize: 12, fontWeight: '900', color: colors.text },
  latestTime: { fontSize: 9, fontWeight: '700', color: colors.textMuted },
  latestPreview: { marginTop: 3, fontSize: 10, lineHeight: 14, color: colors.textMuted },
  latestArrow: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ecfdf5',
    marginLeft: 8,
  },
});
