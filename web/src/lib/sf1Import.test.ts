import { describe, expect, it } from 'vitest';
import { applyGuardianChoice, getSf1MatchChecks, parseLearnerName, parseSf1Rows, sf1SectionMatches, validateSf1Row } from './sf1Import';

function sf1Fixture() {
  const rows: unknown[][] = Array.from({ length: 10 }, () => []);
  rows[2][0] = 'School ID'; rows[2][5] = '131747';
  rows[3][0] = 'School Name'; rows[3][5] = 'Waloe Elementary School';
  rows[3][16] = 'School Year'; rows[3][19] = '2026 - 2027';
  rows[3][25] = 'Grade Level'; rows[3][30] = 'Kinder';
  rows[3][35] = 'Section'; rows[3][38] = 'KINDER A';
  rows[4][0] = 'LRN'; rows[4][2] = 'NAME (Last Name, First Name, Middle Name)';
  rows[4][6] = 'Sex (M/F)'; rows[4][27] = 'PARENTS'; rows[4][41] = 'Contact Number of Parent or Guardian';
  rows[5][27] = "Father's Name (Last Name, First Name, Middle Name)";
  rows[5][31] = "Mother's Maiden Name (Last Name, First Name, Middle Name)";
  rows[6][0] = '131747260016'; rows[6][2] = 'CASAL,NELSON, JR., ADULFO'; rows[6][6] = 'M';
  rows[6][27] = 'CASAL, NELSON GONZALES'; rows[6][31] = 'ADULFO,RICA,PEREZ,';
  rows[7][0] = '131747260018'; rows[7][2] = 'ANTONIO,RICHARD, BANGLID'; rows[7][6] = 'M';
  rows[7][31] = 'ANTONIO,MARY JOY,BANGLID,';
  rows[8][0] = '2'; rows[8][2] = '<=== TOTAL MALE';
  return rows;
}

describe('SF1 import parser', () => {
  it('extracts metadata and ignores total rows', () => {
    const result = parseSf1Rows(sf1Fixture());
    expect(result).toMatchObject({ schoolId: '131747', gradeLevel: 'Kinder', sectionName: 'KINDER A' });
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      lrn: '131747260016', firstName: 'NELSON JR.', middleName: 'ADULFO', lastName: 'CASAL',
      fatherName: 'CASAL, NELSON GONZALES', motherName: 'ADULFO, RICA PEREZ',
    });
  });

  it('uses the available mother when father is missing', () => {
    const rows = applyGuardianChoice(parseSf1Rows(sf1Fixture()).rows, 'father');
    expect(rows[1].guardianChoice).toBe('mother');
    expect(validateSf1Row(rows[1])).toEqual([]);
  });

  it('handles suffixes and blank middle names', () => {
    expect(parseLearnerName('HAVANA,JEDDY,JR, CASAL')).toEqual({ firstName: 'JEDDY JR', middleName: 'CASAL', lastName: 'HAVANA' });
    expect(parseLearnerName('SAGIWAN,XYRIEL, -')).toEqual({ firstName: 'XYRIEL', middleName: '', lastName: 'SAGIWAN' });
  });

  it('matches the supplied SF1 metadata to its configured school and class', () => {
    const workbook = parseSf1Rows(sf1Fixture());
    const checks = getSf1MatchChecks(workbook, {
      schoolId: '131747', schoolYear: '2026-2027', gradeLevel: 'Kindergarten', sectionName: 'A',
    });
    expect(checks.every((check) => check.matches)).toBe(true);
    expect(sf1SectionMatches('KINDER A', 'Kinder', 'Kindergarten A', 'Kindergarten')).toBe(true);
  });

  it('blocks a different school, year, grade, or section', () => {
    const workbook = parseSf1Rows(sf1Fixture());
    const checks = getSf1MatchChecks(workbook, {
      schoolId: '999999', schoolYear: '2025-2026', gradeLevel: 'Grade 1', sectionName: 'B',
    });
    expect(checks.map((check) => check.matches)).toEqual([false, false, false, false]);
  });
});
