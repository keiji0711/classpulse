import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  RefreshControl,
  Switch,
  Platform,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FUNCTIONS_URL, SUPABASE_ANON_KEY, getAuthHeaders } from '../lib/supabase';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { secureSet } from '../lib/secureStorage';
import { useAuth } from '../contexts/AuthContext';
import { useDataCache } from '../contexts/DataCacheContext';
import { colors } from '../theme/colors';
import GridBackground from '../components/GridBackground';
import SchoolLogo from '../components/SchoolLogo';
import { PRIVACY_URL, TERMS_URL } from '../lib/legal';

const NOTIF_SOUND_KEY = 'classpulse_notif_sound';

export default function ProfileScreen({ navigation }: any) {
  const { session, logout, refreshParentAccess } = useAuth();
  const { feed, refreshFeed } = useDataCache();
  const insets = useSafeAreaInsets();
  const records = feed.records;
  const [refreshing, setRefreshing] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Contact info
  const [contactEmail, setContactEmail] = useState(session?.parent?.email ?? '');
  const [contactPhone, setContactPhone] = useState(session?.parent?.phone_number ?? '');
  const [savingContact, setSavingContact] = useState(false);

  // Change PIN
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  const [savingPin, setSavingPin] = useState(false);

  // Sync initial values when session changes
  useEffect(() => {
    if (session?.parent) {
      setContactEmail(session.parent.email ?? '');
      setContactPhone(session.parent.phone_number ?? '');
    }
  }, [session?.parent?.email, session?.parent?.phone_number]);

  const contactChanged =
    contactEmail !== (session?.parent?.email ?? '') ||
    contactPhone !== (session?.parent?.phone_number ?? '');

  async function handleSaveContact() {
    if (!session?.parent?.id) return;

    const trimmedEmail = contactEmail.trim();
    const trimmedPhone = contactPhone.trim();

    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    if (trimmedPhone && !/^\+?[\d\s\-()]{7,20}$/.test(trimmedPhone)) {
      Alert.alert('Invalid Phone', 'Please enter a valid phone number.');
      return;
    }

    setSavingContact(true);
    try {
      const res = await fetchWithTimeout(`${FUNCTIONS_URL}/save-parent-contact`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          parent_id: session.parent.id,
          email: contactEmail.trim(),
          phone_number: contactPhone.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        Alert.alert('Error', json.error || 'Failed to save contact info.');
        return;
      }
      // Update local session cache
      if (session.parent) {
        session.parent.email = contactEmail.trim() || null;
        session.parent.phone_number = contactPhone.trim();
        const SESSION_KEY = 'classpulse_session';
        await secureSet(SESSION_KEY, JSON.stringify(session));
      }
      Alert.alert('Saved', 'Your contact info has been updated.');
    } catch {
      Alert.alert('Error', 'Unable to save. Please check your connection.');
    } finally {
      setSavingContact(false);
    }
  }

  // Load sound preference
  useEffect(() => {
    AsyncStorage.getItem(NOTIF_SOUND_KEY).then((val) => {
      if (val !== null) setSoundEnabled(val === 'true');
    });
  }, []);

  async function toggleSound(value: boolean) {
    setSoundEnabled(value);
    await AsyncStorage.setItem(NOTIF_SOUND_KEY, value ? 'true' : 'false');

    // Update the Android notification channel with/without sound
    if (Platform.OS === 'android') {
      // Must delete and recreate — Android caches channel sound settings
      await Notifications.deleteNotificationChannelAsync('classpulse-sound-v2').catch(() => {});

      await Notifications.setNotificationChannelAsync('classpulse-sound-v2', {
        name: 'ClassPulse Notifications',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#4f46e5',
        sound: value ? 'default' : null,
      });
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([refreshFeed(), refreshParentAccess()]);
    setRefreshing(false);
  }

  const stats = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, excused: 0, total: records.length };
    records.forEach((r: any) => c[r.status as keyof typeof c]++);
    return c;
  }, [records]);

  const rate = stats.total > 0 ? Math.round(((stats.present + stats.late + stats.excused) / stats.total) * 100) : 0;

  function handleLogout() {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log Out', style: 'destructive', onPress: logout },
      ]
    );
  }


  if (!session) return null;

  async function handleChangePin() {
    if (currentPin.length !== 4) {
      Alert.alert('Invalid PIN', 'Enter your current 4-digit PIN.');
      return;
    }
    if (newPin.length !== 4) {
      Alert.alert('Invalid PIN', 'New PIN must be 4 digits.');
      return;
    }
    if (newPin !== confirmNewPin) {
      Alert.alert('Mismatch', 'New PIN entries do not match.');
      return;
    }
    setSavingPin(true);
    try {
      const res = await fetchWithTimeout(`${FUNCTIONS_URL}/set-parent-pin`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          parent_id: session?.parent?.id,
          pin: newPin,
          current_pin: currentPin,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to change PIN');
      Alert.alert('Success', 'Your PIN has been changed.');
      setPinModalVisible(false);
      setCurrentPin('');
      setNewPin('');
      setConfirmNewPin('');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to change PIN');
    } finally {
      setSavingPin(false);
    }
  }

  return (
    <GridBackground>
      <View style={[styles.statusBarGuard, { height: insets.top }]} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
      >
        <View style={styles.hero}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {session.student.first_name.charAt(0)}{session.student.last_name.charAt(0)}
            </Text>
          </View>
          <Text style={styles.studentName}>
            {session.student.first_name} {session.student.last_name}
          </Text>
          <Text style={styles.lrnText}>LRN: {session.student.lrn}</Text>
        </View>

      {/* Attendance stats group */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>ATTENDANCE</Text>
        <View style={styles.group}>
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={[styles.statNum, { color: colors.success }]}>{stats.present}</Text>
              <Text style={styles.statLabel}>Present</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={[styles.statNum, { color: colors.danger }]}>{stats.absent}</Text>
              <Text style={styles.statLabel}>Absent</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={[styles.statNum, { color: colors.warning }]}>{stats.late}</Text>
              <Text style={styles.statLabel}>Late</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={[styles.statNum, { color: colors.secondary }]}>{rate}%</Text>
              <Text style={styles.statLabel}>Rate</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Student info group */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>STUDENT INFORMATION</Text>
        <View style={styles.group}>
          <View style={styles.cell}>
            <SchoolLogo logoUrl={session.school.logo_url} schoolName={session.school.name} size={34} />
            <View style={styles.cellContent}>
              <Text style={styles.cellLabel}>School</Text>
              <Text style={styles.cellValue}>{session.school.name}</Text>
            </View>
          </View>
          <View style={styles.cellDivider} />
          {session.parent && (
            <>
              <View style={styles.cell}>
                <Ionicons name="people-outline" size={22} color={colors.secondary} />
                <View style={styles.cellContent}>
                  <Text style={styles.cellLabel}>Guardian</Text>
                  <Text style={styles.cellValue}>{session.parent.guardian_name}</Text>
                </View>
              </View>
              <View style={styles.cellDivider} />
            </>
          )}
          <View style={styles.cell}>
            <Ionicons name="id-card-outline" size={22} color={colors.secondary} />
            <View style={styles.cellContent}>
              <Text style={styles.cellLabel}>LRN</Text>
              <Text style={styles.cellValue}>{session.student.lrn}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Contact Information */}
      {session.parent && (
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>CONTACT INFORMATION</Text>
          <View style={styles.group}>
            <View style={styles.inputCell}>
              <Ionicons name="mail-outline" size={22} color={colors.secondary} />
              <View style={styles.cellContent}>
                <Text style={styles.cellLabel}>Email Address</Text>
                <TextInput
                  style={styles.inputField}
                  value={contactEmail}
                  onChangeText={setContactEmail}
                  placeholder="your@gmail.com"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            </View>
            <View style={styles.cellDivider} />
            <View style={styles.inputCell}>
              <Ionicons name="call-outline" size={22} color={colors.secondary} />
              <View style={styles.cellContent}>
                <Text style={styles.cellLabel}>Mobile Number</Text>
                <TextInput
                  style={styles.inputField}
                  value={contactPhone}
                  onChangeText={setContactPhone}
                  placeholder="09XX XXX XXXX"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="phone-pad"
                />
              </View>
            </View>
            {contactChanged && (
              <>
                <View style={styles.cellDivider} />
                <TouchableOpacity
                  style={styles.saveContactBtn}
                  onPress={handleSaveContact}
                  disabled={savingContact}
                  activeOpacity={0.6}
                >
                  {savingContact ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle" size={20} color="#fff" />
                      <Text style={styles.saveContactText}>Save Contact Info</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
            <View style={styles.cellDivider} />
            <View style={styles.contactNote}>
              <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
              <Text style={styles.contactNoteText}>We'll use this email for important account updates.</Text>
            </View>
          </View>
        </View>
      )}

      {/* Security */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>SECURITY</Text>
        <View style={styles.group}>
          <TouchableOpacity style={styles.actionCell} onPress={() => setPinModalVisible(true)} activeOpacity={0.6}>
            <Ionicons name="lock-closed-outline" size={22} color={colors.secondary} />
            <View style={styles.cellContent}>
              <Text style={styles.cellValue}>Change PIN</Text>
              <Text style={styles.cellLabel}>Update your 4-digit login PIN</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Change PIN Modal */}
      <Modal visible={pinModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Change PIN</Text>
            <View style={styles.inputGroup}>
              <Text style={styles.pinLabel}>Current PIN</Text>
              <TextInput
                style={styles.pinInput}
                value={currentPin}
                onChangeText={(t) => setCurrentPin(t.replace(/[^0-9]/g, '').slice(0, 4))}
                keyboardType="numeric"
                maxLength={4}
                secureTextEntry
                placeholder="Enter current PIN"
                placeholderTextColor="#B0B0B0"
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.pinLabel}>New PIN</Text>
              <TextInput
                style={styles.pinInput}
                value={newPin}
                onChangeText={(t) => setNewPin(t.replace(/[^0-9]/g, '').slice(0, 4))}
                keyboardType="numeric"
                maxLength={4}
                secureTextEntry
                placeholder="Enter new PIN"
                placeholderTextColor="#B0B0B0"
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.pinLabel}>Confirm New PIN</Text>
              <TextInput
                style={styles.pinInput}
                value={confirmNewPin}
                onChangeText={(t) => setConfirmNewPin(t.replace(/[^0-9]/g, '').slice(0, 4))}
                keyboardType="numeric"
                maxLength={4}
                secureTextEntry
                placeholder="Re-enter new PIN"
                placeholderTextColor="#B0B0B0"
              />
            </View>
            <TouchableOpacity
              style={[styles.modalBtn, savingPin && { opacity: 0.6 }]}
              onPress={handleChangePin}
              disabled={savingPin}
              activeOpacity={0.7}
            >
              {savingPin ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalBtnText}>Update PIN</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalCancel} onPress={() => { setPinModalVisible(false); setCurrentPin(''); setNewPin(''); setConfirmNewPin(''); }} activeOpacity={0.7}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <View style={styles.section}>
        <Text style={styles.sectionHeader}>NOTIFICATIONS</Text>
        <View style={styles.group}>
          <View style={styles.cell}>
            <Ionicons name="volume-high-outline" size={22} color={colors.secondary} />
            <View style={styles.cellContent}>
              <Text style={styles.cellValue}>Notification Sound</Text>
              <Text style={styles.cellLabel}>{soundEnabled ? 'Sound enabled' : 'Silent mode'}</Text>
            </View>
            <Switch
              value={soundEnabled}
              onValueChange={toggleSound}
              trackColor={{ false: '#d1d5db', true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
        </View>
      </View>

      {/* Help & Support */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>HELP & SUPPORT</Text>
        <View style={styles.group}>
          <TouchableOpacity
            style={styles.actionCell}
            onPress={() => navigation.getParent()?.navigate('SupportChat')}
            activeOpacity={0.6}
          >
            <Ionicons name="chatbubbles-outline" size={22} color={colors.primary} />
            <View style={styles.cellContent}>
              <Text style={styles.cellValue}>Contact Support</Text>
              <Text style={styles.cellLabel}>Chat with the ClassPulse team</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* About */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>ABOUT</Text>
        <View style={styles.group}>
          <TouchableOpacity
            style={styles.actionCell}
            onPress={() => navigation.getParent()?.navigate('About')}
            activeOpacity={0.6}
          >
            <Ionicons name="information-circle-outline" size={22} color={colors.secondary} />
            <View style={styles.cellContent}>
              <Text style={styles.cellValue}>About ClassPulse</Text>
              <Text style={styles.cellLabel}>App info, version, and credits</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <View style={styles.cellDivider} />
          <TouchableOpacity
            style={styles.actionCell}
            onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)}
            activeOpacity={0.6}
          >
            <Ionicons name="shield-checkmark-outline" size={22} color={colors.secondary} />
            <View style={styles.cellContent}>
              <Text style={styles.cellValue}>Privacy Policy</Text>
              <Text style={styles.cellLabel}>How we handle your data</Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <View style={styles.cellDivider} />
          <TouchableOpacity
            style={styles.actionCell}
            onPress={() => WebBrowser.openBrowserAsync(TERMS_URL)}
            activeOpacity={0.6}
          >
            <Ionicons name="document-text-outline" size={22} color={colors.secondary} />
            <View style={styles.cellContent}>
              <Text style={styles.cellValue}>Terms of Service</Text>
              <Text style={styles.cellLabel}>Rules for using ClassPulse</Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <View style={styles.cellDivider} />
          <TouchableOpacity
            style={styles.actionCell}
            onPress={() => navigation.getParent()?.navigate('DeleteAccount')}
            activeOpacity={0.6}
          >
            <Ionicons name="trash-outline" size={22} color={colors.secondary} />
            <View style={styles.cellContent}>
              <Text style={styles.cellValue}>Delete Account & Data</Text>
              <Text style={styles.cellLabel}>Request removal of your account</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Log out */}
      <View style={styles.section}>
        <View style={styles.group}>
          <TouchableOpacity style={styles.logoutCell} onPress={handleLogout} activeOpacity={0.6}>
            <Ionicons name="log-out-outline" size={22} color="#FF3B30" />
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
  content: { paddingBottom: 40 },

  hero: {
    backgroundColor: colors.primaryDark,
    paddingTop: 24,
    paddingBottom: 24,
    alignItems: 'center',
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 32,
    fontWeight: '600',
    color: '#fff',
  },
  studentName: {
    fontSize: 22,
    fontWeight: '600',
    color: '#fff',
  },
  lrnText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 4,
  },

  section: {
    marginTop: 20,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '600',
    marginBottom: 6,
    marginLeft: 16,
  },
  group: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },

  statsRow: {
    flexDirection: 'row',
    paddingVertical: 16,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statNum: {
    fontSize: 22,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 4,
  },

  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  cellContent: { flex: 1 },
  cellLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '400',
  },
  cellValue: {
    fontSize: 16,
    color: colors.text,
    fontWeight: '400',
    marginTop: 1,
  },
  cellDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: 52,
  },

  logoutCell: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  actionCell: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  logoutText: {
    fontSize: 16,
    color: colors.danger,
    fontWeight: '400',
  },

  version: {
    textAlign: 'center',
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 24,
  },
  subBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  subBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },

  inputCell: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 14,
  },
  inputField: {
    fontSize: 16,
    color: colors.text,
    fontWeight: '400',
    paddingVertical: Platform.OS === 'ios' ? 6 : 2,
    marginTop: 2,
  },
  saveContactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    marginHorizontal: 16,
    marginVertical: 10,
    paddingVertical: 12,
    borderRadius: 10,
  },
  saveContactText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  contactNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  contactNoteText: {
    fontSize: 12,
    color: colors.textMuted,
    flex: 1,
    lineHeight: 17,
  },

  // Change PIN modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 20,
    textAlign: 'center',
  },
  inputGroup: {
    marginBottom: 14,
  },
  pinLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 6,
  },
  pinInput: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 18,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    textAlign: 'center',
    letterSpacing: 8,
  },
  modalBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  modalBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  modalCancel: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  modalCancelText: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: '600',
  },
});
