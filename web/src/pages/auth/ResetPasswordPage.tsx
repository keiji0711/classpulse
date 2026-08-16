import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess('Password reset successful. Redirecting to login...');
    setTimeout(() => navigate('/login'), 1500);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 app-grid">
      <div className="w-full max-w-md glass-panel rounded-3xl p-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Reset Password</h1>
        <p className="text-sm text-slate-500 mb-6">Set a new password for your account.</p>

        {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>}
        {success && <div className="bg-green-50 text-green-700 text-sm rounded-lg px-4 py-3 mb-4">{success}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-300/80 rounded-xl focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
              placeholder="Minimum 8 characters"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-300/80 rounded-xl focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
              placeholder="Re-enter password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary hover:bg-primary-dark text-white py-2.5 rounded-xl font-semibold disabled:opacity-50 shadow-lg shadow-primary/20"
          >
            {loading ? 'Updating...' : 'Update Password'}
          </button>
        </form>

        <p className="text-center text-sm text-slate-500 mt-4">
          <Link to="/login" className="text-secondary hover:text-primary font-medium">Back to Sign In</Link>
        </p>
      </div>
    </div>
  );
}
