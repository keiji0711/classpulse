import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  User,
  ShieldCheck,
  Info,
  FileText,
  Lock,
  Trash2,
  Mail,
  ExternalLink,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { APP_TAGLINE, APP_VERSION, CONTACT_EMAIL, ENTITY_NAME } from './legal/legalConstants';
import MfaSecurityPanel from '../components/MfaSecurityPanel';
import DeviceSessionsPanel from '../components/DeviceSessionsPanel';
import SchoolBrandingPanel from '../components/SchoolBrandingPanel';

function SettingsSection({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="glass-panel rounded-2xl p-5 space-y-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {icon}
        </span>
        <div>
          <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
          {description && <p className="text-sm text-slate-500 mt-0.5">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [address, setAddress] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);

  const [sendingReset, setSendingReset] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    setFullName(user?.full_name ?? '');
    setPhoneNumber(user?.phone_number ?? '');
    setAddress(user?.address ?? '');
  }, [user]);

  function resetNotices() {
    setError('');
    setSuccess('');
  }

  async function handleProfileSave(e: FormEvent) {
    e.preventDefault();
    if (!user) return;

    resetNotices();
    setProfileSaving(true);

    const { error: updateError } = await supabase.rpc('update_user_profile', {
      p_user_id: user.id,
      p_full_name: fullName.trim(),
      p_phone_number: phoneNumber.trim(),
      p_address: address.trim(),
      p_school_id: user.school_id,
    });

    setProfileSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await refreshUser();
    setSuccess('Profile updated successfully.');
    showToast('Profile updated successfully.');
  }

  async function handlePasswordUpdate(e: FormEvent) {
    e.preventDefault();
    resetNotices();

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }

    if (!/[A-Z]/.test(newPassword)) {
      setError('Password must contain at least one uppercase letter.');
      return;
    }

    if (!/[a-z]/.test(newPassword)) {
      setError('Password must contain at least one lowercase letter.');
      return;
    }

    if (!/[0-9]/.test(newPassword)) {
      setError('Password must contain at least one number.');
      return;
    }

    if (!/[^A-Za-z0-9]/.test(newPassword)) {
      setError('Password must contain at least one special character.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setPasswordSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });
    setPasswordSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setNewPassword('');
    setConfirmPassword('');
    setSuccess('Password changed successfully.');
    showToast('Password changed successfully.');
  }

  async function handleSendResetLink() {
    if (!user?.email) return;

    resetNotices();
    setSendingReset(true);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setSendingReset(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setSuccess('Password reset link sent to your email.');
    showToast('Password reset link sent to your email.');
  }

  async function handleSignOutAllDevices() {
    resetNotices();
    setSigningOutAll(true);

    const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' });
    setSigningOutAll(false);

    if (signOutError) {
      setError(signOutError.message);
      return;
    }

    navigate('/login');
  }

  async function requestAccountDeletion() {
    const reason = prompt('Why are you requesting account deletion? Please provide at least 10 characters.');
    if (reason === null) return;
    const { error: requestError } = await supabase.rpc('request_own_account_deletion', { p_reason: reason });
    if (requestError) showToast(requestError.message, 'error');
    else showToast('Deletion request submitted for owner review. No data has been deleted yet.', 'warning');
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Settings</h2>
        <p className="text-sm text-slate-500 mt-1">Manage account identity, access, and security controls.</p>
      </div>

      {(error || success) && (
        <div className={`rounded-lg px-4 py-3 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {error || success}
        </div>
      )}

      {user?.role === 'school_admin' && <SchoolBrandingPanel />}

      <SettingsSection
        icon={<User size={18} />}
        title="Profile"
        description="Your personal details shown across ClassPulse."
      >
        <form onSubmit={handleProfileSave} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-300/80 rounded-xl focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
              placeholder="Your full name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              value={user?.email ?? ''}
              disabled
              className="w-full px-4 py-2.5 border border-slate-200 bg-slate-50 rounded-xl text-slate-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number</label>
            <input
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-300/80 rounded-xl focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
              placeholder="09xx xxx xxxx"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-300/80 rounded-xl focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
              placeholder="City / Province"
            />
          </div>

          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={profileSaving}
              className="bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50 shadow-lg shadow-primary/20"
            >
              {profileSaving ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </form>
      </SettingsSection>

      <SettingsSection
        icon={<ShieldCheck size={18} />}
        title="Security"
        description="Update your password and manage active sessions."
      >
        {user && ['super_admin', 'school_admin'].includes(user.role) && <MfaSecurityPanel />}

        <form onSubmit={handlePasswordUpdate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-300/80 rounded-xl focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
              placeholder="Min 8 chars, upper, lower, number, symbol"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-300/80 rounded-xl focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
              placeholder="Re-enter new password"
            />
          </div>

          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={passwordSaving}
              className="bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
            >
              {passwordSaving ? 'Updating...' : 'Change Password'}
            </button>
          </div>
        </form>

        <div className="border-t border-slate-200 pt-5 flex flex-wrap gap-3 items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-700">Forgot password?</p>
            <p className="text-xs text-slate-500 mt-1">Send a secure reset link to your email address.</p>
          </div>
          <button
            onClick={handleSendResetLink}
            disabled={sendingReset}
            className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {sendingReset ? 'Sending...' : 'Send Reset Link'}
          </button>
        </div>

        <div className="border-t border-slate-200 pt-5 flex flex-wrap gap-3 items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-700">Sign out on all devices</p>
            <p className="text-xs text-slate-500 mt-1">Force logout for every active session.</p>
          </div>
          <button
            onClick={handleSignOutAllDevices}
            disabled={signingOutAll}
            className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
          >
            {signingOutAll ? 'Signing out...' : 'Sign Out All'}
          </button>
        </div>

        <div className="border-t border-slate-200 pt-5">
          <div className="mb-3"><p className="text-sm font-medium text-slate-700">Active devices</p><p className="mt-1 text-xs text-slate-500">Review recent account activity and revoke devices you no longer recognize.</p></div>
          <DeviceSessionsPanel />
        </div>
      </SettingsSection>

      <SettingsSection
        icon={<Info size={18} />}
        title="About & Legal"
        description="App information, policies, and support."
      >
        <div className="flex items-center gap-3 rounded-xl bg-slate-50 border border-slate-200/80 p-4">
          <img src="/classPulseLogo.png" alt="ClassPulse" className="h-12 w-12 rounded-xl" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800">
              {ENTITY_NAME} <span className="text-slate-400 font-normal">v{APP_VERSION}</span>
            </p>
            <p className="text-xs text-slate-500 mt-0.5">{APP_TAGLINE}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <LegalLink to="/terms" icon={<FileText size={18} />} label="Terms of Service" hint="How you may use ClassPulse" />
          <LegalLink to="/privacy" icon={<Lock size={18} />} label="Privacy Policy" hint="How we handle your data" />
          <LegalLink to="/delete-account" icon={<Trash2 size={18} />} label="Delete Account & Data" hint="Request removal of your account" />
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="group flex items-center gap-3 rounded-xl border border-slate-200/80 p-4 hover:border-primary/50 hover:bg-primary/5 transition-colors"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 group-hover:bg-primary/10 group-hover:text-primary">
              <Mail size={18} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-800">Contact Support</span>
              <span className="block text-xs text-slate-500 truncate">{CONTACT_EMAIL}</span>
            </span>
          </a>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/50 p-4">
          <div><p className="text-sm font-semibold text-slate-800">Submit a deletion request</p><p className="mt-1 text-xs text-slate-500">Creates a tracked request for review. Your account and records are not deleted immediately.</p></div>
          <button onClick={() => void requestAccountDeletion()} className="rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-600">Request deletion</button>
        </div>

        <p className="text-xs text-slate-400 text-center pt-1">
          &copy; {new Date().getFullYear()} {ENTITY_NAME}. All rights reserved.
        </p>
      </SettingsSection>
    </div>
  );
}

function LegalLink({
  to,
  icon,
  label,
  hint,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <Link
      to={to}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-3 rounded-xl border border-slate-200/80 p-4 hover:border-primary/50 hover:bg-primary/5 transition-colors"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 group-hover:bg-primary/10 group-hover:text-primary">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="block text-xs text-slate-500 truncate">{hint}</span>
      </span>
      <ExternalLink size={15} className="shrink-0 text-slate-300 group-hover:text-primary" />
    </Link>
  );
}
