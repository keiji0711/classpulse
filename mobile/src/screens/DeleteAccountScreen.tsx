import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { colors } from '../theme/colors';
import GridBackground from '../components/GridBackground';
import { CONTACT_EMAIL, DELETE_ACCOUNT_URL } from '../lib/legal';

export default function DeleteAccountScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();

  function emailRequest() {
    const subject = encodeURIComponent('Account & Data Deletion Request');
    const body = encodeURIComponent(
      'Please delete my ClassPulse account and associated data.\n\n' +
        'Role (parent / teacher / admin):\n' +
        'School name:\n' +
        'Name on account:\n' +
        'Email or LRN used to log in:\n',
    );
    Linking.openURL(`mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`).catch(() => {});
  }

  function openWebPage() {
    WebBrowser.openBrowserAsync(DELETE_ACCOUNT_URL).catch(() => {});
  }

  return (
    <GridBackground>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => navigation?.goBack?.()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Delete Account & Data</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
        <View style={styles.body}>
          <Text style={styles.h1}>Delete Your Account & Data</Text>
          <Text style={styles.p}>
            You can request deletion of your ClassPulse account and the personal data associated
            with it. This is the data-deletion process required by Google Play.
          </Text>

          <Section title="How to request deletion">
            <Text style={styles.p}>
              Send us a deletion request from the email or account you log in with. Include your
              role, school name, the name on the account, and the email or child's LRN you use to
              log in so we can verify the request.
            </Text>
          </Section>

          <Section title="What gets deleted">
            <Bullet>Your account profile and login credentials</Bullet>
            <Bullet>Parent/guardian contact details (name, email, phone)</Bullet>
            <Bullet>Push notification tokens for your devices</Bullet>
            <Bullet>Support conversation history</Bullet>
          </Section>

          <Section title="What may be retained">
            <Bullet>
              Student academic records (LRN, grades, attendance, exam scores) are owned by the
              school and coordinated with your school administrator.
            </Bullet>
          </Section>

          <Text style={styles.muted}>We verify and process requests within 30 days.</Text>
        </View>

        <TouchableOpacity style={styles.primaryBtn} onPress={emailRequest} activeOpacity={0.85}>
          <Ionicons name="mail-outline" size={18} color="#fff" />
          <Text style={styles.primaryBtnText}>Email deletion request</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryBtn} onPress={openWebPage} activeOpacity={0.7}>
          <Ionicons name="open-outline" size={18} color={colors.primary} />
          <Text style={styles.secondaryBtnText}>Open full details on the web</Text>
        </TouchableOpacity>
      </ScrollView>
    </GridBackground>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 18 }}>
      <Text style={styles.h2}>{title}</Text>
      <View style={{ marginTop: 6 }}>{children}</View>
    </View>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
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

  body: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
  },
  h1: { fontSize: 22, fontWeight: '800', color: colors.text, marginBottom: 6 },
  h2: { fontSize: 14, fontWeight: '700', color: colors.text },
  p: { fontSize: 13, color: colors.text, lineHeight: 19, marginTop: 2 },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 16 },

  bulletRow: { flexDirection: 'row', marginTop: 4, paddingLeft: 4 },
  bulletDot: { fontSize: 14, color: colors.primary, width: 14, lineHeight: 19 },
  bulletText: { flex: 1, fontSize: 13, color: colors.text, lineHeight: 19 },

  primaryBtn: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
  },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  secondaryBtn: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 13,
  },
  secondaryBtnText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
});
