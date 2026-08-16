import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { AppUser, SubscriptionEntitlements } from '../types';
import type { Session } from '@supabase/supabase-js';
import { ensureSupabaseSession } from '../lib/ensureSupabaseSession';
import { setRuntimeEntitlements } from '../lib/runtimeEntitlements';
import { canAccess as canAccessPerm, isPlatformOwner as isOwner, type PermissionKey } from '../lib/permissions';
import { registerCurrentDevice, rotateDeviceId } from '../lib/deviceSession';

interface AuthContextType {
  session: Session | null;
  user: AppUser | null;
  entitlements: SubscriptionEntitlements | null;
  schoolOperationalStatus: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  hasFeature: (featureKey: string) => boolean;
  canAccess: (perm: PermissionKey) => boolean;
  isPlatformOwner: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [entitlements, setEntitlements] = useState<SubscriptionEntitlements | null>(null);
  const [schoolOperationalStatus, setSchoolOperationalStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function buildDefaultEntitlements(profile: AppUser | null): SubscriptionEntitlements | null {
    if (!profile) return null;

    if (profile.role === 'super_admin') {
      return {
        school_id: null,
        status: 'active',
        has_access: true,
        plan_code: 'super_admin',
        plan_name: 'Super Admin',
        features: {
          attendance_take: true,
          grades_manage: true,
          exports_download: true,
          parent_messaging: true,
          analytics_advanced: true,
        },
        limits: {},
        grace_until: null,
        current_period_end: null,
      };
    }

    return {
      school_id: profile.school_id,
      status: 'active',
      has_access: true,
      plan_code: 'free',
      plan_name: 'Free Access',
      features: {
        attendance_take: true,
        grades_manage: true,
        exports_download: true,
        parent_messaging: true,
        analytics_advanced: true,
      },
      limits: {},
      grace_until: null,
      current_period_end: null,
    };
  }

  async function fetchEntitlements(profile: AppUser | null) {
    if (!profile) {
      setEntitlements(null);
      return;
    }

    if (profile.role === 'super_admin') {
      setEntitlements(buildDefaultEntitlements(profile));
      return;
    }

    setEntitlements(buildDefaultEntitlements(profile));
  }

  useEffect(() => {
    void (async () => {
      const { session: activeSession } = await ensureSupabaseSession();
      setSession(activeSession);
      if (activeSession?.user) {
        await fetchUserProfile(activeSession.user.id);
      } else {
        setUser(null);
        setEntitlements(null);
        setSchoolOperationalStatus(null);
        setRuntimeEntitlements(null);
        setLoading(false);
      }
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        fetchUserProfile(session.user.id);
      } else {
        setUser(null);
        setEntitlements(null);
        setRuntimeEntitlements(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchUserProfile(userId: string) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching user profile:', error);
      setUser(null);
      setEntitlements(null);
      setRuntimeEntitlements(null);
    } else {
      const profile = data as AppUser;
      if (profile.account_status === 'deactivated') {
        await supabase.auth.signOut({ scope: 'global' });
        setUser(null);
        setSession(null);
        setEntitlements(null);
        setRuntimeEntitlements(null);
        setLoading(false);
        return;
      }
      setUser(profile);
      if (profile.school_id) {
        const { data: school } = await supabase.from('schools').select('operational_status').eq('id', profile.school_id).single();
        setSchoolOperationalStatus(school?.operational_status ?? 'active');
      } else {
        setSchoolOperationalStatus(null);
      }
      await fetchEntitlements(profile);
    }
    setLoading(false);
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) rotateDeviceId();
    void supabase.functions.invoke('log-auth-event', {
      body: { email, success: !error, failure_reason: error?.message ?? null },
    });
    if (error) {
      if (error.status === 429 || error.code === 'over_request_rate_limit') {
        return { error: 'Too many people are signing in at once. Please wait 1–2 minutes and try again. Keep this device signed in to avoid another fresh login.' };
      }
      if ((error.status ?? 0) >= 500) {
        return { error: 'The sign-in service is temporarily busy. Please wait a moment and try again.' };
      }
      return { error: error.message };
    }
    return { error: null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setEntitlements(null);
    setRuntimeEntitlements(null);
    setSession(null);
    setSchoolOperationalStatus(null);
  }

  async function refreshUser() {
    if (!session?.user?.id) return;
    await fetchUserProfile(session.user.id);
  }

  function hasFeature(featureKey: string) {
    void featureKey;
    return Boolean(user);
  }

  function canAccess(perm: PermissionKey) {
    return canAccessPerm(user, perm);
  }

  useEffect(() => {
    setRuntimeEntitlements(entitlements);
  }, [entitlements]);

  useEffect(() => {
    if (!session?.user || !user) return;
    let active = true;
    const heartbeat = async () => {
      const { data } = await registerCurrentDevice();
      const row = data as { revoked_at?: string | null } | null;
      if (active && row?.revoked_at) {
        // Global sign-out revokes refresh tokens instead of merely hiding the
        // session in this browser. Existing short-lived access tokens expire
        // according to the Supabase Auth JWT lifetime.
        await supabase.auth.signOut({ scope: 'global' });
        setUser(null);
        setSession(null);
      }
    };
    void heartbeat();
    const interval = window.setInterval(() => void heartbeat(), 60 * 1000);
    return () => { active = false; window.clearInterval(interval); };
  }, [session?.user?.id, user?.id]);

  return (
    <AuthContext.Provider value={{ session, user, entitlements, schoolOperationalStatus, loading, signIn, signOut, refreshUser, hasFeature, canAccess, isPlatformOwner: isOwner(user) }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
