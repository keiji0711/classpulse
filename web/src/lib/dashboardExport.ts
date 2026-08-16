import { isRuntimeFeatureEnabled } from './runtimeEntitlements';

export type DashboardTone = 'teal' | 'green' | 'blue' | 'amber' | 'red' | 'slate';

export interface DashboardMetric {
  label: string;
  value: string | number;
  tone?: DashboardTone;
  progress?: number;
}

export interface DashboardInsight {
  type: 'critical' | 'warning' | 'info' | 'success';
  message: string;
}

export interface DashboardTableSheet {
  name: string;
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number | boolean)[][];
  widths?: number[];
}

export interface DashboardWorkbookOptions {
  title: string;
  subtitle: string;
  generatedBy?: string;
  metadata?: { label: string; value: string | number }[];
  metrics: DashboardMetric[];
  insights?: DashboardInsight[];
  sheets: DashboardTableSheet[];
}

const tones: Record<DashboardTone, { dark: string; light: string }> = {
  teal: { dark: '0F766E', light: 'CCFBF1' },
  green: { dark: '15803D', light: 'DCFCE7' },
  blue: { dark: '0369A1', light: 'E0F2FE' },
  amber: { dark: 'B45309', light: 'FEF3C7' },
  red: { dark: 'BE123C', light: 'FFE4E6' },
  slate: { dark: '475569', light: 'F1F5F9' },
};

function safeFileName(value: string) {
  const name = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '') || 'classpulse-dashboard';
  return `${name}-${new Date().toISOString().slice(0, 10)}.xlsx`;
}

function generatedLabel() {
  return new Intl.DateTimeFormat('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'Asia/Manila', timeZoneName: 'short',
  }).format(new Date());
}

function progressBar(progress?: number) {
  if (progress === undefined) return '';
  const bounded = Math.max(0, Math.min(100, progress));
  const filled = Math.round(bounded / 10);
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${bounded.toFixed(0)}%`;
}

export async function downloadDashboardWorkbook(fileName: string, options: DashboardWorkbookOptions) {
  if (!isRuntimeFeatureEnabled('exports_download')) {
    alert('Exports are currently unavailable.');
    return;
  }

  const XLSX = await import('xlsx-js-style');
  const workbook = XLSX.utils.book_new();
  const overviewRows: (string | number)[][] = [
    [options.title],
    [options.subtitle],
    ['Generated', generatedLabel()],
    ...(options.generatedBy ? [['Prepared by', options.generatedBy]] : []),
    ...(options.metadata ?? []).map((item) => [item.label, item.value]),
    [],
  ];
  const metricStart = overviewRows.length;
  const cardStarts = [0, 3, 6];

  for (let index = 0; index < options.metrics.length; index += 3) {
    const group = options.metrics.slice(index, index + 3);
    const labelRow = Array(8).fill('') as (string | number)[];
    const valueRow = Array(8).fill('') as (string | number)[];
    const barRow = Array(8).fill('') as (string | number)[];
    group.forEach((metric, groupIndex) => {
      const column = cardStarts[groupIndex];
      labelRow[column] = metric.label;
      valueRow[column] = metric.value;
      barRow[column] = progressBar(metric.progress);
    });
    overviewRows.push(labelRow, valueRow, barRow);
  }

  overviewRows.push([], ['KEY INSIGHTS']);
  const insightStart = overviewRows.length;
  for (const insight of options.insights ?? []) overviewRows.push([insight.message]);
  if (!options.insights?.length) overviewRows.push(['No urgent issues were detected for the selected period.']);

  const overview = XLSX.utils.aoa_to_sheet(overviewRows);
  overview['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 3 }, { wch: 22 }, { wch: 16 }, { wch: 3 }, { wch: 22 }, { wch: 16 }];
  overview['!rows'] = overviewRows.map((_, row) => ({ hpt: row === 0 ? 31 : row >= metricStart && row < insightStart - 2 ? 22 : 19 }));
  overview['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },
    { s: { r: insightStart - 1, c: 0 }, e: { r: insightStart - 1, c: 7 } },
  ];
  if (overview.A1) overview.A1.s = { font: { bold: true, sz: 20, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '075F68' } }, alignment: { vertical: 'center' } };
  if (overview.A2) overview.A2.s = { font: { italic: true, sz: 11, color: { rgb: '475569' } }, fill: { fgColor: { rgb: 'ECFEFF' } } };

  for (let index = 0; index < options.metrics.length; index += 1) {
    const groupRow = Math.floor(index / 3);
    const groupColumn = index % 3;
    const row = metricStart + groupRow * 3;
    const column = cardStarts[groupColumn];
    const metric = options.metrics[index];
    const tone = tones[metric.tone ?? 'teal'];
    overview['!merges']!.push(
      { s: { r: row, c: column }, e: { r: row, c: column + 1 } },
      { s: { r: row + 1, c: column }, e: { r: row + 1, c: column + 1 } },
      { s: { r: row + 2, c: column }, e: { r: row + 2, c: column + 1 } },
    );
    const labelCell = overview[XLSX.utils.encode_cell({ r: row, c: column })];
    const valueCell = overview[XLSX.utils.encode_cell({ r: row + 1, c: column })];
    const barCell = overview[XLSX.utils.encode_cell({ r: row + 2, c: column })];
    const fill = { fgColor: { rgb: tone.light } };
    if (labelCell) labelCell.s = { fill, font: { bold: true, sz: 10, color: { rgb: tone.dark } }, alignment: { vertical: 'center' }, border: { top: { style: 'thin', color: { rgb: tone.dark } }, left: { style: 'thin', color: { rgb: tone.dark } }, right: { style: 'thin', color: { rgb: tone.dark } } } };
    if (valueCell) valueCell.s = { fill, font: { bold: true, sz: 18, color: { rgb: '0F172A' } }, alignment: { vertical: 'center' }, border: { left: { style: 'thin', color: { rgb: tone.dark } }, right: { style: 'thin', color: { rgb: tone.dark } } } };
    if (barCell) barCell.s = { fill, font: { bold: true, sz: 9, color: { rgb: tone.dark } }, border: { bottom: { style: 'thin', color: { rgb: tone.dark } }, left: { style: 'thin', color: { rgb: tone.dark } }, right: { style: 'thin', color: { rgb: tone.dark } } } };
  }

  const insightHeader = overview[XLSX.utils.encode_cell({ r: insightStart - 1, c: 0 })];
  if (insightHeader) insightHeader.s = { fill: { fgColor: { rgb: '0F766E' } }, font: { bold: true, color: { rgb: 'FFFFFF' } } };
  (options.insights?.length ? options.insights : [{ type: 'success' as const, message: '' }]).forEach((insight, index) => {
    const row = insightStart + index;
    overview['!merges']!.push({ s: { r: row, c: 0 }, e: { r: row, c: 7 } });
    const cell = overview[XLSX.utils.encode_cell({ r: row, c: 0 })];
    const tone = tones[insight.type === 'critical' ? 'red' : insight.type === 'warning' ? 'amber' : insight.type === 'info' ? 'blue' : 'green'];
    if (cell) cell.s = { fill: { fgColor: { rgb: tone.light } }, font: { color: { rgb: tone.dark } }, alignment: { wrapText: true, vertical: 'center' } };
  });
  XLSX.utils.book_append_sheet(workbook, overview, 'Overview');

  for (const table of options.sheets) {
    const rows = [[table.title], [table.subtitle ?? options.subtitle], ['Generated', generatedLabel()], [], table.headers, ...table.rows];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const lastColumn = Math.max(0, table.headers.length - 1);
    const lastRow = Math.max(4, rows.length - 1);
    worksheet['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: lastColumn } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: lastColumn } },
    ];
    worksheet['!cols'] = table.headers.map((header, index) => ({ wch: table.widths?.[index] ?? Math.min(34, Math.max(13, header.length + 3)) }));
    worksheet['!rows'] = rows.map((_, row) => ({ hpt: row === 0 ? 28 : row === 4 ? 24 : 19 }));
    worksheet['!autofilter'] = { ref: XLSX.utils.encode_range({ r: 4, c: 0 }, { r: lastRow, c: lastColumn }) };
    if (worksheet.A1) worksheet.A1.s = { fill: { fgColor: { rgb: '075F68' } }, font: { bold: true, sz: 18, color: { rgb: 'FFFFFF' } } };
    if (worksheet.A2) worksheet.A2.s = { fill: { fgColor: { rgb: 'ECFEFF' } }, font: { italic: true, color: { rgb: '475569' } } };
    for (let column = 0; column <= lastColumn; column += 1) {
      const headerCell = worksheet[XLSX.utils.encode_cell({ r: 4, c: column })];
      if (headerCell) headerCell.s = { fill: { fgColor: { rgb: '0F766E' } }, font: { bold: true, color: { rgb: 'FFFFFF' } }, alignment: { wrapText: true, vertical: 'center' } };
      for (let row = 5; row <= lastRow; row += 1) {
        const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (!cell) continue;
        const header = table.headers[column].toLowerCase();
        const value = cell.v;
        let fill = row % 2 ? 'FFFFFF' : 'F8FAFC';
        let color = '334155';
        if (typeof value === 'number' && (header.includes('rate') || header.includes('gpa') || header.includes('grade'))) {
          if (value >= 90) { fill = tones.green.light; color = tones.green.dark; }
          else if (value >= 75) { fill = tones.amber.light; color = tones.amber.dark; }
          else { fill = tones.red.light; color = tones.red.dark; }
        }
        if (typeof value === 'string' && value.toUpperCase() === 'CRITICAL') { fill = tones.red.light; color = tones.red.dark; }
        if (typeof value === 'string' && value.toUpperCase() === 'AT-RISK') { fill = tones.amber.light; color = tones.amber.dark; }
        cell.s = { fill: { fgColor: { rgb: fill } }, font: { color: { rgb: color }, bold: header === 'status' }, alignment: { vertical: 'top', wrapText: true } };
      }
    }
    const safeName = table.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Report';
    XLSX.utils.book_append_sheet(workbook, worksheet, safeName);
  }

  XLSX.writeFile(workbook, safeFileName(fileName), { cellStyles: true });
}
