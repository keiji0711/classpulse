import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import type { UserRole } from '../../types';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);

    const { error } = await signIn(email, password);
    if (error) {
      setError(error);
      setLoading(false);
      return;
    }

    // Fetch user role to redirect
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (authUser) {
      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('role')
        .eq('id', authUser.id)
        .single();

      if (profileError || !profile) {
        await supabase.auth.signOut();
        setError('Account not fully set up. Contact your administrator.');
        setLoading(false);
        return;
      }

      const redirectMap: Record<UserRole, string> = {
        super_admin: '/super-admin',
        school_admin: '/admin',
        instructor: '/instructor',
      };

      if (profile?.role) {
        navigate(redirectMap[profile.role as UserRole]);
      }
    }
    setLoading(false);
  }

  async function handleForgotPassword() {
    setError('');
    setNotice('');

    if (!email.trim()) {
      setError('Enter your email first, then click Forgot password.');
      return;
    }

    setSendingReset(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSendingReset(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setNotice('Password reset link sent. Check your email inbox.');
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 app-grid">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-1">
            <div className="brand-logo-shell w-14 h-14 rounded-2xl flex items-center justify-center shrink-0">
              <img src="/classPulseLogo.png" alt="ClassPulse" className="brand-logo-image" />
            </div>
            <h1 className="text-3xl font-bold text-slate-900">Class<span className="text-primary">Pulse</span></h1>
          </div>
          <p className="text-slate-500 mt-2">Professional multi-school operations platform</p>
        </div>

        <div className="glass-panel rounded-3xl p-8">
          <h2 className="text-xl font-semibold text-slate-800 mb-1">Welcome back</h2>
          <p className="text-sm text-slate-500 mb-6">Sign in to continue managing your campus workflow.</p>

          {error && (
            <div className="bg-red-50 text-red-600 rounded-lg p-3 mb-4 text-sm">
              {error}
            </div>
          )}

          {notice && (
            <div className="bg-green-50 text-green-700 rounded-lg p-3 mb-4 text-sm">
              {notice}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300/80 rounded-xl focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none transition-colors bg-white"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300/80 rounded-xl focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none transition-colors bg-white"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={sendingReset}
                className="mt-2 text-xs text-secondary hover:text-primary disabled:opacity-50"
              >
                {sendingReset ? 'Sending reset link...' : 'Forgot password?'}
              </button>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary hover:bg-primary-dark text-white py-2.5 rounded-xl font-semibold transition-colors disabled:opacity-50 cursor-pointer shadow-lg shadow-primary/20"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <p className="text-center text-sm text-slate-500 mt-4">
            <Link to="/" className="text-secondary hover:text-primary font-medium">&larr; Back to Home</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
