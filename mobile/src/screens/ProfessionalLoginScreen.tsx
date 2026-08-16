import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  type ImageStyle,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GridBackground from '../components/GridBackground';
import { useAuth } from '../contexts/AuthContext';
import { fetchLoginSchools } from '../lib/loginSchools';
import { colors } from '../theme/colors';

type LoginMode = 'parent' | 'instructor';

interface SchoolOption {
  id: string;
  name: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LRN_REGEX = /^\d{6,12}$/;

export default function ProfessionalLoginScreen() {
  const { loginParent, loginInstructor } = useAuth();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<LoginMode>('parent');
  const [selectedSchool, setSelectedSchool] = useState<SchoolOption | null>(null);
  const [schoolModalVisible, setSchoolModalVisible] = useState(false);
  const [schoolSearch, setSchoolSearch] = useState('');
  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [schoolsLoading, setSchoolsLoading] = useState(false);
  const [schoolsError, setSchoolsError] = useState(false);
  const [lrn, setLrn] = useState('');
  const [pin, setPin] = useState('');
  const [needsPin, setNeedsPin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const lrnRef = useRef<TextInput>(null);
  const pinRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const searchRef = useRef<TextInput>(null);
  const submittingRef = useRef(false);

  const fetchSchools = useCallback(async () => {
    setSchoolsLoading(true);
    setSchoolsError(false);
    try {
      setSchools(await fetchLoginSchools());
    } catch {
      setSchoolsError(true);
    } finally {
      setSchoolsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSchools();
  }, [fetchSchools]);

  const filteredSchools = schools.filter((school) =>
    school.name.toLowerCase().includes(schoolSearch.trim().toLowerCase()),
  );

  function selectMode(nextMode: LoginMode) {
    Keyboard.dismiss();
    submittingRef.current = false;
    setMode(nextMode);
  }

  async function handleLogin() {
    if (submittingRef.current) return;
    submittingRef.current = true;

    if (mode === 'parent') {
      const trimmedLrn = lrn.trim();
      if (!selectedSchool) {
        Alert.alert('Select your school', 'Choose the school where the student is enrolled.');
        submittingRef.current = false;
        return;
      }
      if (!LRN_REGEX.test(trimmedLrn)) {
        Alert.alert('Check the LRN', 'Enter the 6–12 digit Learner Reference Number.');
        submittingRef.current = false;
        return;
      }
      if (needsPin && pin.length !== 4) {
        Alert.alert('PIN required', 'Enter the 4-digit parent PIN.');
        submittingRef.current = false;
        return;
      }
    } else {
      const trimmedEmail = email.trim();
      if (!EMAIL_REGEX.test(trimmedEmail)) {
        Alert.alert('Check your email', 'Enter a valid teacher email address.');
        submittingRef.current = false;
        return;
      }
      if (password.length < 6) {
        Alert.alert('Check your password', 'Your password must contain at least 6 characters.');
        submittingRef.current = false;
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === 'parent') {
        await loginParent(selectedSchool!.id, lrn.trim(), needsPin ? pin : undefined);
      } else {
        await loginInstructor(email.trim(), password);
      }
    } catch (error: any) {
      const message = error?.message ?? '';
      if (message === 'pin_required') {
        setNeedsPin(true);
        setTimeout(() => pinRef.current?.focus(), 300);
      } else {
        Alert.alert('Sign in failed', message || 'Unable to sign in. Please try again.');
      }
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  return (
    <GridBackground>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 22, paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandRow}>
            <Image source={require('../../assets/classPulseLogo.png')} style={styles.logo} resizeMode="contain" />
            <View>
              <Text style={styles.brandName}>ClassPulse</Text>
              <Text style={styles.brandCaption}>SCHOOL CONNECTION</Text>
            </View>
          </View>

          <View style={styles.intro}>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>Everything you need to stay connected with school, in one secure place.</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.modeSelector}>
              <ModeButton
                label="Parent"
                icon="people-outline"
                active={mode === 'parent'}
                onPress={() => selectMode('parent')}
              />
              <ModeButton
                label="Teacher"
                icon="school-outline"
                active={mode === 'instructor'}
                onPress={() => selectMode('instructor')}
              />
            </View>

            <View style={styles.formHeading}>
              <Text style={styles.formTitle}>{mode === 'parent' ? 'Parent access' : 'Teacher access'}</Text>
              <Text style={styles.formSubtitle}>
                {mode === 'parent'
                  ? 'Use the student information registered by your school.'
                  : 'Use the account issued by your school administrator.'}
              </Text>
            </View>

            {mode === 'parent' ? (
              <>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>School</Text>
                  <TouchableOpacity
                    style={[styles.field, selectedSchool && styles.fieldSelected]}
                    onPress={() => {
                      Keyboard.dismiss();
                      setSchoolSearch('');
                      setSchoolModalVisible(true);
                    }}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="business-outline" size={19} color={selectedSchool ? colors.primary : colors.textMuted} />
                    <Text style={[styles.fieldValue, !selectedSchool && styles.placeholder]} numberOfLines={1}>
                      {selectedSchool?.name ?? 'Select your school'}
                    </Text>
                    <Ionicons name="chevron-down" size={17} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Learner Reference Number</Text>
                  <View style={styles.field}>
                    <Ionicons name="id-card-outline" size={19} color={colors.textMuted} />
                    <TextInput
                      ref={lrnRef}
                      style={styles.input}
                      placeholder="Enter the student LRN"
                      placeholderTextColor="#94a3b8"
                      value={lrn}
                      onChangeText={(value) => setLrn(value.replace(/[^0-9]/g, ''))}
                      keyboardType="numeric"
                      maxLength={12}
                      returnKeyType={needsPin ? 'next' : 'done'}
                      onSubmitEditing={() => needsPin ? pinRef.current?.focus() : void handleLogin()}
                    />
                  </View>
                  <Text style={styles.fieldHint}>This is usually the 12-digit number on the student record.</Text>
                </View>

                {needsPin ? (
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>4-digit PIN</Text>
                    <Text style={styles.activationHint}>First login: use the last 4 digits of the guardian phone number.</Text>
                    <View style={styles.field}>
                      <Ionicons name="lock-closed-outline" size={19} color={colors.textMuted} />
                      <TextInput
                        ref={pinRef}
                        style={[styles.input, styles.pinInput]}
                        placeholder="••••"
                        placeholderTextColor="#94a3b8"
                        value={pin}
                        onChangeText={(value) => setPin(value.replace(/[^0-9]/g, '').slice(0, 4))}
                        keyboardType="numeric"
                        secureTextEntry
                        maxLength={4}
                        returnKeyType="done"
                        onSubmitEditing={() => void handleLogin()}
                      />
                    </View>
                  </View>
                ) : null}
              </>
            ) : (
              <>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Email address</Text>
                  <View style={styles.field}>
                    <Ionicons name="mail-outline" size={19} color={colors.textMuted} />
                    <TextInput
                      style={styles.input}
                      placeholder="teacher@school.edu"
                      placeholderTextColor="#94a3b8"
                      value={email}
                      onChangeText={setEmail}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                      autoComplete="email"
                      returnKeyType="next"
                      onSubmitEditing={() => passwordRef.current?.focus()}
                    />
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Password</Text>
                  <View style={styles.field}>
                    <Ionicons name="lock-closed-outline" size={19} color={colors.textMuted} />
                    <TextInput
                      ref={passwordRef}
                      style={styles.input}
                      placeholder="Enter your password"
                      placeholderTextColor="#94a3b8"
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="password"
                      returnKeyType="done"
                      onSubmitEditing={() => void handleLogin()}
                    />
                    <TouchableOpacity
                      style={styles.eyeButton}
                      onPress={() => setShowPassword((current) => !current)}
                      accessibilityRole="button"
                      accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                    >
                      <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                </View>
              </>
            )}

            <TouchableOpacity
              style={[styles.signInButton, loading && styles.signInButtonDisabled]}
              onPress={() => void handleLogin()}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <>
                  <Text style={styles.signInText}>Sign in</Text>
                  <Ionicons name="arrow-forward" size={18} color="#ffffff" />
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.helpRow}>
            <Ionicons name="help-circle-outline" size={16} color={colors.textMuted} />
            <Text style={styles.helpText}>Need access? Contact your school administrator.</Text>
          </View>
          <View style={styles.secureRow}>
            <Ionicons name="lock-closed" size={11} color="#94a3b8" />
            <Text style={styles.secureText}>Secure account access</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={schoolModalVisible}
        animationType="slide"
        transparent
        statusBarTranslucent
        onShow={() => setTimeout(() => searchRef.current?.focus(), 250)}
        onRequestClose={() => setSchoolModalVisible(false)}
      >
        <KeyboardAvoidingView style={styles.modalScreen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => {
              Keyboard.dismiss();
              setSchoolModalVisible(false);
            }}
          />
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleWrap}>
                <Text style={styles.modalEyebrow}>PARENT ACCESS</Text>
                <Text style={styles.modalTitle}>Choose your school</Text>
              </View>
              <TouchableOpacity style={styles.closeButton} onPress={() => setSchoolModalVisible(false)}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={styles.searchField}>
              <Ionicons name="search" size={19} color={colors.textMuted} />
              <TextInput
                ref={searchRef}
                style={styles.searchInput}
                placeholder="Search by school name"
                placeholderTextColor="#94a3b8"
                value={schoolSearch}
                onChangeText={setSchoolSearch}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
            </View>

            <View style={styles.schoolListContainer}>
              {schoolsLoading ? (
                <ActivityIndicator color={colors.primary} style={styles.loader} />
              ) : schoolsError ? (
                <View style={styles.emptyState}>
                  <Ionicons name="cloud-offline-outline" size={26} color={colors.textMuted} />
                  <Text style={[styles.emptyText, { marginBottom: 12 }]}>Could not load schools. Check your connection.</Text>
                  <TouchableOpacity onPress={fetchSchools} activeOpacity={0.7}
                    style={{ paddingVertical: 8, paddingHorizontal: 20, backgroundColor: colors.primary, borderRadius: 8 }}>
                    <Text style={{ color: '#fff', fontWeight: '600' }}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : filteredSchools.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="business-outline" size={26} color={colors.textMuted} />
                  <Text style={styles.emptyText}>{schoolSearch ? 'No matching schools' : 'No schools available'}</Text>
                </View>
              ) : (
                <FlatList
                  data={filteredSchools}
                  keyExtractor={(item) => item.id}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  contentContainerStyle={styles.schoolListContent}
                  renderItem={({ item }) => {
                    const active = selectedSchool?.id === item.id;
                    return (
                      <TouchableOpacity
                        style={[styles.schoolRow, active && styles.schoolRowActive]}
                        onPress={() => {
                          Keyboard.dismiss();
                          setSelectedSchool(item);
                          setSchoolModalVisible(false);
                          setTimeout(() => lrnRef.current?.focus(), 300);
                        }}
                        activeOpacity={0.75}
                      >
                        <View style={[styles.schoolIcon, active && styles.schoolIconActive]}>
                          <Ionicons name="business" size={18} color={active ? '#ffffff' : colors.textMuted} />
                        </View>
                        <Text style={[styles.schoolName, active && styles.schoolNameActive]} numberOfLines={2}>{item.name}</Text>
                        {active ? <Ionicons name="checkmark-circle" size={21} color={colors.primary} /> : null}
                      </TouchableOpacity>
                    );
                  }}
                />
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </GridBackground>
  );
}

function ModeButton({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={[styles.modeButton, active && styles.modeButtonActive]} onPress={onPress} activeOpacity={0.75}>
      <Ionicons name={icon} size={17} color={active ? colors.primaryDark : colors.textMuted} />
      <Text style={[styles.modeText, active && styles.modeTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20 },
  brandRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  logo: { width: 48, height: 48, marginRight: 11, borderRadius: 13 } as ImageStyle,
  brandName: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.text },
  brandCaption: { marginTop: 1, fontSize: 9, fontWeight: '700', letterSpacing: 1.25, color: colors.primary },
  intro: { marginTop: 32, marginBottom: 22 },
  title: { fontSize: 31, lineHeight: 36, fontWeight: '800', letterSpacing: -0.8, color: colors.text },
  subtitle: { maxWidth: 340, marginTop: 8, fontSize: 14, lineHeight: 21, color: colors.textMuted },
  card: {
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(203,213,225,0.85)',
    backgroundColor: 'rgba(255,255,255,0.97)',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 28,
    elevation: 4,
  },
  modeSelector: { flexDirection: 'row', gap: 6, padding: 4, borderRadius: 13, backgroundColor: colors.surfaceSoft },
  modeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 40,
    borderRadius: 10,
  },
  modeButtonActive: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 5,
    elevation: 1,
  },
  modeText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  modeTextActive: { fontWeight: '700', color: colors.primaryDark },
  formHeading: { marginTop: 22, marginBottom: 18 },
  formTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  formSubtitle: { marginTop: 4, fontSize: 12, lineHeight: 18, color: colors.textMuted },
  fieldGroup: { marginBottom: 15 },
  fieldLabel: { marginBottom: 7, fontSize: 12, fontWeight: '700', color: '#334155' },
  activationHint: { marginTop: -2, marginBottom: 7, fontSize: 11, lineHeight: 15, color: '#64748b' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
    paddingHorizontal: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  fieldSelected: { borderColor: '#5eead4', backgroundColor: '#f0fdfa' },
  fieldValue: { flex: 1, marginHorizontal: 10, fontSize: 14, color: colors.text },
  placeholder: { color: '#94a3b8' },
  input: { flex: 1, minWidth: 0, paddingHorizontal: 10, paddingVertical: 12, fontSize: 14, color: colors.text },
  pinInput: { letterSpacing: 6 },
  fieldHint: { marginTop: 6, paddingLeft: 2, fontSize: 11, lineHeight: 16, color: colors.textMuted },
  eyeButton: { padding: 8, marginRight: -7 },
  signInButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 50,
    marginTop: 5,
    borderRadius: 12,
    backgroundColor: colors.primaryDark,
  },
  signInButtonDisabled: { opacity: 0.55 },
  signInText: { fontSize: 15, fontWeight: '700', color: '#ffffff' },
  helpRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 20 },
  helpText: { fontSize: 12, color: colors.textMuted },
  secureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 10 },
  secureText: { fontSize: 10, fontWeight: '600', letterSpacing: 0.25, color: '#94a3b8' },
  modalScreen: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { position: 'absolute', inset: 0, backgroundColor: 'rgba(15,23,42,0.48)' },
  modalSheet: {
    minHeight: 400,
    maxHeight: '82%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.surface,
  },
  modalHandle: { alignSelf: 'center', width: 38, height: 4, marginTop: 10, borderRadius: 2, backgroundColor: '#cbd5e1' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 17, paddingBottom: 13 },
  modalTitleWrap: { flex: 1 },
  modalEyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: colors.primary },
  modalTitle: { marginTop: 3, fontSize: 21, fontWeight: '700', color: colors.text },
  closeButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: colors.surfaceSoft },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.background,
  },
  searchInput: { flex: 1, paddingHorizontal: 9, paddingVertical: 12, fontSize: 14, color: colors.text },
  schoolListContainer: { flex: 1, minHeight: 210 },
  schoolListContent: { paddingHorizontal: 16, paddingBottom: 8 },
  loader: { marginTop: 38 },
  emptyState: { alignItems: 'center', paddingTop: 42 },
  emptyText: { marginTop: 9, fontSize: 13, color: colors.textMuted },
  schoolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 62,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  schoolRowActive: { marginVertical: 3, borderBottomWidth: 0, borderRadius: 12, backgroundColor: '#f0fdfa' },
  schoolIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: 11, borderRadius: 10, backgroundColor: colors.surfaceSoft },
  schoolIconActive: { backgroundColor: colors.primary },
  schoolName: { flex: 1, paddingRight: 10, fontSize: 14, lineHeight: 19, color: colors.text },
  schoolNameActive: { fontWeight: '700', color: colors.primaryDark },
});
