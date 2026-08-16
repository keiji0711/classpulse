export interface Student {
  id: string;
  school_id: string;
  section_id: string;
  lrn: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  created_at: string;
  section?: Section;
}

export interface Section {
  id: string;
  school_id: string;
  name: string;
  grade_level: string;
  strand_id: string | null;
  created_at: string;
}

export interface School {
  id: string;
  name: string;
  address: string;
  logo_url: string | null;
  created_at: string;
}

export interface AcademicYear {
  id: string;
  school_id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  created_at: string;
}

export type UserRole = 'super_admin' | 'school_admin' | 'instructor';

export interface AppUser {
  id: string;
  email: string;
  role: UserRole;
  school_id: string | null;
  full_name: string;
  phone_number: string;
  address: string;
  created_at: string;
  account_status?: 'active' | 'deactivated';
  school?: Pick<School, 'id' | 'name' | 'logo_url'> | null;
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

export interface Subject {
  id: string;
  school_id: string;
  name: string;
  code: string;
  created_at: string;
}

export interface Schedule {
  id: string;
  school_id: string;
  instructor_id: string;
  subject_id: string;
  section_id: string;
  academic_year_id: string | null;
  day_of_week: string;
  time_start: string;
  time_end: string;
  room: string;
  created_at: string;
  subject?: Subject;
  section?: Section;
  instructor?: { full_name: string };
}

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export interface AttendanceRecord {
  id: string;
  schedule_id: string;
  student_id: string;
  date: string;
  status: AttendanceStatus;
  recorded_by: string;
  recorded_at: string;
  schedule?: Schedule;
}

export interface FeedMessage {
  id: string;
  student_id: string;
  schedule_id: string | null;
  instructor_id: string | null;
  content: string;
  created_at: string;
  school_id?: string | null;
  section_id?: string | null;
  academic_year_id?: string | null;
  message_type?: 'subject_message' | 'adviser_announcement';
  announcement_type?: 'general' | 'meeting' | 'reminder' | 'urgent' | null;
  title?: string | null;
  event_at?: string | null;
  schedule?: Schedule;
  section?: Section;
  instructor?: { full_name: string };
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
  subject?: Subject;
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
  subject?: Subject;
}

export type AssessmentPeriod = 'bosy' | 'eosy';
export type AssessmentDomain = 'literacy' | 'numeracy' | 'nutrition';

export interface LearnerAssessment {
  id: string;
  assessment_period: AssessmentPeriod;
  domain: AssessmentDomain;
  instrument: 'CRLA' | 'PHIL_IRI' | 'RMA' | 'DEPED_NUTRITION';
  instrument_version: string;
  language: 'mother_tongue' | 'filipino' | 'english' | 'not_applicable';
  classification: string;
  secondary_classification: string | null;
  raw_score: number | null;
  total_items: number | null;
  assessment_date: string;
  notes: string;
  updated_at: string;
}

export interface SessionData {
  role?: 'parent';
  access_enabled?: boolean;
  billing_app_user_id?: string;
  student: {
    id: string;
    first_name: string;
    last_name: string;
    lrn: string;
  };
  school: {
    id: string;
    name: string;
    logo_url: string | null;
  };
  parent: {
    id: string;
    guardian_name: string;
    email: string | null;
    phone_number: string;
  } | null;
  siblings: Array<{
    id: string;
    first_name: string;
    last_name: string;
    lrn: string;
  }>;
  token: string;
  expires_at: string;
}

export interface InstructorSessionData {
  role: 'instructor';
  user: AppUser;
}

export interface AttendanceSubmissionPayload {
  schedule_id: string;
  date: string;
  recorded_by: string;
  entries: Array<{
    student_id: string;
    status: AttendanceStatus;
  }>;
}
