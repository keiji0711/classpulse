import { describe, expect, it } from 'vitest';
import { mapEnrollmentRoster } from './academicYearRoster';

type FixtureStudent = {
  id: string;
  school_id: string;
  first_name: string;
  section_id: string;
};

type FixtureSection = {
  id: string;
  school_id: string;
  name: string;
  grade_level: string;
};

const schoolA = 'school-a';
const oldSection: FixtureSection = {
  id: 'grade-10-rizal',
  school_id: schoolA,
  name: 'Rizal',
  grade_level: 'Grade 10',
};
const newSection: FixtureSection = {
  id: 'grade-11-stem-a',
  school_id: schoolA,
  name: 'STEM A',
  grade_level: 'Grade 11',
};

// This intentionally represents the legacy state after promotion: the master
// student points at the new section while the old enrollment remains Grade 10.
const promotedStudent: FixtureStudent = {
  id: 'student-maria',
  school_id: schoolA,
  first_name: 'Maria',
  section_id: newSection.id,
};

const enrollmentsByYear = {
  '2025-2026': [
    {
      student_id: promotedStudent.id,
      section_id: oldSection.id,
      student: promotedStudent,
      section: oldSection,
    },
  ],
  '2026-2027': [
    {
      student_id: promotedStudent.id,
      section_id: newSection.id,
      student: promotedStudent,
      section: newSection,
    },
  ],
};

describe('academic-year rosters', () => {
  it('demonstrates why the legacy student section is unsafe for history', () => {
    expect(promotedStudent.section_id).toBe(newSection.id);
    expect(enrollmentsByYear['2025-2026'][0].section_id).toBe(oldSection.id);
  });

  it('shows the old section when the old academic year is viewed', () => {
    const roster = mapEnrollmentRoster(enrollmentsByYear['2025-2026']);

    expect(roster).toHaveLength(1);
    expect(roster[0].section_id).toBe(oldSection.id);
    expect(roster[0].section).toEqual(oldSection);
  });

  it('shows the new section when the new academic year is viewed', () => {
    const roster = mapEnrollmentRoster(enrollmentsByYear['2026-2027']);

    expect(roster).toHaveLength(1);
    expect(roster[0].section_id).toBe(newSection.id);
    expect(roster[0].section).toEqual(newSection);
  });

  it('keeps one roster entry for one enrollment row', () => {
    const roster = mapEnrollmentRoster(enrollmentsByYear['2026-2027']);
    expect(roster.map((student) => student.id)).toEqual(['student-maria']);
  });
});
