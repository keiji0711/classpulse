import * as XLSX from 'xlsx-js-style';

export type GuardianChoice = 'father' | 'mother';

export interface Sf1ImportRow {
  sourceRow: number;
  lrn: string;
  firstName: string;
  middleName: string;
  lastName: string;
  fatherName: string;
  motherName: string;
  guardianChoice: GuardianChoice;
  phoneNumber: string;
}

export interface Sf1Workbook {
  schoolId: string;
  schoolName: string;
  schoolYear: string;
  gradeLevel: string;
  sectionName: string;
  rows: Sf1ImportRow[];
}

export interface Sf1MatchCheck {
  key: 'school' | 'year' | 'grade' | 'section';
  label: string;
  expected: string;
  actual: string;
  matches: boolean;
  message: string;
}

function cellText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function compact(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function normalizeGradeLevel(value: string) {
  const normalized = compact(value);
  if (normalized === 'kinder' || normalized === 'kindergarten' || normalized === 'grade0') return 'kindergarten';
  return normalized.replace(/^grade/, '');
}

function sectionKey(value: string, gradeLevel: string) {
  const normalized = compact(value);
  const grade = normalizeGradeLevel(gradeLevel);
  if (grade === 'kindergarten') return normalized.replace(/^(kindergarten|kinder)/, '');
  return normalized.replace(new RegExp(`^(?:grade)?${grade}`), '');
}

export function sf1SectionMatches(sourceSection: string, sourceGrade: string, targetSection: string, targetGrade: string) {
  if (!sourceSection.trim() || !targetSection.trim()) return false;
  if (compact(sourceSection) === compact(targetSection)) return true;
  return sectionKey(sourceSection, sourceGrade) === sectionKey(targetSection, targetGrade);
}

export function getSf1MatchChecks(
  workbook: Pick<Sf1Workbook, 'schoolId' | 'schoolYear' | 'gradeLevel' | 'sectionName'>,
  expected: { schoolId: string; schoolYear: string; gradeLevel: string; sectionName: string },
): Sf1MatchCheck[] {
  const schoolMatches = /^\d{6}$/.test(expected.schoolId) && workbook.schoolId.trim() === expected.schoolId;
  const yearMatches = workbook.schoolYear.replace(/\D/g, '') !== ''
    && workbook.schoolYear.replace(/\D/g, '') === expected.schoolYear.replace(/\D/g, '');
  const gradeMatches = normalizeGradeLevel(workbook.gradeLevel) !== ''
    && normalizeGradeLevel(workbook.gradeLevel) === normalizeGradeLevel(expected.gradeLevel);
  const sectionMatches = gradeMatches && sf1SectionMatches(
    workbook.sectionName,
    workbook.gradeLevel,
    expected.sectionName,
    expected.gradeLevel,
  );

  return [
    { key: 'school', label: 'DepEd School ID', expected: expected.schoolId || 'Not configured', actual: workbook.schoolId || 'Not found', matches: schoolMatches, message: !expected.schoolId ? 'Configure the school’s DepEd ID first.' : schoolMatches ? 'School matched' : 'This SF1 belongs to a different school.' },
    { key: 'year', label: 'School year', expected: expected.schoolYear, actual: workbook.schoolYear || 'Not found', matches: yearMatches, message: yearMatches ? 'Academic year matched' : 'The SF1 school year does not match the active year.' },
    { key: 'grade', label: 'Grade level', expected: expected.gradeLevel, actual: workbook.gradeLevel || 'Not found', matches: gradeMatches, message: gradeMatches ? 'Grade level matched' : 'The SF1 grade does not match the selected section.' },
    { key: 'section', label: 'Section', expected: expected.sectionName, actual: workbook.sectionName || 'Not found', matches: sectionMatches, message: sectionMatches ? 'Section matched' : 'The SF1 section does not match the selected section.' },
  ];
}

function findLabelValue(rows: unknown[][], label: string) {
  const expected = label.toLowerCase();
  for (const row of rows.slice(0, 8)) {
    const index = row.findIndex((value) => cellText(value).toLowerCase() === expected);
    if (index >= 0) {
      for (let offset = 1; offset <= 8; offset += 1) {
        const value = cellText(row[index + offset]);
        if (value) return value;
      }
    }
  }
  return '';
}

function findColumn(row: unknown[], matcher: (text: string) => boolean) {
  return row.findIndex((value) => matcher(cellText(value).toLowerCase()));
}

export function parseLearnerName(value: string) {
  const parts = value.split(',').map(cellText).filter(Boolean);
  const lastName = parts.shift() ?? '';
  let firstName = parts.shift() ?? '';
  let middleName = parts.join(' ');

  if (/^(jr\.?|sr\.?|i{2,3}|iv)$/i.test(middleName.split(' ')[0] ?? '')) {
    const [suffix, ...middle] = middleName.split(' ');
    firstName = `${firstName} ${suffix}`.trim();
    middleName = middle.join(' ');
  }

  if (middleName === '-') middleName = '';
  return { firstName, middleName, lastName };
}

export function normalizeGuardianName(value: string) {
  const parts = value.split(',').map(cellText).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts[0]}, ${parts.slice(1).join(' ')}`;
}

export function validateSf1Row(row: Sf1ImportRow) {
  const errors: string[] = [];
  if (!/^\d{12}$/.test(row.lrn)) errors.push('LRN must contain exactly 12 digits');
  if (!row.firstName.trim()) errors.push('First name is required');
  if (!row.lastName.trim()) errors.push('Last name is required');
  const guardian = row.guardianChoice === 'father' ? row.fatherName : row.motherName;
  if (!guardian.trim()) errors.push('Select an available guardian');
  return errors;
}

export function applyGuardianChoice(rows: Sf1ImportRow[], choice: GuardianChoice) {
  return rows.map((row) => ({
    ...row,
    guardianChoice: choice === 'father' && !row.fatherName
      ? 'mother'
      : choice === 'mother' && !row.motherName
        ? 'father'
        : choice,
  }));
}

export function parseSf1Rows(rows: unknown[][]): Sf1Workbook {
  const headerIndex = rows.findIndex((row) =>
    row.some((value) => cellText(value).toLowerCase() === 'lrn')
    && row.some((value) => cellText(value).toLowerCase().includes('name (last name')),
  );
  if (headerIndex < 0) throw new Error('This workbook does not contain a recognizable SF1 learner table.');

  const header = rows[headerIndex] ?? [];
  const subheader = rows[headerIndex + 1] ?? [];
  const lrnColumn = findColumn(header, (text) => text === 'lrn');
  const nameColumn = findColumn(header, (text) => text.includes('name (last name'));
  const sexColumn = findColumn(header, (text) => text.startsWith('sex'));
  const fatherColumn = findColumn(subheader, (text) => text.includes("father's name"));
  const motherColumn = findColumn(subheader, (text) => text.includes("mother's maiden name"));
  const contactColumn = findColumn(header, (text) => text.includes('contact number'));

  if ([lrnColumn, nameColumn, fatherColumn, motherColumn].some((column) => column < 0)) {
    throw new Error('The SF1 columns for LRN, learner name, father, or mother could not be found.');
  }

  const parsedRows: Sf1ImportRow[] = [];
  rows.slice(headerIndex + 2).forEach((row, offset) => {
    const lrn = cellText(row[lrnColumn]).replace(/\.0$/, '');
    const name = cellText(row[nameColumn]);
    const sex = sexColumn >= 0 ? cellText(row[sexColumn]).toUpperCase() : '';
    const looksLikeLearner = /^[MF]$/.test(sex) || /^\d{10,15}$/.test(lrn);
    if (!looksLikeLearner || !name || name.includes('<===')) return;

    const parsedName = parseLearnerName(name);
    const fatherName = normalizeGuardianName(cellText(row[fatherColumn]));
    const motherName = normalizeGuardianName(cellText(row[motherColumn]));
    parsedRows.push({
      sourceRow: headerIndex + offset + 3,
      lrn,
      ...parsedName,
      fatherName,
      motherName,
      guardianChoice: fatherName ? 'father' : 'mother',
      phoneNumber: contactColumn >= 0 ? cellText(row[contactColumn]) : '',
    });
  });

  if (parsedRows.length === 0) throw new Error('No learner rows were found in this SF1 workbook.');
  return {
    schoolId: findLabelValue(rows, 'School ID'),
    schoolName: findLabelValue(rows, 'School Name'),
    schoolYear: findLabelValue(rows, 'School Year'),
    gradeLevel: findLabelValue(rows, 'Grade Level'),
    sectionName: findLabelValue(rows, 'Section'),
    rows: parsedRows,
  };
}

export function parseSf1Workbook(buffer: ArrayBuffer): Sf1Workbook {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error('The workbook does not contain a worksheet.');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheet], {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });
  return parseSf1Rows(rows);
}
