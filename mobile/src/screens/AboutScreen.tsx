import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { colors } from '../theme/colors';
import GridBackground from '../components/GridBackground';

export default function AboutScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const version =
    (Constants?.expoConfig?.version as string | undefined) ??
    ((Constants as any)?.manifest?.version as string | undefined) ??
    '1.0.0';

  return (
    <GridBackground>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 28 }}
      >
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity onPress={() => navigation?.goBack?.()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>About</Text>
        </View>

        <View style={styles.hero}>
          <View style={styles.logoBubble}>
            <Ionicons name="paper-plane" size={36} color="#fff" />
          </View>
          <Text style={styles.appName}>ClassPulse</Text>
          <Text style={styles.appTagline}>School attendance & engagement, simplified.</Text>
          <View style={styles.versionPill}>
            <Text style={styles.versionPillText}>Version {version}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>WHAT IT DOES</Text>
          <View style={styles.group}>
            <Row icon="checkmark-done-circle-outline" title="Attendance" body="Real-time class attendance recorded by teachers." />
            <Divider />
            <Row icon="school-outline" title="Grades & Exams" body="Quarterly grades and periodical test scores per subject." />
            <Divider />
            <Row icon="chatbubbles-outline" title="Parent Updates" body="Push notifications and chat between parents and teachers." />
            <Divider />
            <Row icon="shield-checkmark-outline" title="DepEd Aligned" body="Built for Philippine K-12 schools — SF reports, LRN-based identity." />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>BUILT BY</Text>
          <View style={styles.group}>
            <Row icon="code-slash-outline" title="ClassPulse Team" body="Designed and engineered for Philippine educators." />
          </View>
        </View>

        <Text style={styles.footer}>© {new Date().getFullYear()} ClassPulse — All rights reserved.</Text>
      </ScrollView>
    </GridBackground>
  );
}

function Row({ icon, title, body }: { icon: any; title: string; body: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowBody}>{body}</Text>
      </View>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 12,
    paddingBottom: 12,
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
  title: { fontSize: 18, fontWeight: '800', color: colors.text },

  hero: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 24,
  },
  logoBubble: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  appName: { fontSize: 26, fontWeight: '800', color: colors.text },
  appTagline: { marginTop: 6, fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  versionPill: {
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.primary + '18',
  },
  versionPillText: { fontSize: 12, fontWeight: '700', color: colors.primary },

  section: { paddingHorizontal: 14, marginTop: 12 },
  sectionHeader: {
    marginLeft: 12,
    marginBottom: 6,
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '700',
  },
  group: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.primary + '14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  rowBody: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 60 },

  footer: {
    textAlign: 'center',
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 22,
  },
});
