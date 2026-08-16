export type YearEndOutcome = 'promoted' | 'retained' | 'graduated' | 'transferred' | 'withdrawn' | 'dropped' | 'pending';

export type YearEndDecision = {
  outcome: YearEndOutcome;
  target_section_id: string;
  notes: string;
};

export const GRADE_ORDER = ['Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'];

export function getNextGrade(grade: string) {
  const index = GRADE_ORDER.indexOf(grade);
  return index >= 0 && index < GRADE_ORDER.length - 1 ? GRADE_ORDER[index + 1] : grade;
}

export function buildSuggestedDecision(
  gradeLevel: string,
  sections: Array<{ id: string; grade_level: string }>,
): YearEndDecision {
  if (gradeLevel === 'Grade 12') {
    return { outcome: 'graduated', target_section_id: '', notes: '' };
  }

  return {
    outcome: 'promoted',
    target_section_id: sections.find((section) => section.grade_level === getNextGrade(gradeLevel))?.id ?? '',
    notes: '',
  };
}

export function validateYearEndDecisions(
  studentIds: string[],
  decisions: Record<string, YearEndDecision>,
  targetYearId: string,
) {
  let pending = 0;
  let missingTargets = 0;
  const counts: Record<YearEndOutcome, number> = {
    promoted: 0,
    retained: 0,
    graduated: 0,
    transferred: 0,
    withdrawn: 0,
    dropped: 0,
    pending: 0,
  };

  for (const studentId of studentIds) {
    const decision = decisions[studentId];
    if (!decision || decision.outcome === 'pending') pending++;
    if (decision) counts[decision.outcome]++;
    if (decision && ['promoted', 'retained'].includes(decision.outcome) && !decision.target_section_id) missingTargets++;
  }

  return {
    pending,
    missingTargets,
    counts,
    valid: studentIds.length > 0 && pending === 0 && missingTargets === 0 && Boolean(targetYearId),
  };
}
