import { isRuntimeFeatureEnabled } from './runtimeEntitlements';

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

function normalizeCell(value: string | number | boolean | null | undefined): string | number | boolean {
  if (value === null || value === undefined) {
    return '';
  }

  return value;
}

function toMatrix<T>(rows: T[], columns: ExportColumn<T>[]) {
  const headers = columns.map((column) => column.header);
  const values = rows.map((row) => columns.map((column) => normalizeCell(column.value(row))));
  return [headers, ...values];
}

function ensureExtension(fileName: string, extension: string) {
  return fileName.toLowerCase().endsWith(extension) ? fileName : `${fileName}${extension}`;
}

export function downloadCsv<T>(fileName: string, rows: T[], columns: ExportColumn<T>[]) {
  if (!isRuntimeFeatureEnabled('exports_download')) {
    alert('Exports are currently unavailable.');
    return;
  }

  const matrix = toMatrix(rows, columns);

  const csv = matrix
    .map((row) =>
      row
        .map((cell) => String(cell).replaceAll('"', '""'))
        .map((cell) => `"${cell}"`)
        .join(',')
    )
    .join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = ensureExtension(fileName, '.csv');
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export async function downloadExcel<T>(fileName: string, sheetName: string, rows: T[], columns: ExportColumn<T>[]) {
  if (!isRuntimeFeatureEnabled('exports_download')) {
    alert('Exports are currently unavailable.');
    return;
  }

  // Loaded on demand so the ~280KB xlsx library isn't shipped on page load.
  const XLSX = await import('xlsx');
  const matrix = toMatrix(rows, columns);
  const worksheet = XLSX.utils.aoa_to_sheet(matrix);
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, ensureExtension(fileName, '.xlsx'));
}
