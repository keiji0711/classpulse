import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '../contexts/AuthContext';
import { colors } from '../theme/colors';
import GridBackground from '../components/GridBackground';
import SchoolLogo from '../components/SchoolLogo';
import { PRIVACY_URL, TERMS_URL } from '../lib/legal';

export default function InstructorProfileScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { instructorUser, queueCount, syncQueue, logout } = useAuth();

  async function handleManualSync() {
    const result = await syncQueue();
    Alert.alert('Sync Result', result.remaining > 0 ? `Synced ${result.synced}. Remaining ${result.remaining}.` : `Synced ${result.synced}. Queue is clear.`);
  }

  function handleLogout() {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: logout },
    ]);
  }

  return (
    <GridBackground>
      <View style={[styles.statusBarGuard, { height: insets.top }]} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.schoolIdentity}>
            <SchoolLogo
              logoUrl={instructorUser?.school?.logo_url}
              schoolName={instructorUser?.school?.name ?? 'School'}
              size={36}
            />
            <Text style={styles.schoolName} numberOfLines={2}>
              {instructorUser?.school?.name ?? 'School'}
            </Text>
          </View>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(instructorUser?.full_name ?? 'I').split(' ').map((token) => token[0]).join('').slice(0, 2).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.name}>{instructorUser?.full_name ?? 'Teacher'}</Text>
          <Text style={styles.subText}>{instructorUser?.email}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>SYNC</Text>
          <View style={styles.group}>
            <View style={styles.cell}>
              <Ionicons name="cloud-upload-outline" size={20} color={colors.secondary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cellLabel}>Queued attendance</Text>
                <Text style={styles.cellValue}>{queueCount} pending batch(es)</Text>
              </View>
            </View>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.actionCell} onPress={handleManualSync} activeOpacity={0.7}>
              <Ionicons name="sync-outline" size={20} color={colors.secondary} />
              <Text style={styles.actionText}>Sync now</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>PARENT ACCESS</Text>
          <View style={styles.group}>
            <TouchableOpacity
              style={styles.actionCell}
              onPress={() => navigation?.getParent?.()?.navigate('InstructorCollections')}
              activeOpacity={0.7}
            >
              <Ionicons name="cash-outline" size={20} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cellValue}>Parent Collections</Text>
                <Text style={styles.cellLabel}>Record monthly payments and activate access</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>ACCOUNT</Text>
          <View style={styles.group}>
            <View style={styles.cell}>
              <Ionicons name="person-outline" size={20} color={colors.secondary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cellLabel}>Role</Text>
                <Text style={styles.cellValue}>Teacher</Text>
              </View>
            </View>
            <View style={styles.divider} />
            <View style={styles.cell}>
              <Ionicons name="call-outline" size={20} color={colors.secondary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cellLabel}>Phone</Text>
                <Text style={styles.cellValue}>{instructorUser?.phone_number || 'Not set'}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>HELP & SUPPORT</Text>
          <View style={styles.group}>
            <TouchableOpacity
              style={styles.actionCell}
              onPress={() => navigation?.getParent?.()?.navigate('SupportChat')}
              activeOpacity={0.7}
            >
              <Ionicons name="chatbubbles-outline" size={20} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cellValue}>Contact Support</Text>
                <Text style={styles.cellLabel}>Chat with the ClassPulse team</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>ABOUT</Text>
          <View style={styles.group}>
            <TouchableOpacity
              style={styles.actionCell}
              onPress={() => navigation?.getParent?.()?.navigate('About')}
              activeOpacity={0.7}
            >
              <Ionicons name="information-circle-outline" size={20} color={colors.secondary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cellValue}>About ClassPulse</Text>
                <Text style={styles.cellLabel}>App info, version, and credits</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.actionCell}
              onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)}
              activeOpacity={0.7}
            >
              <Ionicons name="shield-checkmark-outline" size={20} color={colors.secondary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cellValue}>Privacy Policy</Text>
                <Text style={styles.cellLabel}>How we handle your data</Text>
              </View>
              <Ionicons name="open-outline" size={18} color={colors.textMuted} />
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.actionCell}
              onPress={() => WebBrowser.openBrowserAsync(TERMS_URL)}
              activeOpacity={0.7}
            >
              <Ionicons name="document-text-outline" size={20} color={colors.secondary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cellValue}>Terms of Service</Text>
                <Text style={styles.cellLabel}>Rules for using ClassPulse</Text>
              </View>
              <Ionicons name="open-outline" size={18} color={colors.textMuted} />
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.actionCell}
              onPress={() => navigation?.getParent?.()?.navigate('DeleteAccount')}
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={20} color={colors.secondary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cellValue}>Delete Account & Data</Text>
                <Text style={styles.cellLabel}>Request removal of your account</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.group}>
            <TouchableOpacity style={styles.logoutCell} onPress={handleLogout} activeOpacity={0.7}>
              <Ionicons name="log-out-outline" size={20} color={colors.danger} />
              <Text style={styles.logoutText}>Log Out</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.version}>ClassPulse v1.0.0</Text>
      </ScrollView>
    </GridBackground>
  );
}

const styles = StyleSheet.create({
  statusBarGuard: { backgroundColor: colors.primaryDark },
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingBottom: 30 },
  hero: {
    backgroundColor: colors.primaryDark,
    paddingTop: 24,
    paddingBottom: 22,
    alignItems: 'center',
  },
  schoolIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: '88%',
    marginBottom: 18,
  },
  schoolName: { flexShrink: 1, color: '#fff', fontSize: 14, fontWeight: '700' },
  avatar: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: { fontSize: 28, fontWeight: '700', color: '#fff' },
  name: { fontSize: 22, fontWeight: '700', color: '#fff' },
  subText: { marginTop: 3, color: 'rgba(255,255,255,0.8)', fontSize: 13 },
  section: { marginTop: 18, paddingHorizontal: 14 },
  sectionHeader: { marginLeft: 12, marginBottom: 6, fontSize: 12, color: colors.textMuted, fontWeight: '700' },
  group: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cellLabel: { fontSize: 12, color: colors.textMuted },
  cellValue: { marginTop: 2, fontSize: 14, color: colors.text, fontWeight: '600' },
  actionCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  actionText: { fontSize: 14, color: colors.secondary, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 46 },
  logoutCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  logoutText: { fontSize: 14, color: colors.danger, fontWeight: '700' },
  version: { textAlign: 'center', fontSize: 12, color: colors.textMuted, marginTop: 22 },
});
