import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { UserRole } from '../types';
import { supabase } from '../lib/supabase';

interface Props {
  children: React.ReactNode;
  allowedRoles: UserRole[];
}

export default function ProtectedRoute({ children, allowedRoles }: Props) {
  const { user, loading, schoolOperationalStatus, signOut } = useAuth();
  const [mfaState, setMfaState] = useState<'checking' | 'ok' | 'required'>('checking');

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!user || !['super_admin', 'school_admin'].includes(user.role)) {
        if (active) setMfaState('ok');
        return;
      }
      const [{ data: profile }, { data: aal }] = await Promise.all([
        supabase.from('admin_security_profiles').select('mfa_required, mfa_enrolled').eq('user_id', user.id).maybeSingle(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);
      const enrolled = profile?.mfa_enrolled || aal?.nextLevel === 'aal2';
      const required = Boolean(profile?.mfa_required || enrolled);
      if (active) setMfaState(required && aal?.currentLevel !== 'aal2' ? 'required' : 'ok');
    })();
    return () => { active = false; };
  }, [user]);

  if (loading || (user && ['super_admin', 'school_admin'].includes(user.role) && mfaState === 'checking')) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!allowedRoles.includes(user.role)) {
    const redirectMap: Record<UserRole, string> = {
      super_admin: '/super-admin',
      school_admin: '/admin',
      instructor: '/instructor',
    };
    return <Navigate to={redirectMap[user.role]} replace />;
  }

  if (mfaState === 'required') {
    return <Navigate to="/mfa" replace />;
  }

  if (user.role !== 'super_admin' && ['suspended', 'archived', 'inactive'].includes(schoolOperationalStatus ?? '')) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6"><div className="max-w-md rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm"><h1 className="text-xl font-bold text-slate-900">School access is temporarily unavailable</h1><p className="mt-2 text-sm text-slate-600">Your school's ClassPulse workspace is {schoolOperationalStatus}. Contact your school administrator or ClassPulse support for assistance.</p><button onClick={() => void signOut()} className="mt-5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white">Sign out</button></div></div>;
  }

  return <>{children}</>;
}
