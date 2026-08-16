import { describe, expect, it } from 'vitest';
import { buildExportMatrix, type ExportColumn } from './export';

type ReportRow = { name: string; score: number; active: boolean };

const columns: ExportColumn<ReportRow>[] = [
  { header: 'Student', value: (row) => row.name },
  { header: 'Score', value: (row) => row.score },
  { header: 'Active', value: (row) => row.active },
];

describe('report export matrix', () => {
  it('adds report context before a readable data table', () => {
    const result = buildExportMatrix(
      'learner-assessment',
      [{ name: 'Ana Santos', score: 92, active: true }],
      columns,
      {
        title: 'Learner Assessment Report',
        subtitle: 'Beginning of School Year',
        generatedBy: 'School Administrator',
        metadata: [{ label: 'Academic year', value: '2026-2027' }],
      },
    );

    expect(result.matrix[0]).toEqual(['Learner Assessment Report']);
    expect(result.matrix[1]).toEqual(['Beginning of School Year']);
    expect(result.matrix).toContainEqual(['Prepared by', 'School Administrator']);
    expect(result.matrix).toContainEqual(['Records', 1]);
    expect(result.matrix).toContainEqual(['Academic year', '2026-2027']);
    expect(result.matrix[result.headerRowIndex]).toEqual(['Student', 'Score', 'Active']);
    expect(result.matrix[result.headerRowIndex + 1]).toEqual(['Ana Santos', 92, true]);
  });

  it('creates a friendly default title and excludes empty metadata', () => {
    const result = buildExportMatrix('parent_collections', [], columns, {
      metadata: { Search: '', Month: 'August 2026', Optional: null },
    });

    expect(result.title).toBe('Parent Collections');
    expect(result.matrix).toContainEqual(['Month', 'August 2026']);
    expect(result.matrix).not.toContainEqual(['Search', '']);
    expect(result.matrix).toContainEqual(['Records', 0]);
  });
});
