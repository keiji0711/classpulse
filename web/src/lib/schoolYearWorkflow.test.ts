import { describe, expect, it } from 'vitest';
import { buildSuggestedDecision, validateYearEndDecisions } from './schoolYearWorkflow';

const sections = [
  { id: 'grade-10-rizal', grade_level: 'Grade 10' },
  { id: 'grade-11-stem-a', grade_level: 'Grade 11' },
  { id: 'grade-12-stem-a', grade_level: 'Grade 12' },
];

describe('school-year outcome workflow', () => {
  it('suggests the next grade for a promotable student', () => {
    expect(buildSuggestedDecision('Grade 10', sections)).toEqual({
      outcome: 'promoted',
      target_section_id: 'grade-11-stem-a',
      notes: '',
    });
  });

  it('suggests graduation without a target enrollment for Grade 12', () => {
    expect(buildSuggestedDecision('Grade 12', sections)).toEqual({
      outcome: 'graduated',
      target_section_id: '',
      notes: '',
    });
  });

  it('blocks finalization while a student is pending', () => {
    const result = validateYearEndDecisions(
      ['student-a', 'student-b'],
      {
        'student-a': { outcome: 'promoted', target_section_id: 'grade-11-stem-a', notes: '' },
        'student-b': { outcome: 'pending', target_section_id: '', notes: '' },
      },
      '2026-2027',
    );

    expect(result.valid).toBe(false);
    expect(result.pending).toBe(1);
  });

  it('requires a destination for promoted and retained students', () => {
    const result = validateYearEndDecisions(
      ['student-a'],
      { 'student-a': { outcome: 'retained', target_section_id: '', notes: '' } },
      '2026-2027',
    );

    expect(result.valid).toBe(false);
    expect(result.missingTargets).toBe(1);
  });
});
