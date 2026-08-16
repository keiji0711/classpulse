import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import type { AppUser, SessionData } from '../types';
import { FUNCTIONS_URL, SUPABASE_ANON_KEY, supabase, getAuthHeaders, setParentJwt } from '../lib/supabase';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { secureGet, secureSet, secureDelete } from '../lib/secureStorage';
import { flushQueuedAttendance, getQueuedAttendanceCount } from '../lib/instructorAttendanceQueue';
import { logOutRevenueCat } from '../lib/revenueCat';

// Create the notification channel immediately at module load so it exists
// before any notification arrives. Android caches channel settings permanently.
if (Platform.OS === 'android') {
  // Clean up old channels that may have been cached without sound
  Notifications.deleteNotificationChannelAsync('default').catch(() => {});
  Notifications.deleteNotificationChannelAsync('classpulse-alerts').catch(() => {});

  Notifications.setNotificationChannelAsync('classpulse-sound-v2', {
    name: 'ClassPulse Notifications',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#0f766e',
    sound: 'default',
  });
}

// Configure how notifications are displayed when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => {
    let playSound = true;
    try {
      const val = await AsyncStorage.getItem('classpulse_notif_sound');
      if (val === 'false') playSound = false;
    } catch {
      // default to sound on
    }
    return {
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: playSound,
      shouldSetBadge: true,
    };
  },
});

interface AuthContextType {
  session: SessionData | null;
  instructorUser: AppUser | null;
  role: 'parent' | 'instructor' | null;
  loading: boolean;
  queueCount: number;
  hasAccess: boolean;
  needsPinSetup: boolean;
  setParentAccessEnabled: (enabled: boolean) => Promise<void>;
  refreshParentAccess: () => Promise<void>;
  syncGooglePlayAccess: () => Promise<boolean>;
  loginParent: (schoolId: string, lrn: string, pin?: string) => Promise<void>;
  loginInstructor: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  confirmPinSetup: () => void;
  switchChild: (childId: string) => Promise<void>;
  syncQueue: () => Promise<{ synced: number; remaining: number }>;
  refreshQueueCount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  instructorUser: null,
  role: null,
  loading: true,
  queueCount: 0,
  hasAccess: false,
  needsPinSetup: false,
  setParentAccessEnabled: async () => {},
  refreshParentAccess: async () => {},
  syncGooglePlayAccess: async () => false,
  loginParent: async () => {},
  loginInstructor: async () => {},
  logout: async () => {},
  confirmPinSetup: () => {},
  switchChild: async () => {},
  syncQueue: async () => ({ synced: 0, remaining: 0 }),
  refreshQueueCount: async () => {},
});

const SESSION_KEY = 'classpulse_session';

async function savePushToken(studentId: string, pushToken: string) {
  const response = await fetchWithTimeout(`${FUNCTIONS_URL}/update-push-token`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ student_id: studentId, fcm_push_token: pushToken }),
  });
  if (!response.ok && __DEV__) {
    const details = await response.text();
    console.error(`[savePushToken] Failed (HTTP ${response.status}):`, details);
  }
  return response.ok;
}

async function registerForPushNotifications(studentId: string) {
  try {
    if (!Device.isDevice) {
      if (__DEV__) console.log('Push notifications require a physical device');
      return;
    }

    // Check / request permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      if (__DEV__) console.log('Push notification permission not granted');
      return;
    }

    // Get native FCM device token for direct push delivery
    const tokenData = await Notifications.getDevicePushTokenAsync();
    const pushToken = typeof tokenData.data === 'string' ? tokenData.data.trim() : '';

    if (!pushToken) {
      if (__DEV__) console.log('No FCM token available on this device:', tokenData.type);
      return;
    }

    if (__DEV__) console.log('FCM token acquired:', pushToken.substring(0, 30) + '...');

    if (!(await savePushToken(studentId, pushToken))) return;

    if (__DEV__) console.log('[registerForPushNotifications] Push token saved');
  } catch (error) {
    if (__DEV__) console.log('Failed to register push notifications:', error);
  }
}

function isJwtExpired(token: string): boolean {
  try {
    const payload = token.split('.')[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof decoded.exp === 'number' && decoded.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionData | null>(null);
  const [instructorUser, setInstructorUser] = useState<AppUser | null>(null);
  const [role, setRole] = useState<'parent' | 'instructor' | null>(null);
  const [loading, setLoading] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [needsPinSetup, setNeedsPinSetup] = useState(false);
  const roleRef = useRef<'parent' | 'instructor' | null>(null);
  const loadingRef = useRef(true);
  const lastRegisteredStudentRef = useRef<string | null>(null);

  const hasAccess = session?.access_enabled !== false;

  async function setParentAccessEnabled(enabled: boolean) {
    if (!session || session.access_enabled === enabled) return;
    const updated = { ...session, access_enabled: enabled };
    setSession(updated);
    await secureSet(SESSION_KEY, JSON.stringify(updated));
  }

  async function refreshParentAccess(currentSession = session) {
    if (!currentSession?.student?.id) return;
    try {
      const res = await fetchWithTimeout(`${FUNCTIONS_URL}/parent-access-status`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ student_id: currentSession.student.id }),
      });
      if (!res.ok) return;
      const json = await res.json();
      const accessEnabled = json.access_enabled !== false;
      const billingAppUserId = typeof json.billing_app_user_id === 'string'
        ? json.billing_app_user_id
        : currentSession.billing_app_user_id;
      const refreshedSchool = json.school
        ? {
            id: json.school.id,
            name: json.school.name,
            logo_url: json.school.logo_url ?? null,
          }
        : currentSession.school;
      const schoolUnchanged =
        currentSession.school.id === refreshedSchool.id &&
        currentSession.school.name === refreshedSchool.name &&
        currentSession.school.logo_url === refreshedSchool.logo_url;
      if (
        currentSession.access_enabled === accessEnabled &&
        currentSession.billing_app_user_id === billingAppUserId &&
        schoolUnchanged
      ) return;
      const updated = {
        ...currentSession,
        access_enabled: accessEnabled,
        billing_app_user_id: billingAppUserId,
        school: refreshedSchool,
      };
      setSession(updated);
      await secureSet(SESSION_KEY, JSON.stringify(updated));
    } catch {
      // Keep the last known access state while offline.
    }
  }

  async function syncGooglePlayAccess(currentSession = session): Promise<boolean> {
    if (!currentSession?.student?.id || !currentSession.billing_app_user_id) return false;
    try {
      const res = await fetchWithTimeout(`${FUNCTIONS_URL}/sync-revenuecat-access`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ student_id: currentSession.student.id }),
      });
      if (!res.ok) return false;
      const json = await res.json();
      const accessEnabled = json.access_enabled !== false;
      const billingAppUserId = typeof json.billing_app_user_id === 'string'
        ? json.billing_app_user_id
        : currentSession.billing_app_user_id;
      const updated = {
        ...currentSession,
        access_enabled: accessEnabled,
        billing_app_user_id: billingAppUserId,
      };
      setSession(updated);
      await secureSet(SESSION_KEY, JSON.stringify(updated));
      return json.google_play_active === true;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  useEffect(() => {
    if (role !== 'parent' || !session?.student?.id) return;

    if (session.billing_app_user_id) {
      void syncGooglePlayAccess(session);
    } else {
      void refreshParentAccess(session);
    }
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        if (session.billing_app_user_id) void syncGooglePlayAccess(session);
        else void refreshParentAccess(session);
      }
    });

    return () => appStateSubscription.remove();
  }, [role, session?.student?.id, session?.billing_app_user_id]);

  useEffect(() => {
    loadSession().then(() => {
      loadingRef.current = false;
    });
  }, []);

  // Register push notifications only for parent mode.
  useEffect(() => {
    if (role === 'parent' && session?.student?.id) {
      if (lastRegisteredStudentRef.current === session.student.id) {
        return;
      }

      lastRegisteredStudentRef.current = session.student.id;
      registerForPushNotifications(session.student.id);
    }
  }, [role, session]);

  // Firebase/Expo can rotate a token while the app remains installed. Persist
  // the replacement immediately instead of waiting for another login.
  useEffect(() => {
    if (role !== 'parent' || !session?.student?.id) return;
    const studentId = session.student.id;
    const subscription = Notifications.addPushTokenListener((tokenData) => {
      const token = typeof tokenData.data === 'string' ? tokenData.data.trim() : '';
      if (token) void savePushToken(studentId, token);
    });
    return () => subscription.remove();
  }, [role, session?.student?.id]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, authSession) => {
      // Parent mode uses function-based auth. Ignore Supabase auth changes in that mode.
      if (roleRef.current === 'parent') {
        return;
      }

      // Don't reset state while initial session load is still in progress
      if (loadingRef.current) {
        return;
      }

      if (authSession?.user) {
        void hydrateInstructor(authSession.user.id);
        return;
      }

      roleRef.current = null;
      setInstructorUser(null);
      setRole(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (role !== 'instructor') {
      return;
    }

    void refreshQueueCount();
    void syncQueue();

    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected) {
        void syncQueue();
      }
    });

    return () => unsubscribe();
  }, [role]);

  // Refresh school branding when a teacher returns to the app, so a newly
  // uploaded logo does not require signing out and back in.
  useEffect(() => {
    if (role !== 'instructor' || !instructorUser?.id) return;
    const instructorId = instructorUser.id;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void hydrateInstructor(instructorId);
    });
    return () => subscription.remove();
  }, [role, instructorUser?.id]);

  async function refreshQueueCount() {
    const count = await getQueuedAttendanceCount();
    setQueueCount(count);
  }

  async function syncQueue() {
    const result = await flushQueuedAttendance();
    await refreshQueueCount();
    return result;
  }

  async function hydrateInstructor(userId: string, reportQueryError = false) {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, role, school_id, full_name, phone_number, address, created_at, account_status, school:schools!users_school_id_fkey(id, name, logo_url)')
      .eq('id', userId)
      .single();

    if (error) {
      roleRef.current = null;
      setInstructorUser(null);
      setRole(null);
      if (reportQueryError) {
        throw new Error('Your password was accepted, but your teacher profile could not be loaded. Please try again.');
      }
      return null;
    }

    if (!data || data.role !== 'instructor' || data.account_status === 'deactivated') {
      roleRef.current = null;
      setInstructorUser(null);
      setRole(null);
      return null;
    }

    const normalizedSchool = Array.isArray((data as any).school)
      ? (data as any).school[0] ?? null
      : (data as any).school ?? null;

    const normalizedUser: AppUser = {
      id: data.id,
      email: data.email,
      role: data.role,
      school_id: data.school_id,
      full_name: data.full_name,
      phone_number: data.phone_number,
      address: data.address,
      created_at: data.created_at,
      account_status: data.account_status ?? 'active',
      school: normalizedSchool,
    };

    roleRef.current = 'instructor';
    setSession(null);
    setInstructorUser(normalizedUser);
    setRole('instructor');
    await refreshQueueCount();
    return normalizedUser;
  }

  async function loadSession() {
    try {
      // Migrate from old unencrypted storage if present
      const legacyStored = await AsyncStorage.getItem(SESSION_KEY);
      if (legacyStored) {
        await secureSet(SESSION_KEY, legacyStored);
        await AsyncStorage.removeItem(SESSION_KEY);
      }

      const stored = await secureGet(SESSION_KEY);
      if (stored) {
        const data: SessionData = JSON.parse(stored);

        // Keep parent sessions active until the user explicitly logs out.
        if (data?.student?.id && data?.school?.id) {
          // Reject expired tokens — force re-login instead of serving 401s.
          if (data.token && isJwtExpired(data.token)) {
            await secureDelete(SESSION_KEY);
            setLoading(false);
            return;
          }
          if (data.token) {
            setParentJwt(data.token);
          }
          roleRef.current = 'parent';
          setSession({ ...data, role: 'parent' });
          setInstructorUser(null);
          setRole('parent');
          setLoading(false);
          return;
        }

        await secureDelete(SESSION_KEY);
      }

      const {
        data: { session: authSession },
      } = await supabase.auth.getSession();

      if (authSession?.user) {
        await hydrateInstructor(authSession.user.id);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  function confirmPinSetup() {
    setNeedsPinSetup(false);
  }

  async function loginParent(schoolId: string, lrn: string, pin?: string) {
    await supabase.auth.signOut();
    setParentJwt(null);

    const body: Record<string, string> = { school_id: schoolId, lrn };
    if (pin) body.pin = pin;

    const res = await fetchWithTimeout(`${FUNCTIONS_URL}/parent-login`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }

    // Store the JWT for authenticated requests
    if (data.token) {
      setParentJwt(data.token);
    }

    const parentData: SessionData = { ...data, role: 'parent' };
    await secureSet(SESSION_KEY, JSON.stringify(parentData));
    roleRef.current = 'parent';
    setInstructorUser(null);
    setRole('parent');
    setNeedsPinSetup(!data.has_pin);
    setSession(parentData);
  }

  async function switchChild(childId: string) {
    if (!session) return;

    // Find the child in siblings list
    const sibling = session.siblings?.find((s) => s.id === childId);
    if (!sibling) return;

    // Build new siblings list: remove the target child, add the current student
    const newSiblings = [
      ...(session.siblings || []).filter((s) => s.id !== childId),
      { id: session.student.id, first_name: session.student.first_name, last_name: session.student.last_name, lrn: session.student.lrn },
    ];

    // Look up the parent row for this child.
    let newParent = session.parent;
    let newAccessEnabled = false;
    let billingAppUserId = session.billing_app_user_id;

    try {
      // Check the selected child before changing screens. Defaulting to
      // restricted prevents content from briefly appearing when that child's
      // adviser has disabled parent access.
      const accessResponse = await fetchWithTimeout(`${FUNCTIONS_URL}/parent-access-status`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ student_id: childId }),
      });
      if (accessResponse.ok) {
        const accessJson = await accessResponse.json();
        newAccessEnabled = accessJson.access_enabled !== false;
        if (typeof accessJson.billing_app_user_id === 'string') {
          billingAppUserId = accessJson.billing_app_user_id;
        }
        const parentRow = accessJson.parent;
        if (parentRow) {
        newParent = {
          id: parentRow.id,
          guardian_name: parentRow.guardian_name,
          email: parentRow.email ?? null,
          phone_number: parentRow.phone_number ?? '',
        };
        }
      }
    } catch {
      // keep current parent info if fetch fails
    }

    const updatedSession: SessionData = {
      ...session,
      student: sibling,
      parent: newParent,
      siblings: newSiblings,
      access_enabled: newAccessEnabled,
      billing_app_user_id: billingAppUserId,
    };

    await secureSet(SESSION_KEY, JSON.stringify(updatedSession));
    setSession(updatedSession);

    // Re-register push notifications for the new child
    lastRegisteredStudentRef.current = null;
  }

  async function loginInstructor(email: string, password: string) {
    await secureDelete(SESSION_KEY);
    setSession(null);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw new Error(error.message);
    }

    if (!data.user) {
      throw new Error('Invalid instructor login response');
    }

    const instructor = await hydrateInstructor(data.user.id, true);

    if (!instructor) {
      await supabase.auth.signOut();
      throw new Error('This account is not an instructor account');
    }
  }

  async function logout() {
    roleRef.current = null;
    setParentJwt(null);
    await secureDelete(SESSION_KEY);
    await logOutRevenueCat().catch(() => {});
    await supabase.auth.signOut();
    setSession(null);
    setInstructorUser(null);
    setRole(null);
    setQueueCount(0);
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        instructorUser,
        role,
        loading,
        queueCount,
        hasAccess,
        needsPinSetup,
        loginParent,
        loginInstructor,
        logout,
        confirmPinSetup,
        switchChild,
        syncQueue,
        refreshQueueCount,
        setParentAccessEnabled,
        refreshParentAccess: async () => refreshParentAccess(),
        syncGooglePlayAccess: async () => syncGooglePlayAccess(),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
