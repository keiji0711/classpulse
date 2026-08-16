import type { AssessmentDomain, LearnerAssessment } from '../types';

const labels: Record<string, string> = {
  low_emerging: 'Low Emerging',
  high_emerging: 'High Emerging',
  developing: 'Developing',
  transitioning: 'Transitioning',
  at_grade_level: 'At Grade Level',
  frustration: 'Frustration',
  instructional: 'Instructional',
  independent: 'Independent',
  emerging_not_proficient: 'Emerging / Not Proficient',
  emerging_low_proficient: 'Emerging / Low Proficient',
  developing_nearly_proficient: 'Developing / Nearly Proficient',
  transitioning_proficient: 'Transitioning / Proficient',
  at_grade_level_highly_proficient: 'At Grade Level / Highly Proficient',
  severely_wasted: 'Severely Wasted',
  wasted: 'Wasted',
  normal: 'Normal',
  overweight: 'Overweight',
  obese: 'Obese',
  severely_stunted: 'Severely Stunted',
  stunted: 'Stunted',
  tall: 'Tall',
};

export const domainMeta: Record<AssessmentDomain, { title: string; eyebrow: string; icon: string; accent: string; tint: string }> = {
  literacy: { title: 'Literacy', eyebrow: 'READING DEVELOPMENT', icon: 'book-outline', accent: '#0f766e', tint: '#ecfdf5' },
  numeracy: { title: 'Numeracy', eyebrow: 'MATHEMATICAL DEVELOPMENT', icon: 'calculator-outline', accent: '#0369a1', tint: '#eff6ff' },
  nutrition: { title: 'Nutritional Status', eyebrow: 'LEARNER WELLNESS', icon: 'heart-outline', accent: '#c2410c', tint: '#fff7ed' },
};

export function assessmentLabel(value: string | null | undefined): string {
  if (!value) return 'Not recorded';
  return labels[value] ?? value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export function periodLabel(period: LearnerAssessment['assessment_period']): string {
  return period === 'bosy' ? 'Beginning of School Year' : 'End of School Year';
}

export function languageLabel(language: LearnerAssessment['language']): string {
  if (language === 'mother_tongue') return 'Mother Tongue';
  if (language === 'filipino') return 'Filipino';
  if (language === 'english') return 'English';
  return '';
}

export function latestForDomain(records: LearnerAssessment[], domain: AssessmentDomain): LearnerAssessment | null {
  return records.filter((record) => record.domain === domain).sort((a, b) =>
    new Date(b.assessment_date).getTime() - new Date(a.assessment_date).getTime(),
  )[0] ?? null;
}

export function assessmentTone(record: LearnerAssessment | null) {
  if (!record) return { color: '#64748b', tint: '#f1f5f9' };
  const concern = record.domain === 'literacy'
    ? ['low_emerging', 'high_emerging', 'developing', 'frustration', 'instructional'].includes(record.classification)
    : record.domain === 'numeracy'
      ? ['emerging_not_proficient', 'emerging_low_proficient', 'developing_nearly_proficient'].includes(record.classification)
      : ['severely_wasted', 'wasted', 'overweight', 'obese'].includes(record.classification)
        || ['severely_stunted', 'stunted'].includes(record.secondary_classification ?? '');
  return concern ? { color: '#b45309', tint: '#fffbeb' } : { color: '#047857', tint: '#ecfdf5' };
}
