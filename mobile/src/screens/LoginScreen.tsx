import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  ScrollView,
  Image,
  Modal,
  FlatList,
  Pressable,
  Keyboard,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { colors } from '../theme/colors';
import { fetchLoginSchools } from '../lib/loginSchools';
import GridBackground from '../components/GridBackground';

type LoginMode = 'parent' | 'instructor';

interface SchoolOption {
  id: string;
  name: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LRN_REGEX = /^\d{6,12}$/;

export default function LoginScreen() {
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
    fetchSchools();
  }, [fetchSchools]);

  const filteredSchools = schools.filter((s) =>
    s.name.toLowerCase().includes(schoolSearch.toLowerCase())
  );

  async function handleLogin() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    if (mode === 'parent') {
      const trimmedLrn = lrn.trim();
      if (!selectedSchool) {
        Alert.alert('Missing fields', 'Please select a school.');
        submittingRef.current = false;
        return;
      }
      if (!trimmedLrn) {
        Alert.alert('Missing fields', 'Please enter the LRN.');
        submittingRef.current = false;
        return;
      }
      if (!LRN_REGEX.test(trimmedLrn)) {
        Alert.alert('Invalid LRN', 'LRN must be a 6–12 digit number.');
        submittingRef.current = false;
        return;
      }
      if (needsPin && pin.length !== 4) {
        Alert.alert('PIN Required', 'Please enter your 4-digit PIN.');
        submittingRef.current = false;
        return;
      }
    } else {
      const trimmedEmail = email.trim();
      if (!trimmedEmail || !password.trim()) {
        Alert.alert('Missing fields', 'Please enter teacher email and password.');
        submittingRef.current = false;
        return;
      }
      if (!EMAIL_REGEX.test(trimmedEmail)) {
        Alert.alert('Invalid Email', 'Please enter a valid email address.');
        submittingRef.current = false;
        return;
      }
      if (password.length < 6) {
        Alert.alert('Invalid Password', 'Password must be at least 6 characters.');
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
    } catch (err: any) {
      const msg = err.message || '';
      if (msg === 'pin_required') {
        setNeedsPin(true);
        setTimeout(() => pinRef.current?.focus(), 300);
      } else {
        Alert.alert('Login Failed', msg || 'Unable to log in. Please try again.');
      }
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Brand Header */}
          <View style={styles.brandSection}>
            <Image
              source={require('../../assets/classPulseLogo.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
            <Text style={styles.appName}>ClassPulse</Text>
            <Text style={styles.tagline}>School attendance made simple</Text>
          </View>

          {/* Main Card */}
          <View style={styles.card}>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>
                {mode === 'parent' ? 'Parent Sign In' : 'Teacher Sign In'}
              </Text>
              <Text style={styles.cardSubtitle}>
                {mode === 'parent'
                  ? 'Select your school and enter the student LRN'
                  : 'Use your school-issued credentials'}
              </Text>

              {mode === 'parent' ? (
                <>
                  {/* School Picker */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>School</Text>
                    <TouchableOpacity
                      style={[styles.fieldBox, selectedSchool && styles.fieldBoxFilled]}
                      onPress={() => {
                        Keyboard.dismiss();
                        setSchoolSearch('');
                        setSchoolModalVisible(true);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.fieldBoxText,
                          !selectedSchool && styles.fieldBoxPlaceholder,
                        ]}
                        numberOfLines={1}
                      >
                        {selectedSchool ? selectedSchool.name : 'Tap to select school'}
                      </Text>
                      <Text style={styles.fieldBoxChevron}>›</Text>
                    </TouchableOpacity>
                  </View>

                  {/* School picker modal */}
                  <Modal
                    visible={schoolModalVisible}
                    animationType="slide"
                    transparent
                    statusBarTranslucent
                    onRequestClose={() => setSchoolModalVisible(false)}
                  >
                    <KeyboardAvoidingView
                      style={styles.modalScreen}
                      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    >
                      <Pressable
                        style={styles.modalBackdrop}
                        onPress={() => {
                          Keyboard.dismiss();
                          setSchoolModalVisible(false);
                        }}
                      />
                      <View style={styles.modalContainer}>
                        <View style={styles.modalHandle} />
                        <View style={styles.modalHeader}>
                          <View style={styles.modalTitleWrap}>
                            <Text style={styles.modalEyebrow}>Parent login</Text>
                            <Text style={styles.modalTitle}>Select school</Text>
                          </View>
                          <TouchableOpacity
                            style={styles.modalCloseBtn}
                            onPress={() => {
                              Keyboard.dismiss();
                              setSchoolModalVisible(false);
                            }}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.modalClose}>✕</Text>
                          </TouchableOpacity>
                        </View>

                        <View style={styles.searchBar}>
                          <Text style={styles.searchIcon}>⌕</Text>
                          <TextInput
                            ref={searchRef}
                            style={styles.searchInput}
                            placeholder="Search schools..."
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
                            <ActivityIndicator
                              color={colors.primary}
                              style={{ marginTop: 32 }}
                            />
                          ) : schoolsError ? (
                            <View style={{ alignItems: 'center', marginTop: 32, paddingHorizontal: 16 }}>
                              <Text style={[styles.emptyText, { marginBottom: 12 }]}>
                                Could not load schools. Check your connection.
                              </Text>
                              <TouchableOpacity onPress={fetchSchools} activeOpacity={0.7}
                                style={{ paddingVertical: 8, paddingHorizontal: 20, backgroundColor: colors.primary, borderRadius: 8 }}>
                                <Text style={{ color: '#fff', fontWeight: '600' }}>Retry</Text>
                              </TouchableOpacity>
                            </View>
                          ) : filteredSchools.length === 0 ? (
                            <Text style={styles.emptyText}>
                              {schoolSearch ? 'No schools match your search' : 'No schools found'}
                            </Text>
                          ) : (
                            <FlatList
                              data={filteredSchools}
                              keyExtractor={(item) => item.id}
                              keyboardShouldPersistTaps="handled"
                              keyboardDismissMode="on-drag"
                              contentContainerStyle={styles.schoolListContent}
                              renderItem={({ item }) => {
                                const isActive = selectedSchool?.id === item.id;
                                return (
                                  <TouchableOpacity
                                    style={[styles.schoolRow, isActive && styles.schoolRowActive]}
                                    onPress={() => {
                                      Keyboard.dismiss();
                                      setSelectedSchool(item);
                                      setSchoolModalVisible(false);
                                      setTimeout(() => lrnRef.current?.focus(), 300);
                                    }}
                                    activeOpacity={0.7}
                                  >
                                    <View style={[styles.schoolRadio, isActive && styles.schoolRadioActive]}>
                                      {isActive && <View style={styles.schoolRadioDot} />}
                                    </View>
                                    <Text style={[styles.schoolRowText, isActive && styles.schoolRowTextActive]}>
                                      {item.name}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              }}
                            />
                          )}
                        </View>
                      </View>
                    </KeyboardAvoidingView>
                  </Modal>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Learner Reference Number (LRN)</Text>
                    <View style={styles.fieldBox}>
                      <TextInput
                        ref={lrnRef}
                        style={styles.fieldInput}
                        placeholder="e.g. 123456789012"
                        placeholderTextColor="#94a3b8"
                        value={lrn}
                        onChangeText={setLrn}
                        keyboardType="numeric"
                        maxLength={12}
                        returnKeyType={needsPin ? 'next' : 'done'}
                        onSubmitEditing={() => needsPin ? pinRef.current?.focus() : handleLogin()}
                      />
                    </View>
                  </View>

                  {needsPin && (
                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>4-Digit PIN</Text>
                      <Text style={styles.activationHint}>First login: use the last 4 digits of the guardian phone number.</Text>
                      <View style={styles.fieldBox}>
                        <TextInput
                          ref={pinRef}
                          style={styles.fieldInput}
                          placeholder="Enter your PIN"
                          placeholderTextColor="#94a3b8"
                          value={pin}
                          onChangeText={(t) => setPin(t.replace(/[^0-9]/g, '').slice(0, 4))}
                          keyboardType="numeric"
                          maxLength={4}
                          secureTextEntry
                          returnKeyType="done"
                          onSubmitEditing={handleLogin}
                        />
                      </View>
                    </View>
                  )}
                </>
              ) : (
                <>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Email</Text>
                    <View style={styles.fieldBox}>
                      <TextInput
                        style={styles.fieldInput}
                        placeholder="teacher@school.edu"
                        placeholderTextColor="#94a3b8"
                        value={email}
                        onChangeText={setEmail}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        maxLength={254}
                        autoComplete="email"
                        returnKeyType="next"
                        onSubmitEditing={() => passwordRef.current?.focus()}
                      />
                    </View>
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Password</Text>
                    <View style={styles.fieldBox}>
                      <TextInput
                        ref={passwordRef}
                        style={styles.fieldInput}
                        placeholder="Enter password"
                        placeholderTextColor="#94a3b8"
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                        autoCapitalize="none"
                        maxLength={128}
                        autoComplete="password"
                        returnKeyType="done"
                        onSubmitEditing={handleLogin}
                      />
                    </View>
                  </View>
                </>
              )}

              {/* Sign In Button */}
              <TouchableOpacity
                style={[styles.signInBtn, loading && styles.signInBtnDisabled]}
                onPress={handleLogin}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.signInBtnText}>Sign In</Text>
                )}
              </TouchableOpacity>

              {/* Footer inside card */}
              <Text style={styles.helpText}>
                Need help? Contact your school administrator.
              </Text>
            </View>
          </View>

          {/* Bottom toggle */}
          <TouchableOpacity
            style={styles.switchModeBtn}
            onPress={() => setMode(mode === 'parent' ? 'instructor' : 'parent')}
            activeOpacity={0.7}
          >
            <Text style={styles.switchModeText}>
              {mode === 'parent' ? 'Sign in as Teacher instead' : 'Sign in as Parent instead'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f8fafa',
  },
  container: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 44,
    paddingBottom: 32,
  },

  // Brand
  brandSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoImage: {
    width: 64,
    height: 64,
    borderRadius: 16,
    marginBottom: 12,
  },
  appName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  tagline: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 4,
  },

  // Card
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e8ecf0',
    overflow: 'hidden',
  },
  cardBody: {
    padding: 24,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 4,
    marginBottom: 22,
    lineHeight: 19,
  },

  // Fields
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
  },
  activationHint: {
    marginTop: -2,
    marginBottom: 7,
    fontSize: 11,
    lineHeight: 15,
    color: '#64748b',
  },
  fieldBox: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d1d5db',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
  },
  fieldBoxFilled: {
    borderColor: '#0f766e',
    backgroundColor: '#f0fdfa',
  },
  fieldBoxText: {
    flex: 1,
    fontSize: 15,
    color: '#0f172a',
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  fieldBoxPlaceholder: {
    color: '#9ca3af',
  },
  fieldBoxChevron: {
    fontSize: 20,
    color: '#9ca3af',
    paddingRight: 14,
  },
  fieldInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: '#0f172a',
  },

  // Sign in button
  signInBtn: {
    backgroundColor: '#0f766e',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  signInBtnDisabled: {
    opacity: 0.5,
  },
  signInBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },

  // Help text
  helpText: {
    textAlign: 'center',
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 18,
  },

  // Switch mode
  switchModeBtn: {
    alignSelf: 'center',
    marginTop: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  switchModeText: {
    fontSize: 14,
    color: '#0f766e',
    fontWeight: '600',
  },

  // Modal
  modalScreen: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  modalContainer: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    minHeight: 360,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
  },
  modalHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d1d5db',
    marginTop: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
  },
  modalTitleWrap: {
    flex: 1,
    paddingRight: 12,
  },
  modalEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0f766e',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  modalCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalClose: {
    fontSize: 15,
    color: '#64748b',
    fontWeight: '600',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  searchIcon: {
    fontSize: 15,
    color: '#94a3b8',
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    color: '#0f172a',
  },
  schoolListContainer: {
    flex: 1,
    minHeight: 180,
  },
  schoolListContent: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  emptyText: {
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 14,
    marginTop: 32,
    paddingHorizontal: 20,
  },
  schoolRow: {
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  schoolRowActive: {
    backgroundColor: '#f0fdfa',
    borderColor: '#0f766e',
  },
  schoolRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  schoolRadioActive: {
    borderColor: '#0f766e',
  },
  schoolRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0f766e',
  },
  schoolRowText: {
    fontSize: 15,
    color: '#0f172a',
    flex: 1,
    lineHeight: 21,
  },
  schoolRowTextActive: {
    color: '#0f766e',
    fontWeight: '600',
  },
});
