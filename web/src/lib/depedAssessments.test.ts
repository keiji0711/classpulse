import { describe, expect, it } from 'vitest';
import { ageInMonths, gradeNumber, heightStatusFromZScore, literacyInstrument, nutritionStatusFromZScore, supportsRma } from './depedAssessments';

describe('DepEd assessment helpers', () => {
  it('routes only supported grade levels to their current literacy instrument', () => {
    expect(literacyInstrument('Grade 1')).toBe('CRLA');
    expect(literacyInstrument('3')).toBe('CRLA');
    expect(literacyInstrument('Grade 4')).toBe('PHIL_IRI');
    expect(literacyInstrument('Grade 10')).toBe('PHIL_IRI');
    expect(literacyInstrument('Kindergarten')).toBeNull();
    expect(literacyInstrument('Grade 11')).toBeNull();
    expect(gradeNumber('Grade 07')).toBe(7);
    expect(supportsRma('Grade 10')).toBe(true);
    expect(supportsRma('Grade 11')).toBe(false);
  });

  it('uses the current DepEd nutritional z-score boundaries', () => {
    expect(nutritionStatusFromZScore(-3.01)).toBe('severely_wasted');
    expect(nutritionStatusFromZScore(-3)).toBe('wasted');
    expect(nutritionStatusFromZScore(-2)).toBe('normal');
    expect(nutritionStatusFromZScore(2)).toBe('normal');
    expect(nutritionStatusFromZScore(2.01)).toBe('overweight');
    expect(nutritionStatusFromZScore(3.01)).toBe('obese');
    expect(heightStatusFromZScore(-3.01)).toBe('severely_stunted');
    expect(heightStatusFromZScore(-3)).toBe('stunted');
    expect(heightStatusFromZScore(2.01)).toBe('tall');
  });

  it('calculates completed age in months on the measurement date', () => {
    expect(ageInMonths('2015-06-20', '2026-06-19')).toBe(131);
    expect(ageInMonths('2015-06-20', '2026-06-20')).toBe(132);
    expect(ageInMonths('2026-06-20', '2026-06-20')).toBeNull();
  });
});
