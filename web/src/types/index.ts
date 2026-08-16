export type UserRole = 'super_admin' | 'school_admin' | 'instructor';
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';
export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled' | 'expired';

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string;
  monthly_price: number;
  billing_model: 'per_student' | 'custom';
  billing_cycle: 'monthly' | 'annual' | 'custom';
  price_per_student: number | null;
  minimum_monthly: number | null;
  annual_discount_months: number | null;
  features: Record<string, boolean>;
  limits: Record<string, number>;
  is_active: boolean;
  created_at: string;
}

export interface SchoolSubscription {
  id: string;
  school_id: string;
  plan_id: string | null;
  status: SubscriptionStatus;
  started_at: string;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  grace_until: string | null;
  manual_payment_reference: string | null;
  paid_at: string | null;
  notes: string;
  updated_at: string;
  plan?: Plan | null;
}

export interface SchoolFeatureOverride {
  id: string;
  school_id: string;
  feature_key: string;
  enabled: boolean;
  limit_override: number | null;
  reason: string;
  created_at: string;
}

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void';

export interface Invoice {
  id: string;
  school_id: string;
  invoice_number: string;
  billing_period_start: string;
  billing_period_end: string;
  student_count: number;
  rate_per_student: number | null;
  minimum_monthly: number | null;
  subtotal: number;
  total_amount: number;
  plan_name: string | null;
  billing_model: string;
  status: InvoiceStatus;
  notes: string;
  payment_reference: string | null;
  created_at: string;
  paid_at: string | null;
}

export interface SubscriptionEntitlements {
  school_id: string | null;
  status: SubscriptionStatus | 'inactive' | 'active';
  has_access: boolean;
  plan_code: string | null;
  plan_name: string | null;
  features: Record<string, boolean>;
  limits: Record<string, number>;
  grace_until: string | null;
  current_period_end: string | null;
}

export interface School {
  id: string;
  name: string;
  address: string;
  deped_school_id: string | null;
  logo_url: string | null;
  subscription_mode?: 'subscription' | 'school_paid';
  created_at: string;
  operational_status?: 'new' | 'setup' | 'ready' | 'active' | 'inactive' | 'suspended' | 'archived';
  status_reason?: string;
  status_changed_at?: string | null;
  archived_at?: string | null;
}

export interface AcademicYear {
  id: string;
  school_id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  status?: 'draft' | 'active' | 'closing' | 'closed' | 'archived';
  closed_at?: string | null;
  closed_by?: string | null;
  reopened_at?: string | null;
  reopened_by?: string | null;
  created_at: string;
}

export interface StudentEnrollment {
  id: string;
  student_id: string;
  section_id: string;
  academic_year_id: string;
  school_id: string;
  created_at: string;
  enrollment_status?: 'enrolled' | 'completed' | 'transferred' | 'withdrawn' | 'dropped';
  year_end_outcome?: 'promoted' | 'retained' | 'graduated' | 'transferred' | 'withdrawn' | 'dropped' | 'pending' | null;
  promoted_to_enrollment_id?: string | null;
  outcome_notes?: string;
  finalized_at?: string | null;
  finalized_by?: string | null;
  student?: Student;
  section?: Section;
  academic_year?: AcademicYear;
}

export interface AppUser {
  id: string;
  email: string;
  role: UserRole;
  school_id: string | null;
  full_name: string;
  phone_number: string;
  address: string;
  created_at: string;
  // Platform IAM (super_admin only). Undefined before migration 030 — treated as owner.
  permissions?: string[];
  is_platform_owner?: boolean;
  account_status?: 'active' | 'deactivated';
}

export interface Strand {
  id: string;
  school_id: string;
  name: string;
  code: string;
  created_at: string;
}

export interface Section {
  id: string;
  school_id: string;
  name: string;
  grade_level: string;
  strand_id: string | null;
  adviser_id?: string | null;
  created_at: string;
  strand?: Strand;
  section_subjects?: SectionSubject[];
  adviser?: AppUser | null;
}

export interface SectionSubject {
  id: string;
  section_id: string;
  subject_id: string;
  school_id: string;
  created_at: string;
  subject?: Subject;
}

export interface Subject {
  id: string;
  school_id: string;
  name: string;
  code: string;
  created_at: string;
}

export interface Student {
  id: string;
  school_id: string;
  section_id: string;
  lrn: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  created_at: string;
  lifecycle_status?: 'active' | 'graduated' | 'transferred' | 'withdrawn' | 'dropped';
  graduation_date?: string | null;
  section?: Section;
}

export interface Parent {
  id: string;
  student_id: string;
  school_id: string;
  guardian_name: string;
  phone_number: string;
  fcm_push_token: string | null;
  expo_push_token: string | null;
  created_at: string;
}

export interface Schedule {
  id: string;
  school_id: string;
  instructor_id: string;
  subject_id: string;
  section_id: string;
  academic_year_id: string | null;
  day_of_week: DayOfWeek;
  time_start: string;
  time_end: string;
  room: string;
  created_at: string;
  subject?: Subject;
  section?: Section;
  instructor?: AppUser;
}

export interface AttendanceRecord {
  id: string;
  schedule_id: string;
  student_id: string;
  date: string;
  status: AttendanceStatus;
  recorded_by: string;
  recorded_at: string;
  student?: Student;
  schedule?: Schedule;
}

export interface Grade {
  id: string;
  school_id: string;
  student_id: string;
  subject_id: string;
  academic_year_id: string | null;
  quarter: number;
  grade: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  student?: Student;
  subject?: Subject;
}

/* Attendance Intervention Types */
export type InterventionActionType = 'call_parent' | 'sms' | 'email' | 'meeting_scheduled' | 'home_visit' | 'referral' | 'other';
export type InterventionStatus = 'pending' | 'in_progress' | 'completed' | 'resolved' | 'escalated';
export type InterventionOutcome = 'improved' | 'stable' | 'declined' | 'critical' | null;

export interface AttendanceIntervention {
  id: string;
  school_id: string;
  student_id: string;
  created_by: string;
  action_type: InterventionActionType;
  notes: string;
  follow_up_date: string | null;
  status: InterventionStatus;
  outcome: InterventionOutcome;
  created_at: string;
  updated_at: string;
  student?: Student;
  created_by_user?: AppUser;
}

export type ActionLogType = 'created' | 'status_updated' | 'outcome_set' | 'note_added' | 'follow_up_updated';

export interface InterventionAction {
  id: string;
  intervention_id: string;
  action_type: ActionLogType;
  description: string;
  created_by: string;
  created_at: string;
  created_by_user?: AppUser;
}

export type ExamPeriod = '1st_quarter' | '2nd_quarter' | '3rd_quarter';

export interface ExamScore {
  id: string;
  school_id: string;
  student_id: string;
  subject_id: string;
  academic_year_id: string | null;
  exam_period: ExamPeriod;
  total_items: number;
  score: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  student?: Student;
  subject?: Subject;
}
