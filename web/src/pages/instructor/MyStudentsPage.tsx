import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, BookOpen, CalendarClock, CheckCircle2, FileSpreadsheet, Megaphone, Search, Send, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear } from '../../contexts/AcademicYearContext';
import { useToast } from '../../contexts/ToastContext';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import type { Section, Student, Strand } from '../../types';
import Sf1ImportModal from '../../components/Sf1ImportModal';
import ManualStudentModal from '../../components/ManualStudentModal';

type AdvisorySection = Section & { strand?: Strand | null };

type AdvisoryStudent = Student & {
  section?: AdvisorySection;
  parents?: {
    guardian_name: string;
    phone_number: string;
  }[];
};

type EnrollmentRow = {
  section_id: string;
  student: AdvisoryStudent | AdvisoryStudent[];
  section: AdvisorySection | AdvisorySection[];
};

type AnnouncementType = 'general' | 'meeting' | 'reminder' | 'urgent';

type MonthlyPayment = {
  id: string;
  student_id: string;
  billing_month: string;
  status: 'paid' | 'waived' | 'refunded';
  amount_due: number;
  amount_paid: number;
  collected_at: string | null;
  remittance_status: 'pending' | 'submitted' | 'verified';
};

function currentBillingMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

const BILLING_MONTH = currentBillingMonth();
const BILLING_MONTH_LABEL = new Date(`${BILLING_MONTH}T00:00:00`).toLocaleDateString('en-PH', {
  month: 'long',
  year: 'numeric',
});

export default function MyStudentsPage() {
  const { user } = useAuth();
  const { activeYear, canWriteToActiveYear } = useAcademicYear();
  const { showToast } = useToast();
  const userId = user?.id;
  const schoolId = user?.school_id;
  const activeYearId = activeYear?.id;
  const [sections, setSections] = useState<AdvisorySection[]>([]);
  const [students, setStudents] = useState<AdvisoryStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [accessPreferences, setAccessPreferences] = useState<Record<string, boolean>>({});
  const [monthlyPayments, setMonthlyPayments] = useState<Record<string, MonthlyPayment>>({});
  const [monthlyPrice, setMonthlyPrice] = useState(20);
  const [graceDays, setGraceDays] = useState(5);
  const [billingEnabled, setBillingEnabled] = useState(true);
  const [updatingAccess, setUpdatingAccess] = useState<Set<string>>(new Set());
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [announcementTarget, setAnnouncementTarget] = useState('all');
  const [announcementType, setAnnouncementType] = useState<AnnouncementType>('general');
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementMessage, setAnnouncementMessage] = useState('');
  const [announcementEventAt, setAnnouncementEventAt] = useState('');
  const [sendingAnnouncement, setSendingAnnouncement] = useState(false);
  const [showSf1Import, setShowSf1Import] = useState(false);
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [googlePlayStudentIds, setGooglePlayStudentIds] = useState<Set<string>>(new Set());

  const loadAccessPreferences = useCallback(async (studentIds: string[]) => {
    const preferences = Object.fromEntries(studentIds.map((studentId) => [studentId, true]));
    if (studentIds.length > 0) {
      const [preferencesResult, paymentsResult, settingsResult, googlePlayResult] = await Promise.all([
        supabase
          .from('student_notification_preferences')
          .select('student_id, enabled')
          .in('student_id', studentIds),
        supabase
          .from('parent_access_payments')
          .select('id, student_id, billing_month, status, amount_due, amount_paid, collected_at, remittance_status')
          .eq('billing_month', BILLING_MONTH)
          .in('student_id', studentIds),
        supabase
          .from('parent_access_billing_settings')
          .select('monthly_price, grace_days, billing_enabled')
          .eq('school_id', schoolId!)
          .maybeSingle(),
        supabase.rpc('get_adviser_google_play_access'),
      ]);

      if (preferencesResult.error) throw preferencesResult.error;
      if (paymentsResult.error) throw paymentsResult.error;
      if (settingsResult.error) throw settingsResult.error;
      if (googlePlayResult.error) throw googlePlayResult.error;
      for (const preference of preferencesResult.data ?? []) {
        preferences[preference.student_id] = preference.enabled;
      }
      setMonthlyPayments(Object.fromEntries(
        ((paymentsResult.data ?? []) as MonthlyPayment[]).map((payment) => [payment.student_id, payment]),
      ));
      if (settingsResult.data) {
        setMonthlyPrice(Number(settingsResult.data.monthly_price));
        setGraceDays(settingsResult.data.grace_days);
        setBillingEnabled(settingsResult.data.billing_enabled);
      }
      setGooglePlayStudentIds(new Set(
        ((googlePlayResult.data ?? []) as { student_id: string }[])
          .map((row) => row.student_id)
          .filter((studentId) => studentIds.includes(studentId)),
      ));
    } else {
      setMonthlyPayments({});
      setGooglePlayStudentIds(new Set());
    }
    setAccessPreferences(preferences);
  }, [schoolId]);

  const fetchStudents = useCallback(async () => {
    if (!userId || !schoolId) return;

    setError('');
    try {
      const sectionsResult = await supabase
        .from('sections')
        .select('*, strand:strands(*)')
        .eq('school_id', schoolId)
        .eq('adviser_id', userId)
        .order('grade_level')
        .order('name');

      if (sectionsResult.error) throw sectionsResult.error;

      const advisorySections = (sectionsResult.data ?? []) as AdvisorySection[];
      setSections(advisorySections);

      const sectionIds = advisorySections.map((section) => section.id);
      if (sectionIds.length === 0) {
        setStudents([]);
        setAccessPreferences({});
        return;
      }

      if (activeYearId) {
        const enrollmentsResult = await supabase
          .from('student_enrollments')
          .select(`
            section_id,
            student:students!inner(
              id,
              school_id,
              section_id,
              lrn,
              first_name,
              middle_name,
              last_name,
              created_at,
              parents(guardian_name, phone_number)
            ),
            section:sections!inner(*, strand:strands(*))
          `)
          .eq('school_id', schoolId)
          .eq('academic_year_id', activeYearId)
          .in('section_id', sectionIds);

        if (enrollmentsResult.error) throw enrollmentsResult.error;

        const enrolledStudents = ((enrollmentsResult.data ?? []) as unknown as EnrollmentRow[]).map((enrollment) => {
          const student = Array.isArray(enrollment.student) ? enrollment.student[0] : enrollment.student;
          const section = Array.isArray(enrollment.section) ? enrollment.section[0] : enrollment.section;
          return {
            ...student,
            section_id: enrollment.section_id,
            section,
            parents: student?.parents ?? [],
          };
        }) as AdvisoryStudent[];

        enrolledStudents.sort((a, b) =>
          a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)
        );
        setStudents(enrolledStudents);
        await loadAccessPreferences(enrolledStudents.map((student) => student.id));
      } else {
        const studentsResult = await supabase
          .from('students')
          .select('*, section:sections(*, strand:strands(*)), parents(guardian_name, phone_number)')
          .eq('school_id', schoolId)
          .in('section_id', sectionIds)
          .order('last_name')
          .order('first_name');

        if (studentsResult.error) throw studentsResult.error;
        const advisoryStudents = (studentsResult.data ?? []) as AdvisoryStudent[];
        setStudents(advisoryStudents);
        await loadAccessPreferences(advisoryStudents.map((student) => student.id));
      }
    } catch (fetchError: unknown) {
      console.error('Failed to load advisory students', fetchError);
      setError(fetchError instanceof Error ? fetchError.message : 'Unable to load your students right now.');
    } finally {
      setLoading(false);
    }
  }, [activeYearId, loadAccessPreferences, schoolId, userId]);

  useEffect(() => {
    setLoading(true);
    void fetchStudents();
  }, [fetchStudents]);

  useRealtimeRefresh(
    ['sections', 'students', 'parents', 'student_enrollments', 'student_notification_preferences', 'parent_access_payments'],
    fetchStudents,
    { column: 'school_id', value: schoolId },
  );

  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return students;

    return students.filter((student) => {
      const fullName = `${student.first_name} ${student.middle_name ?? ''} ${student.last_name}`.toLowerCase();
      const sectionName = `${student.section?.grade_level ?? ''} ${student.section?.name ?? ''}`.toLowerCase();
      const guardian = student.parents?.[0]?.guardian_name?.toLowerCase() ?? '';
      return fullName.includes(query)
        || student.lrn.toLowerCase().includes(query)
        || sectionName.includes(query)
        || guardian.includes(query);
    });
  }, [search, students]);

  function accessIsActive(studentId: string) {
    if ((accessPreferences[studentId] ?? true) === false) return false;
    if (googlePlayStudentIds.has(studentId)) return true;
    if (!billingEnabled) return true;
    const payment = monthlyPayments[studentId];
    if (payment?.status === 'paid' || payment?.status === 'waived') return true;
    if (payment?.status === 'refunded') return false;
    return new Date().getDate() <= graceDays;
  }

  async function recordAccess(studentId: string, action: 'paid' | 'waived') {
    if (!schoolId || !userId || updatingAccess.has(studentId)) return;
    setUpdatingAccess((current) => new Set(current).add(studentId));

    const { error: updateError } = await supabase.rpc('record_parent_access_payment', {
      p_student_id: studentId,
      p_billing_month: BILLING_MONTH,
      p_action: action,
      p_amount: action === 'paid' ? monthlyPrice : 0,
      p_payment_reference: null,
      p_notes: action === 'waived' ? 'Waived by adviser' : null,
    });

    setUpdatingAccess((current) => {
      const next = new Set(current);
      next.delete(studentId);
      return next;
    });

    if (updateError) {
      showToast(updateError.message || 'Could not record the monthly access payment.', 'error');
      return;
    }

    await loadAccessPreferences(students.map((student) => student.id));
    showToast(action === 'paid'
      ? `Payment recorded. Parent access is active for ${BILLING_MONTH_LABEL}.`
      : `Payment waived. Parent access is active for ${BILLING_MONTH_LABEL}.`);
  }

  const paidCount = students.filter((student) => monthlyPayments[student.id]?.status === 'paid').length;
  const waivedCount = students.filter((student) => monthlyPayments[student.id]?.status === 'waived').length;
  const googlePlayCount = students.filter((student) => googlePlayStudentIds.has(student.id)).length;
  const activatedStudentIds = new Set(students.filter((student) => {
    const payment = monthlyPayments[student.id];
    return googlePlayStudentIds.has(student.id) || payment?.status === 'paid' || payment?.status === 'waived';
  }).map((student) => student.id));
  const collectedAmount = students.reduce(
    (sum, student) => sum + Number(monthlyPayments[student.id]?.status === 'paid' ? monthlyPayments[student.id].amount_paid : 0),
    0,
  );

  function closeAnnouncement() {
    if (sendingAnnouncement) return;
    setShowAnnouncement(false);
    setAnnouncementTarget('all');
    setAnnouncementType('general');
    setAnnouncementTitle('');
    setAnnouncementMessage('');
    setAnnouncementEventAt('');
  }

  async function sendAnnouncement() {
    const title = announcementTitle.trim();
    const message = announcementMessage.trim();
    if (!title || !message) {
      showToast('Enter an announcement title and message.', 'error');
      return;
    }
    if (announcementType === 'meeting' && !announcementEventAt) {
      showToast('Select the meeting date and time.', 'error');
      return;
    }

    const sectionIds = announcementTarget === 'all'
      ? sections.map((section) => section.id)
      : [announcementTarget];
    if (sectionIds.length === 0) return;

    setSendingAnnouncement(true);
    const { data, error: announcementError } = await supabase.functions.invoke(
      'send-adviser-announcement',
      {
        body: {
          section_ids: sectionIds,
          academic_year_id: activeYearId ?? null,
          announcement_type: announcementType,
          title,
          message,
          event_at: announcementEventAt ? new Date(announcementEventAt).toISOString() : null,
        },
      },
    );
    setSendingAnnouncement(false);

    if (announcementError || !data?.success) {
      showToast(data?.error ?? announcementError?.message ?? 'Could not send the announcement.', 'error');
      return;
    }

    showToast(
      `Announcement sent to ${data.recipients} ${data.recipients === 1 ? 'student' : 'students'}.`,
    );
    closeAnnouncement();
  }

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Students</h1>
          <p className="mt-1 text-sm text-slate-500">
            Students enrolled in your assigned advisory {sections.length === 1 ? 'section' : 'sections'}
            {activeYear ? ` for ${activeYear.name}` : ''}.
          </p>
        </div>
        {sections.length > 0 ? <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setShowManualAdd(true)} disabled={!activeYear || !canWriteToActiveYear} title={!canWriteToActiveYear ? 'Select the current active academic year to add a student.' : undefined} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"><UserPlus size={18} />Add Student</button>
          <button type="button" onClick={() => setShowSf1Import(true)} disabled={!activeYear || !canWriteToActiveYear} title={!canWriteToActiveYear ? 'Select the current active academic year to import students.' : undefined} className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/30 bg-white px-4 py-2.5 text-sm font-bold text-primary shadow-sm transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50"><FileSpreadsheet size={18} />Import SF1</button>
          <button type="button" onClick={() => setShowAnnouncement(true)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"><Megaphone size={18} />New Announcement</button>
        </div> : null}
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {sections.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <BookOpen size={30} />
          </div>
          <h2 className="mt-4 text-lg font-bold text-slate-800">No advisory section assigned</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            Ask the school administrator to assign you as the adviser of a section.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-teal-100 bg-gradient-to-br from-teal-50 to-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-600 text-white">
                  <Users size={22} />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Students</p>
                  <p className="text-2xl font-bold text-slate-900">{students.length}</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Paid · {BILLING_MONTH_LABEL}</p><p className="mt-1 text-2xl font-bold text-slate-900">{paidCount}</p></div>
                <CheckCircle2 size={24} className="text-emerald-600" />
              </div>
            </div>
            <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div><p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Unpaid</p><p className="mt-1 text-2xl font-bold text-slate-900">{Math.max(0, students.length - activatedStudentIds.size)}</p></div>
                <CalendarClock size={24} className="text-amber-600" />
              </div>
            </div>
            <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div><p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Cash Collected</p><p className="mt-1 text-2xl font-bold text-slate-900">₱{collectedAmount.toLocaleString('en-PH')}</p></div>
                <Banknote size={24} className="text-blue-600" />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 shadow-sm">
            <span className="font-bold text-slate-800">Monthly parent access:</span>
            <span>₱{monthlyPrice.toLocaleString('en-PH')} per student</span><span className="text-slate-300">•</span>
            <span>{graceDays}-day grace period</span><span className="text-slate-300">•</span><span>{googlePlayCount} Google Play</span><span className="text-slate-300">•</span><span>{waivedCount} waived</span>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-bold text-slate-900">Advisory Class List</h2>
                <p className="text-xs text-slate-500">
                  {filteredStudents.length} of {students.length} students
                </p>
              </div>
              <div className="relative w-full sm:w-80">
                <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search name, LRN, section..."
                  className="w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            {filteredStudents.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <Users size={36} className="mx-auto text-slate-300" />
                <p className="mt-3 font-medium text-slate-600">
                  {search ? 'No students match your search' : 'No students are enrolled in this section'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="w-16 px-5 py-3 text-center">#</th>
                      <th className="px-5 py-3">Student</th>
                      <th className="px-5 py-3">LRN</th>
                      <th className="px-5 py-3">Section</th>
                      <th className="px-5 py-3">Guardian</th>
                      <th className="px-5 py-3">Contact</th>
                      <th className="px-5 py-3 text-center">{BILLING_MONTH_LABEL} Access</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredStudents.map((student, index) => {
                      const parent = student.parents?.[0];
                      const initials = `${student.first_name[0] ?? ''}${student.last_name[0] ?? ''}`.toUpperCase();
                      const payment = monthlyPayments[student.id];
                      const googlePlayActive = googlePlayStudentIds.has(student.id);
                      const active = accessIsActive(student.id);
                      const updating = updatingAccess.has(student.id);
                      return (
                        <tr key={student.id} className="transition hover:bg-slate-50/80">
                          <td className="px-5 py-4 text-center text-sm text-slate-400">{index + 1}</td>
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 text-sm font-bold text-teal-700">
                                {initials}
                              </div>
                              <div>
                                <p className="font-semibold text-slate-900">
                                  {student.last_name}, {student.first_name}{student.middle_name ? ` ${student.middle_name[0]}.` : ''}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-4 text-sm font-medium text-slate-600">{student.lrn}</td>
                          <td className="px-5 py-4 text-sm text-slate-600">
                            {student.section ? `${student.section.grade_level} · ${student.section.name}` : '—'}
                          </td>
                          <td className="px-5 py-4 text-sm text-slate-600">{parent?.guardian_name || '—'}</td>
                          <td className="px-5 py-4 text-sm text-slate-600">{parent?.phone_number || '—'}</td>
                          <td className="px-5 py-4">
                            <div className="mx-auto flex min-w-44 flex-col items-center gap-2">
                              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${googlePlayActive ? 'bg-sky-100 text-sky-700' : payment?.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : payment?.status === 'waived' ? 'bg-blue-100 text-blue-700' : active ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                                {googlePlayActive || payment?.status === 'paid' ? <CheckCircle2 size={13} /> : <ShieldCheck size={13} />}
                                {googlePlayActive ? 'Google Play · Access On' : payment?.status === 'paid' ? `Paid ₱${Number(payment.amount_paid).toLocaleString('en-PH')}` : payment?.status === 'waived' ? 'Waived · Access On' : active ? 'Grace · Access On' : 'Unpaid · Access Off'}
                              </span>
                              {googlePlayActive ? (
                                <span className="text-[10px] font-semibold text-sky-600">Verified automatically · no cash needed</span>
                              ) : payment?.status !== 'paid' ? (
                                <div className="flex items-center gap-1.5">
                                  <button type="button" onClick={() => void recordAccess(student.id, 'paid')} disabled={updating} className="rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-primary-dark disabled:opacity-50">Mark ₱{monthlyPrice.toLocaleString('en-PH')} Paid</button>
                                  {!payment ? <button type="button" onClick={() => void recordAccess(student.id, 'waived')} disabled={updating} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">Waive</button> : null}
                                </div>
                              ) : (
                                <span className="text-[10px] capitalize text-slate-400">{payment.collected_at ? new Date(payment.collected_at).toLocaleDateString('en-PH') : 'Recorded'} · {payment.remittance_status}</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {showAnnouncement ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-primary">
                  <Megaphone size={21} />
                </div>
                <div>
                  <h2 className="font-bold text-slate-900">New Advisory Announcement</h2>
                  <p className="text-xs text-slate-500">Send an update to parents in your advisory class.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeAnnouncement}
                disabled={sendingAnnouncement}
                className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">Recipients</span>
                  <select
                    value={announcementTarget}
                    onChange={(event) => setAnnouncementTarget(event.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="all">All advisory sections</option>
                    {sections.map((section) => (
                      <option key={section.id} value={section.id}>
                        {section.grade_level} · {section.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">Type</span>
                  <select
                    value={announcementType}
                    onChange={(event) => setAnnouncementType(event.target.value as AnnouncementType)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="general">General</option>
                    <option value="meeting">Meeting</option>
                    <option value="reminder">Reminder</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Title</span>
                <input
                  value={announcementTitle}
                  onChange={(event) => setAnnouncementTitle(event.target.value)}
                  maxLength={120}
                  placeholder="e.g. Parent-Teacher Meeting"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>

              {announcementType === 'meeting' ? (
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                    <CalendarClock size={15} />
                    Meeting date and time
                  </span>
                  <input
                    type="datetime-local"
                    value={announcementEventAt}
                    onChange={(event) => setAnnouncementEventAt(event.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </label>
              ) : null}

              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Message</span>
                <textarea
                  value={announcementMessage}
                  onChange={(event) => setAnnouncementMessage(event.target.value)}
                  maxLength={2000}
                  rows={5}
                  placeholder="Write the details parents need to know..."
                  className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                <span className="mt-1 block text-right text-xs text-slate-400">
                  {announcementMessage.length}/2000
                </span>
              </label>

              <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-700">
                The announcement is saved in the parent app. Push notifications are sent only to students whose Parent Access is On.
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
              <button
                type="button"
                onClick={closeAnnouncement}
                disabled={sendingAnnouncement}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void sendAnnouncement()}
                disabled={sendingAnnouncement}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white transition hover:bg-primary-dark disabled:cursor-wait disabled:opacity-60"
              >
                <Send size={17} />
                {sendingAnnouncement ? 'Sending...' : 'Send Announcement'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showManualAdd && activeYear ? (
        <ManualStudentModal
          sections={sections}
          activeYear={activeYear}
          onClose={() => setShowManualAdd(false)}
          onAdded={fetchStudents}
        />
      ) : null}
      {showSf1Import && activeYear ? (
        <Sf1ImportModal
          sections={sections}
          activeYear={activeYear}
          onClose={() => setShowSf1Import(false)}
          onImported={fetchStudents}
        />
      ) : null}
    </div>
  );
}
