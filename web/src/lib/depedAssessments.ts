export type AssessmentPeriod = 'bosy' | 'eosy';
export type AssessmentDomain = 'literacy' | 'numeracy' | 'nutrition';

export const CRLA_LEVELS = [
  ['low_emerging', 'Low Emerging'],
  ['high_emerging', 'High Emerging'],
  ['developing', 'Developing'],
  ['transitioning', 'Transitioning'],
  ['at_grade_level', 'At Grade Level'],
] as const;

export const PHIL_IRI_LEVELS = [
  ['frustration', 'Frustration'],
  ['instructional', 'Instructional'],
  ['independent', 'Independent'],
  ['at_grade_level', 'At Grade Level'],
] as const;

export const RMA_LEVELS = [
  ['emerging_not_proficient', 'Emerging — Not Proficient'],
  ['emerging_low_proficient', 'Emerging — Low Proficient'],
  ['developing_nearly_proficient', 'Developing — Nearly Proficient'],
  ['transitioning_proficient', 'Transitioning — Proficient'],
  ['at_grade_level_highly_proficient', 'At Grade Level — Highly Proficient'],
] as const;

export const LITERACY_LANGUAGES = [
  ['mother_tongue', 'Mother Tongue'],
  ['filipino', 'Filipino'],
  ['english', 'English'],
] as const;

export function gradeNumber(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^grade/, '');
  if (!/^\d+$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isInteger(number) ? number : null;
}

export function literacyInstrument(gradeLevel: string | undefined): 'CRLA' | 'PHIL_IRI' | null {
  const grade = gradeNumber(gradeLevel);
  if (grade !== null && grade >= 1 && grade <= 3) return 'CRLA';
  if (grade !== null && grade >= 4 && grade <= 10) return 'PHIL_IRI';
  return null;
}

export function supportsRma(gradeLevel: string | undefined): boolean {
  const grade = gradeNumber(gradeLevel);
  return grade !== null && grade >= 1 && grade <= 10;
}

// DepEd Government School Profile SY 2025-2026 reporting bands.
export function nutritionStatusFromZScore(zScore: number) {
  if (zScore < -3) return 'severely_wasted';
  if (zScore < -2) return 'wasted';
  if (zScore <= 2) return 'normal';
  if (zScore <= 3) return 'overweight';
  return 'obese';
}

export function heightStatusFromZScore(zScore: number) {
  if (zScore < -3) return 'severely_stunted';
  if (zScore < -2) return 'stunted';
  if (zScore <= 2) return 'normal';
  return 'tall';
}

export function assessmentLabel(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  return value.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

export function ageInMonths(dateOfBirth: string, assessmentDate: string): number | null {
  if (!dateOfBirth || !assessmentDate) return null;
  const birth = new Date(`${dateOfBirth}T00:00:00`);
  const assessed = new Date(`${assessmentDate}T00:00:00`);
  if (!Number.isFinite(birth.getTime()) || !Number.isFinite(assessed.getTime()) || birth >= assessed) return null;
  let months = (assessed.getFullYear() - birth.getFullYear()) * 12 + assessed.getMonth() - birth.getMonth();
  if (assessed.getDate() < birth.getDate()) months -= 1;
  return months;
}

