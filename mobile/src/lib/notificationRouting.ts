export type AppRole = 'parent' | 'instructor';

export type NotificationDestination =
  | { kind: 'support' }
  | { kind: 'tab'; tab: string }
  | { kind: 'assessment'; domain: 'literacy' | 'numeracy' | 'nutrition' }
  | {
      kind: 'chat';
      subjectId: string;
      subjectName: string;
      subjectCode: string;
      instructorName: string;
      isAdviser: boolean;
    };

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedType(data: Record<string, unknown>): string {
  return stringValue(data.notification_type || data.type || data.target_screen)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function roleTab(role: AppRole, parentTab: string, instructorTab: string): NotificationDestination {
  return { kind: 'tab', tab: role === 'parent' ? parentTab : instructorTab };
}

/**
 * Converts push metadata into a navigation destination. Field-based fallbacks
 * keep notifications sent by older edge-function versions tappable.
 */
export function resolveNotificationDestination(
  data: Record<string, unknown> | undefined,
  role: AppRole,
): NotificationDestination {
  const payload = data ?? {};
  const type = normalizedType(payload);
  const subjectId = stringValue(payload.subject_id);
  const scheduleId = stringValue(payload.schedule_id);

  if (type === 'support' || type === 'support_reply') return { kind: 'support' };

  if (['grade', 'grades', 'grade_update', 'grades_updated'].includes(type)) {
    return roleTab(role, 'Grades', 'InstructorGrades');
  }

  if (['exam', 'exams', 'exam_score', 'exam_scores', 'exam_score_update'].includes(type)) {
    return roleTab(role, 'ExamScores', 'InstructorExamScores');
  }

  if (['attendance', 'attendance_update', 'attendance_recorded'].includes(type)) {
    return roleTab(role, 'Home', 'InstructorAttendance');
  }

  if (['learner_assessment', 'learner_assessments', 'assessment_record'].includes(type)) {
    if (role !== 'parent') return { kind: 'tab', tab: 'Today' };
    const requestedDomain = stringValue(payload.assessment_domain);
    const domain = ['literacy', 'numeracy', 'nutrition'].includes(requestedDomain)
      ? requestedDomain as 'literacy' | 'numeracy' | 'nutrition'
      : 'literacy';
    return { kind: 'assessment', domain };
  }

  if (['profile', 'settings', 'account', 'test_push'].includes(type)) {
    return roleTab(role, 'Profile', 'InstructorProfile');
  }

  const isChat = ['chat', 'message', 'subject_message', 'adviser_announcement'].includes(type);
  if (role === 'parent' && (isChat || subjectId)) {
    const resolvedSubjectId = subjectId || scheduleId;
    if (resolvedSubjectId) {
      return {
        kind: 'chat',
        subjectId: resolvedSubjectId,
        subjectName: stringValue(payload.subject_name) || (type === 'adviser_announcement' ? 'Advisory Announcements' : 'Teacher Message'),
        subjectCode: stringValue(payload.subject_code),
        instructorName: stringValue(payload.instructor_name) || 'Teacher',
        isAdviser: type === 'adviser_announcement' || resolvedSubjectId.startsWith('advisory-'),
      };
    }
  }

  // Legacy attendance pushes had status/date/schedule fields but no type.
  if (stringValue(payload.status) || stringValue(payload.date)) {
    return roleTab(role, 'Home', 'InstructorAttendance');
  }

  // Intervention and unknown school updates land on the main activity screen.
  return roleTab(role, 'Feed', 'Today');
}
