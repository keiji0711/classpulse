import { isRuntimeFeatureEnabled } from './runtimeEntitlements';

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
  width?: number;
  numberFormat?: string;
}

export interface ExportMetadataItem {
  label: string;
  value: string | number | boolean | null | undefined;
}

export interface ExportOptions {
  title?: string;
  subtitle?: string;
  metadata?: ExportMetadataItem[] | Record<string, string | number | boolean | null | undefined>;
  generatedBy?: string;
  appendDateToFileName?: boolean;
}

type ExportCell = string | number | boolean;

function normalizeCell(value: string | number | boolean | null | undefined): ExportCell {
  if (value === null || value === undefined) return '';
  return value;
}

function titleFromFileName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeMetadata(metadata: ExportOptions['metadata']): ExportMetadataItem[] {
  if (!metadata) return [];
  if (Array.isArray(metadata)) return metadata;
  return Object.entries(metadata).map(([label, value]) => ({ label, value }));
}

function generatedLabel() {
  return new Intl.DateTimeFormat('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'Asia/Manila', timeZoneName: 'short',
  }).format(new Date());
}

export function buildExportMatrix<T>(fileName: string, rows: T[], columns: ExportColumn<T>[], options: ExportOptions = {}) {
  const title = options.title?.trim() || titleFromFileName(fileName);
  const metadata = normalizeMetadata(options.metadata).filter((item) => item.value !== '' && item.value !== null && item.value !== undefined);
  const reportRows: ExportCell[][] = [[title]];
  if (options.subtitle?.trim()) reportRows.push([options.subtitle.trim()]);
  reportRows.push(['Generated', generatedLabel()]);
  if (options.generatedBy?.trim()) reportRows.push(['Prepared by', options.generatedBy.trim()]);
  reportRows.push(['Records', rows.length]);
  metadata.forEach((item) => reportRows.push([item.label, normalizeCell(item.value)]));
  reportRows.push([]);

  const headerRowIndex = reportRows.length;
  reportRows.push(columns.map((column) => column.header));
  reportRows.push(...rows.map((row) => columns.map((column) => normalizeCell(column.value(row)))));
  return { matrix: reportRows, headerRowIndex, title };
}

function ensureExtension(fileName: string, extension: string, appendDate = true) {
  const safeName = fileName.replace(/\.[^.]+$/, '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '') || 'classpulse-report';
  const dateSuffix = appendDate ? `-${new Date().toISOString().slice(0, 10)}` : '';
  return `${safeName}${dateSuffix}${extension}`;
}

function assertExportsEnabled() {
  if (isRuntimeFeatureEnabled('exports_download')) return true;
  alert('Exports are currently unavailable.');
  return false;
}

export function downloadCsv<T>(fileName: string, rows: T[], columns: ExportColumn<T>[], options: ExportOptions = {}) {
  if (!assertExportsEnabled()) return;
  const { matrix } = buildExportMatrix(fileName, rows, columns, options);
  const csv = matrix.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = ensureExtension(fileName, '.csv', options.appendDateToFileName !== false);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export async function downloadExcel<T>(fileName: string, sheetName: string, rows: T[], columns: ExportColumn<T>[], options: ExportOptions = {}) {
  if (!assertExportsEnabled()) return;
  const XLSX = await import('xlsx');
  const { matrix, headerRowIndex } = buildExportMatrix(fileName, rows, columns, options);
  const worksheet = XLSX.utils.aoa_to_sheet(matrix);
  const workbook = XLSX.utils.book_new();
  const lastColumn = Math.max(0, columns.length - 1);
  const lastRow = Math.max(headerRowIndex, matrix.length - 1);

  worksheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastColumn } },
    ...(options.subtitle?.trim() ? [{ s: { r: 1, c: 0 }, e: { r: 1, c: lastColumn } }] : []),
  ];
  worksheet['!autofilter'] = { ref: XLSX.utils.encode_range({ r: headerRowIndex, c: 0 }, { r: lastRow, c: lastColumn }) };
  (worksheet as typeof worksheet & { '!freeze'?: unknown })['!freeze'] = { xSplit: 0, ySplit: headerRowIndex + 1 };
  worksheet['!rows'] = matrix.map((_, rowIndex) => ({ hpt: rowIndex === 0 ? 27 : rowIndex === headerRowIndex ? 23 : 19 }));
  worksheet['!cols'] = columns.map((column, columnIndex) => {
    const longest = Math.max(column.header.length, ...rows.slice(0, 500).map((row) => String(normalizeCell(column.value(row))).length));
    return { wch: column.width ?? Math.min(42, Math.max(12, longest + (columnIndex === 0 ? 3 : 2))) };
  });

  const titleCell = worksheet.A1;
  if (titleCell) titleCell.s = { font: { bold: true, sz: 18, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '075F68' } }, alignment: { vertical: 'center' } };
  if (options.subtitle?.trim() && worksheet.A2) worksheet.A2.s = { font: { italic: true, color: { rgb: '475569' } } };

  for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
    const headerCell = worksheet[XLSX.utils.encode_cell({ r: headerRowIndex, c: columnIndex })];
    if (headerCell) headerCell.s = {
      font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '0F766E' } },
      alignment: { vertical: 'center', wrapText: true }, border: { bottom: { style: 'thin', color: { rgb: '0B5F59' } } },
    };
    for (let rowIndex = headerRowIndex + 1; rowIndex <= lastRow; rowIndex += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
      if (!cell) continue;
      cell.s = { alignment: { vertical: 'top', wrapText: true }, fill: rowIndex % 2 === 0 ? { fgColor: { rgb: 'F8FAFC' } } : undefined };
      if (columns[columnIndex].numberFormat && typeof cell.v === 'number') cell.z = columns[columnIndex].numberFormat;
    }
  }

  const safeSheetName = sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Report';
  XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName);
  XLSX.writeFile(workbook, ensureExtension(fileName, '.xlsx', options.appendDateToFileName !== false), { cellStyles: true });
}
