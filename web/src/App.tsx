import { Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AcademicYearProvider } from './contexts/AcademicYearContext';
import ProtectedRoute from './components/ProtectedRoute';
import DashboardLayout from './components/DashboardLayout';
import ClientErrorReporter from './components/ClientErrorReporter';
import RouteErrorBoundary from './components/RouteErrorBoundary';
import { lazyWithRetry } from './lib/lazyWithRetry';

const LoginPage = lazyWithRetry(() => import('./pages/auth/LoginPage'));
const ResetPasswordPage = lazyWithRetry(() => import('./pages/auth/ResetPasswordPage'));
const MfaChallengePage = lazyWithRetry(() => import('./pages/auth/MfaChallengePage'));
const LandingPage = lazyWithRetry(() => import('./pages/LandingPage'));
const SettingsPage = lazyWithRetry(() => import('./pages/SettingsPage'));

// Public legal pages (required URLs for Google Play)
const PrivacyPolicyPage = lazyWithRetry(() => import('./pages/legal/PrivacyPolicyPage'));
const TermsPage = lazyWithRetry(() => import('./pages/legal/TermsPage'));
const DeleteAccountPage = lazyWithRetry(() => import('./pages/legal/DeleteAccountPage'));

// Super Admin
const SuperAdminDashboard = lazyWithRetry(() => import('./pages/super-admin/Dashboard'));
const SchoolsPage = lazyWithRetry(() => import('./pages/super-admin/SchoolsPage'));
const SchoolAdminsPage = lazyWithRetry(() => import('./pages/super-admin/SchoolAdminsPage'));
const SupportInboxPage = lazyWithRetry(() => import('./pages/super-admin/SupportInboxPage'));
const StaffPage = lazyWithRetry(() => import('./pages/super-admin/StaffPage'));
const AuditLogPage = lazyWithRetry(() => import('./pages/super-admin/AuditLogPage'));
const PlatformOperationsPage = lazyWithRetry(() => import('./pages/super-admin/PlatformOperationsPage'));
const ParentRevenuePage = lazyWithRetry(() => import('./pages/super-admin/ParentRevenuePage'));
const SecurityReliabilityPage = lazyWithRetry(() => import('./pages/super-admin/SecurityReliabilityPage'));
const LearnerAssessmentMonitorPage = lazyWithRetry(() => import('./pages/super-admin/LearnerAssessmentMonitorPage'));

// School Admin
const AdminDashboard = lazyWithRetry(() => import('./pages/admin/Dashboard'));
const InstructorsPage = lazyWithRetry(() => import('./pages/admin/InstructorsPage'));
const SectionsPage = lazyWithRetry(() => import('./pages/admin/SectionsPage'));
const SubjectsPage = lazyWithRetry(() => import('./pages/admin/SubjectsPage'));
const StudentsPage = lazyWithRetry(() => import('./pages/admin/StudentsPage'));
const SchedulesPage = lazyWithRetry(() => import('./pages/admin/SchedulesPage'));
const StrandsPage = lazyWithRetry(() => import('./pages/admin/StrandsPage'));
const AttendanceReportsPage = lazyWithRetry(() => import('./pages/admin/AttendanceReportsPage'));
const GradesOverviewPage = lazyWithRetry(() => import('./pages/admin/GradesOverviewPage'));
const ExamScoresOverviewPage = lazyWithRetry(() => import('./pages/admin/ExamScoresOverviewPage'));
const StudentAnalyticsPage = lazyWithRetry(() => import('./pages/admin/StudentAnalyticsPage'));
const SchoolAnalyticsDashboard = lazyWithRetry(() => import('./pages/admin/SchoolAnalyticsDashboard'));
const AcademicYearsPage = lazyWithRetry(() => import('./pages/admin/AcademicYearsPage'));
const YearEndWorkflowPage = lazyWithRetry(() => import('./pages/admin/YearEndWorkflowPage'));
const AdminSupportPage = lazyWithRetry(() => import('./pages/admin/SupportPage'));
const ParentCollectionsPage = lazyWithRetry(() => import('./pages/admin/ParentCollectionsPage'));
const AdminLearnerAssessmentMonitorPage = lazyWithRetry(() => import('./pages/admin/LearnerAssessmentMonitorPage'));

// Instructor
const MySchedulePage = lazyWithRetry(() => import('./pages/instructor/MySchedulePage'));
const TakeAttendancePage = lazyWithRetry(() => import('./pages/instructor/TakeAttendancePage'));
const AttendanceHistoryPage = lazyWithRetry(() => import('./pages/instructor/AttendanceHistoryPage'));
const GradesPage = lazyWithRetry(() => import('./pages/instructor/GradesPage'));
const ExamScoresPage = lazyWithRetry(() => import('./pages/instructor/ExamScoresPage'));
const InstructorStudentAnalyticsPage = lazyWithRetry(() => import('./pages/instructor/StudentAnalyticsPage'));
const MyStudentsPage = lazyWithRetry(() => import('./pages/instructor/MyStudentsPage'));
const LearnerAssessmentsPage = lazyWithRetry(() => import('./pages/instructor/LearnerAssessmentsPage'));

const instructorPages = {
  schedule: MySchedulePage,
  attendance: TakeAttendancePage,
  grades: GradesPage,
  'exam-scores': ExamScoresPage,
  history: AttendanceHistoryPage,
  analytics: InstructorStudentAnalyticsPage,
  students: MyStudentsPage,
  assessments: LearnerAssessmentsPage,
  settings: SettingsPage,
} as const;

type InstructorPageKey = keyof typeof instructorPages;

function InstructorWorkspace() {
  const location = useLocation();
  const routeKey = location.pathname.replace(/^\/instructor\/?/, '') || 'schedule';
  const activeKey: InstructorPageKey = routeKey in instructorPages
    ? routeKey as InstructorPageKey
    : 'schedule';
  const [visitedPages, setVisitedPages] = useState<Set<InstructorPageKey>>(
    () => new Set([activeKey]),
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setVisitedPages((current) => {
        if (current.has(activeKey)) return current;
        const next = new Set(current);
        next.add(activeKey);
        return next;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeKey]);

  return (
    <>
      {(Object.entries(instructorPages) as [InstructorPageKey, React.ComponentType][]).map(
        ([key, Page]) => {
          if (!visitedPages.has(key) && key !== activeKey) return null;
          return (
            <div key={key} className={key === activeKey ? 'block' : 'hidden'} aria-hidden={key !== activeKey}>
              <Page />
            </div>
          );
        },
      )}
    </>
  );
}

import {
  Building2,
  LayoutDashboard,
  Users,
  BookOpen,
  BookOpenCheck,
  GraduationCap,
  Calendar,
  ClipboardCheck,
  BarChart3,
  School,
  Layers,
  Trophy,
  Activity,
  PieChart,
  Settings,
  CalendarRange,
  ClipboardList,
  Inbox,
  LifeBuoy,
  ShieldCheck,
  ScrollText,
  HeartPulse,
  Banknote,
} from 'lucide-react';
import type { PermissionKey } from './lib/permissions';

function RouteFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
    </div>
  );
}

function RequirePermission({ perm, children }: { perm: PermissionKey; children: React.ReactNode }) {
  const { canAccess } = useAuth();
  if (!canAccess(perm)) {
    return (
      <div className="max-w-md mx-auto mt-16 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-rose-50 text-rose-500 mb-4">
          <ShieldCheck size={26} />
        </div>
        <h3 className="text-lg font-bold text-slate-800">No access to this section</h3>
        <p className="text-sm text-slate-500 mt-1">Your account doesn't have permission to view this. Ask a platform owner to grant it under Staff &amp; Access.</p>
      </div>
    );
  }
  return <>{children}</>;
}

function AppRoutes() {
  const { user, loading, canAccess } = useAuth();

  if (loading) {
    return <RouteFallback />;
  }

  const superAdminNav = [
    { group: 'Overview', label: 'Dashboard', to: '/super-admin', icon: <LayoutDashboard size={18} /> },
    ...(canAccess('schools') ? [{ group: 'Schools & Learning', label: 'Schools', to: '/super-admin/schools', icon: <Building2 size={18} /> }] : []),
    ...(canAccess('school_admins') ? [{ group: 'Schools & Learning', label: 'School Admins', to: '/super-admin/school-admins', icon: <School size={18} /> }] : []),
    ...(canAccess('operations') ? [{ group: 'Schools & Learning', label: 'Learner Assessments', to: '/super-admin/learner-assessments', icon: <BookOpenCheck size={18} /> }] : []),
    ...(canAccess('operations') ? [{ group: 'Operations', label: 'Platform Operations', to: '/super-admin/operations', icon: <HeartPulse size={18} /> }] : []),
    ...(canAccess('operations') ? [{ group: 'Operations', label: 'Security & Reliability', to: '/super-admin/security-reliability', icon: <ShieldCheck size={18} /> }] : []),
    ...(canAccess('support') ? [{ group: 'Operations', label: 'Support', to: '/super-admin/support', icon: <Inbox size={18} /> }] : []),
    ...(canAccess('operations') ? [{ group: 'Finance', label: 'Parent Revenue', to: '/super-admin/parent-revenue', icon: <Banknote size={18} /> }] : []),
    ...(canAccess('staff') ? [{ group: 'Administration', label: 'Staff & Access', to: '/super-admin/staff', icon: <ShieldCheck size={18} /> }] : []),
    ...(canAccess('audit') ? [{ group: 'Administration', label: 'Audit Log', to: '/super-admin/audit', icon: <ScrollText size={18} /> }] : []),
    { group: 'Administration', label: 'Settings', to: '/super-admin/settings', icon: <Settings size={18} /> },
  ];

  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route path="/" element={user ? <RoleRedirect /> : <LandingPage />} />
      <Route path="/login" element={user ? <RoleRedirect /> : <LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/mfa" element={<MfaChallengePage />} />

      {/* Public legal pages — must stay accessible without auth for Google Play */}
      <Route path="/privacy" element={<PrivacyPolicyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/delete-account" element={<DeleteAccountPage />} />

      {/* Super Admin */}
      <Route
        path="/super-admin"
        element={
          <ProtectedRoute allowedRoles={['super_admin']}>
            <DashboardLayout title="ClassPulse Admin" navItems={superAdminNav} accordionNav />
          </ProtectedRoute>
        }
      >
        <Route index element={<SuperAdminDashboard />} />
        <Route path="schools" element={<RequirePermission perm="schools"><SchoolsPage /></RequirePermission>} />
        <Route path="operations" element={<RequirePermission perm="operations"><PlatformOperationsPage /></RequirePermission>} />
        <Route path="security-reliability" element={<RequirePermission perm="operations"><SecurityReliabilityPage /></RequirePermission>} />
        <Route path="learner-assessments" element={<RequirePermission perm="operations"><LearnerAssessmentMonitorPage /></RequirePermission>} />
        <Route path="parent-revenue" element={<RequirePermission perm="operations"><ParentRevenuePage /></RequirePermission>} />
        <Route path="school-admins" element={<RequirePermission perm="school_admins"><SchoolAdminsPage /></RequirePermission>} />
        <Route path="support" element={<RequirePermission perm="support"><SupportInboxPage /></RequirePermission>} />
        <Route path="staff" element={<RequirePermission perm="staff"><StaffPage /></RequirePermission>} />
        <Route path="audit" element={<RequirePermission perm="audit"><AuditLogPage /></RequirePermission>} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      {/* School Admin */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRoles={['school_admin']}>
            <DashboardLayout
              title="ClassPulse"
              navItems={[
                { group: 'Overview', label: 'Dashboard', to: '/admin', icon: <LayoutDashboard size={18} /> },
                { group: 'School Management', label: 'Academic Years', to: '/admin/academic-years', icon: <CalendarRange size={18} /> },
                { group: 'School Management', label: 'Teachers', to: '/admin/instructors', icon: <Users size={18} /> },
                { group: 'School Management', label: 'Students', to: '/admin/students', icon: <GraduationCap size={18} /> },
                { group: 'School Management', label: 'Sections', to: '/admin/sections', icon: <Calendar size={18} /> },
                { group: 'School Management', label: 'Strands', to: '/admin/strands', icon: <Layers size={18} /> },
                { group: 'School Management', label: 'Subjects', to: '/admin/subjects', icon: <BookOpen size={18} /> },
                { group: 'School Management', label: 'Schedules', to: '/admin/schedules', icon: <Calendar size={18} /> },
                { group: 'Academic Records', label: 'Attendance Reports', to: '/admin/attendance', icon: <BarChart3 size={18} /> },
                { group: 'Academic Records', label: 'Grades Overview', to: '/admin/grades', icon: <Trophy size={18} /> },
                { group: 'Academic Records', label: 'Exam Scores / MPS', to: '/admin/exam-scores', icon: <ClipboardList size={18} /> },
                { group: 'Academic Records', label: 'Learner Assessments', to: '/admin/learner-assessments', icon: <BookOpenCheck size={18} /> },
                { group: 'Insights', label: 'Student Analytics', to: '/admin/analytics', icon: <Activity size={18} /> },
                { group: 'Insights', label: 'School Analytics', to: '/admin/school-analytics', icon: <PieChart size={18} /> },
                { group: 'Finance', label: 'Parent Collections', to: '/admin/parent-collections', icon: <Banknote size={18} /> },
                { group: 'Administration', label: 'Year-End Workflow', to: '/admin/year-end', icon: <ClipboardCheck size={18} /> },
                { group: 'Administration', label: 'Help & Support', to: '/admin/support', icon: <LifeBuoy size={18} /> },
                { group: 'Administration', label: 'Settings', to: '/admin/settings', icon: <Settings size={18} /> },
              ]}
            />
          </ProtectedRoute>
        }
      >
        <Route index element={<AdminDashboard />} />
        <Route path="academic-years" element={<AcademicYearsPage />} />
        <Route path="year-end" element={<YearEndWorkflowPage />} />
        <Route path="instructors" element={<InstructorsPage />} />
        <Route path="sections" element={<SectionsPage />} />
        <Route path="strands" element={<StrandsPage />} />
        <Route path="subjects" element={<SubjectsPage />} />
        <Route path="students" element={<StudentsPage />} />
        <Route path="schedules" element={<SchedulesPage />} />
        <Route path="attendance" element={<AttendanceReportsPage />} />
        <Route path="parent-collections" element={<ParentCollectionsPage />} />
        <Route path="grades" element={<GradesOverviewPage />} />
        <Route path="exam-scores" element={<ExamScoresOverviewPage />} />
        <Route path="learner-assessments" element={<AdminLearnerAssessmentMonitorPage />} />
        <Route path="analytics" element={<StudentAnalyticsPage />} />
        <Route path="school-analytics" element={<SchoolAnalyticsDashboard />} />
        <Route path="support" element={<AdminSupportPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      {/* Instructor */}
      <Route
        path="/instructor/*"
        element={
          <ProtectedRoute allowedRoles={['instructor']}>
            <DashboardLayout
              title="ClassPulse"
              navItems={[
                { label: 'My Schedule', to: '/instructor', icon: <Calendar size={18} /> },
                { label: 'Take Attendance', to: '/instructor/attendance', icon: <ClipboardCheck size={18} /> },
                { label: 'Grades', to: '/instructor/grades', icon: <Trophy size={18} /> },
                { label: 'Exam Scores', to: '/instructor/exam-scores', icon: <ClipboardList size={18} /> },
                { label: 'History', to: '/instructor/history', icon: <BarChart3 size={18} /> },
                { label: 'Student Analytics', to: '/instructor/analytics', icon: <Activity size={18} /> },
                { label: 'My Students', to: '/instructor/students', icon: <GraduationCap size={18} /> },
                { label: 'Learner Assessments', to: '/instructor/assessments', icon: <BookOpenCheck size={18} /> },
                { label: 'Settings', to: '/instructor/settings', icon: <Settings size={18} /> },
              ]}
              content={<InstructorWorkspace />}
            />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}

function RoleRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const map = { super_admin: '/super-admin', school_admin: '/admin', instructor: '/instructor' };
  return <Navigate to={map[user.role]} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ClientErrorReporter />
        <AcademicYearProvider>
          <RouteErrorBoundary>
            <AppRoutes />
          </RouteErrorBoundary>
        </AcademicYearProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
