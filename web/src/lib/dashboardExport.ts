import { isRuntimeFeatureEnabled } from './runtimeEntitlements';

export type DashboardTone = 'teal' | 'green' | 'blue' | 'amber' | 'red' | 'slate';
export interface DashboardMetric { label: string; value: string | number; tone?: DashboardTone; progress?: number; }
export interface DashboardInsight { type: 'critical' | 'warning' | 'info' | 'success'; message: string; }
export interface DashboardChart { type: 'line' | 'bar' | 'donut'; title: string; labels: string[]; values: number[]; suffix?: string; colors?: string[]; benchmark?: { value: number; label: string }; }
export interface DashboardTableSheet { name: string; title: string; subtitle?: string; headers: string[]; rows: (string | number | boolean)[][]; widths?: number[]; }
export interface DashboardWorkbookOptions {
  title: string; subtitle: string; generatedBy?: string;
  organizationName?: string; organizationId?: string; logoUrl?: string;
  metadata?: { label: string; value: string | number }[];
  metrics: DashboardMetric[]; insights?: DashboardInsight[]; charts?: DashboardChart[]; sheets: DashboardTableSheet[];
}

const tones: Record<DashboardTone, { dark: string; light: string }> = {
  teal: { dark: '0F766E', light: 'CCFBF1' }, green: { dark: '15803D', light: 'DCFCE7' },
  blue: { dark: '0369A1', light: 'E0F2FE' }, amber: { dark: 'B45309', light: 'FEF3C7' },
  red: { dark: 'BE123C', light: 'FFE4E6' }, slate: { dark: '475569', light: 'F1F5F9' },
};

function safeFileName(value: string) {
  const name = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '') || 'classpulse-dashboard';
  return `${name}-${new Date().toISOString().slice(0, 10)}.xlsx`;
}

function generatedLabel() {
  return new Intl.DateTimeFormat('en-PH', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila', timeZoneName: 'short' }).format(new Date());
}

async function loadLogo(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Logo could not be loaded.');
  const blob = await response.blob();
  if (blob.type === 'image/png' || blob.type === 'image/jpeg') {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
    });
  }
  const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas');
  canvas.width = 240; canvas.height = 240;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Logo could not be rendered.');
  const scale = Math.min(210 / bitmap.width, 210 / bitmap.height), width = bitmap.width * scale, height = bitmap.height * scale;
  context.clearRect(0, 0, 240, 240); context.drawImage(bitmap, (240 - width) / 2, (240 - height) / 2, width, height); bitmap.close();
  return canvas.toDataURL('image/png');
}

function chartCanvas(chart: DashboardChart) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200; canvas.height = 520;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not create the report charts.');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#dbe5ec'; context.lineWidth = 2; context.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
  context.fillStyle = '#0f172a'; context.font = '700 30px Arial'; context.fillText(chart.title, 42, 52);
  if (!chart.values.length) {
    context.fillStyle = '#94a3b8'; context.font = '20px Arial'; context.fillText('No data available for the selected period.', 42, 105);
  } else if (chart.type === 'donut') drawDonut(context, chart);
  else drawCartesian(context, chart);
  return canvas.toDataURL('image/png');
}

function drawCartesian(context: CanvasRenderingContext2D, chart: DashboardChart) {
  const left = 75, right = 35, top = 90, bottom = 75;
  const plotWidth = 1200 - left - right, plotHeight = 520 - top - bottom;
  const maxValue = Math.max(1, ...chart.values, chart.benchmark?.value ?? 0) * 1.12;
  context.font = '16px Arial'; context.textAlign = 'right';
  for (let step = 0; step <= 4; step += 1) {
    const value = maxValue * (4 - step) / 4, y = top + plotHeight * step / 4;
    context.strokeStyle = '#e2e8f0'; context.lineWidth = 1; context.beginPath(); context.moveTo(left, y); context.lineTo(1200 - right, y); context.stroke();
    context.fillStyle = '#64748b'; context.fillText(`${value.toFixed(value < 10 ? 1 : 0)}${chart.suffix ?? ''}`, left - 10, y + 5);
  }
  const primary = chart.colors?.[0] ?? '#0f766e', count = chart.values.length;
  if (chart.benchmark && chart.benchmark.value <= maxValue) {
    const benchmarkY = top + plotHeight - chart.benchmark.value / maxValue * plotHeight;
    context.save(); context.setLineDash([12, 8]); context.strokeStyle = '#64748b'; context.lineWidth = 2;
    context.beginPath(); context.moveTo(left, benchmarkY); context.lineTo(1200 - right, benchmarkY); context.stroke(); context.restore();
    context.fillStyle = '#475569'; context.textAlign = 'right'; context.font = '600 14px Arial';
    context.fillText(`${chart.benchmark.label} ${chart.benchmark.value}${chart.suffix ?? ''}`, 1200 - right, benchmarkY - 8);
  }
  if (chart.type === 'bar') {
    const gap = Math.max(8, plotWidth / count * 0.18), barWidth = Math.max(12, (plotWidth - gap * (count + 1)) / count);
    chart.values.forEach((value, index) => {
      const x = left + gap + index * (barWidth + gap), barHeight = value / maxValue * plotHeight;
      context.fillStyle = chart.colors?.[index % (chart.colors?.length ?? 1)] ?? primary; context.fillRect(x, top + plotHeight - barHeight, barWidth, barHeight);
      context.fillStyle = '#334155'; context.textAlign = 'center'; context.font = '600 14px Arial'; context.fillText(`${value.toFixed(1)}${chart.suffix ?? ''}`, x + barWidth / 2, top + plotHeight - barHeight - 8);
    });
  } else {
    const stepX = count > 1 ? plotWidth / (count - 1) : plotWidth;
    context.beginPath(); chart.values.forEach((value, index) => { const x = left + index * stepX, y = top + plotHeight - value / maxValue * plotHeight; if (index) context.lineTo(x, y); else context.moveTo(x, y); });
    context.strokeStyle = primary; context.lineWidth = 5; context.stroke();
    chart.values.forEach((value, index) => { const x = left + index * stepX, y = top + plotHeight - value / maxValue * plotHeight; context.beginPath(); context.arc(x, y, 6, 0, Math.PI * 2); context.fillStyle = '#fff'; context.fill(); context.strokeStyle = primary; context.lineWidth = 4; context.stroke(); });
  }
  const every = Math.max(1, Math.ceil(count / 8)); context.textAlign = 'center'; context.font = '14px Arial'; context.fillStyle = '#64748b';
  chart.labels.forEach((label, index) => {
    if (index % every && index !== chart.labels.length - 1) return;
    const x = chart.type === 'bar' ? left + plotWidth / count * (index + 0.5) : left + (count > 1 ? plotWidth / (count - 1) * index : plotWidth / 2);
    context.fillText(label.length > 13 ? `${label.slice(0, 11)}…` : label, x, 485);
  });
}

function drawDonut(context: CanvasRenderingContext2D, chart: DashboardChart) {
  const colors = chart.colors ?? ['#10b981', '#f43f5e', '#f59e0b', '#3b82f6'];
  const total = chart.values.reduce((sum, value) => sum + Math.max(0, value), 0);
  const centerX = 310, centerY = 290, radius = 155, innerRadius = 92;
  let angle = -Math.PI / 2;
  chart.values.forEach((value, index) => {
    const portion = total ? Math.max(0, value) / total * Math.PI * 2 : 0;
    context.beginPath(); context.arc(centerX, centerY, radius, angle, angle + portion); context.arc(centerX, centerY, innerRadius, angle + portion, angle, true); context.closePath();
    context.fillStyle = colors[index % colors.length]; context.fill(); angle += portion;
  });
  context.fillStyle = '#0f172a'; context.textAlign = 'center'; context.font = '700 38px Arial'; context.fillText(total.toLocaleString(), centerX, centerY + 5);
  context.fillStyle = '#64748b'; context.font = '16px Arial'; context.fillText('total records', centerX, centerY + 34); context.textAlign = 'left';
  chart.labels.forEach((label, index) => {
    const y = 155 + index * 70, value = chart.values[index] ?? 0, percent = total ? value / total * 100 : 0;
    context.fillStyle = colors[index % colors.length]; context.fillRect(610, y - 18, 28, 28);
    context.fillStyle = '#334155'; context.font = '600 20px Arial'; context.fillText(`${label}: ${value.toLocaleString()} (${percent.toFixed(1)}%)`, 655, y + 4);
  });
}

function triggerDownload(buffer: ArrayBuffer, fileName: string) {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = safeFileName(fileName); document.body.appendChild(anchor); anchor.click(); document.body.removeChild(anchor); URL.revokeObjectURL(url);
}

export async function downloadDashboardWorkbook(fileName: string, options: DashboardWorkbookOptions) {
  if (!isRuntimeFeatureEnabled('exports_download')) { alert('Exports are currently unavailable.'); return; }
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  workbook.creator = 'ClassPulse'; workbook.title = options.title; workbook.subject = options.subtitle; workbook.created = new Date(); workbook.modified = new Date();
  const overview = workbook.addWorksheet('Executive Overview', { views: [{ state: 'frozen', ySplit: 6 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } } });
  for (let column = 1; column <= 12; column += 1) overview.getColumn(column).width = 13;
  overview.mergeCells('A1:B3'); overview.mergeCells('C1:L2');
  const title = overview.getCell('C1'); title.value = options.organizationName ? `${options.organizationName}\n${options.title}` : options.title; title.font = { bold: true, size: 20, color: { argb: 'FFFFFFFF' } }; title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF075F68' } }; title.alignment = { vertical: 'middle', wrapText: true };
  for (let row = 1; row <= 3; row += 1) for (let column = 1; column <= 12; column += 1) overview.getCell(row, column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: row <= 2 ? 'FF075F68' : 'FFECFEFF' } };
  overview.getRow(1).height = 32; overview.getRow(2).height = 32; overview.getRow(3).height = 25; overview.mergeCells('C3:L3');
  overview.getCell('C3').value = `${options.subtitle}${options.organizationId ? ` · DepEd School ID ${options.organizationId}` : ''}`; overview.getCell('C3').font = { italic: true, size: 11, color: { argb: 'FF475569' } }; overview.getCell('C3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFEFF' } };
  try {
    const logo = await loadLogo(options.logoUrl || `${window.location.origin}/classPulseLogo.png`);
    const imageId = workbook.addImage({ base64: logo, extension: 'png' }); overview.addImage(imageId, 'A1:B3');
  } catch { overview.getCell('A1').value = 'ClassPulse'; overview.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }; overview.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' }; }
  overview.getCell('A4').value = 'Generated'; overview.getCell('B4').value = generatedLabel(); overview.getCell('E4').value = 'Prepared by'; overview.getCell('F4').value = options.generatedBy ?? 'School Administrator';
  (options.metadata ?? []).slice(0, 4).forEach((item, index) => { const column = index % 2 ? 7 : 1, row = 5 + Math.floor(index / 2); overview.getCell(row, column).value = item.label; overview.getCell(row, column + 1).value = item.value; overview.getCell(row, column).font = { bold: true, color: { argb: 'FF475569' } }; });
  overview.mergeCells('A7:L7'); overview.getCell('A7').value = 'CONFIDENTIAL · FOR AUTHORIZED SCHOOL MANAGEMENT USE ONLY'; overview.getCell('A7').font = { bold: true, size: 9, color: { argb: 'FF64748B' } }; overview.getCell('A7').alignment = { horizontal: 'center' };
  const metricStart = 8;
  options.metrics.forEach((metric, index) => {
    const column = index % 4 * 3 + 1, row = metricStart + Math.floor(index / 4) * 3, tone = tones[metric.tone ?? 'teal'];
    overview.mergeCells(row, column, row, column + 2); overview.mergeCells(row + 1, column, row + 2, column + 2);
    const label = overview.getCell(row, column); label.value = metric.label.toUpperCase(); label.font = { bold: true, size: 10, color: { argb: `FF${tone.dark}` } }; label.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${tone.light}` } }; label.alignment = { vertical: 'middle' };
    const bounded = Math.max(0, Math.min(100, metric.progress ?? 0)), dots = Math.round(bounded / 10);
    const value = overview.getCell(row + 1, column); value.value = metric.progress === undefined ? String(metric.value) : `${metric.value}\n${'●'.repeat(dots)}${'○'.repeat(10 - dots)}`; value.font = { bold: true, size: 17, color: { argb: 'FF0F172A' } }; value.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${tone.light}` } }; value.alignment = { vertical: 'middle', wrapText: true };
    for (let r = row; r <= row + 2; r += 1) for (let c = column; c <= column + 2; c += 1) overview.getCell(r, c).border = { top: { style: 'thin', color: { argb: `FF${tone.dark}` } }, bottom: { style: 'thin', color: { argb: `FF${tone.dark}` } }, left: { style: 'thin', color: { argb: `FF${tone.dark}` } }, right: { style: 'thin', color: { argb: `FF${tone.dark}` } } };
    overview.getRow(row).height = 20; overview.getRow(row + 1).height = 28; overview.getRow(row + 2).height = 22;
  });
  const insightHeaderRow = metricStart + Math.ceil(options.metrics.length / 4) * 3 + 1;
  overview.mergeCells(insightHeaderRow, 1, insightHeaderRow, 12); overview.getCell(insightHeaderRow, 1).value = 'KEY INSIGHTS AND RECOMMENDED ACTIONS'; overview.getCell(insightHeaderRow, 1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; overview.getCell(insightHeaderRow, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
  const insights = options.insights?.length ? options.insights : [{ type: 'success' as const, message: 'No urgent issues were detected for the selected period.' }];
  insights.slice(0, 6).forEach((insight, index) => {
    const row = insightHeaderRow + index + 1, tone = tones[insight.type === 'critical' ? 'red' : insight.type === 'warning' ? 'amber' : insight.type === 'info' ? 'blue' : 'green'];
    overview.mergeCells(row, 1, row, 12); const cell = overview.getCell(row, 1); cell.value = `• ${insight.message}`; cell.font = { color: { argb: `FF${tone.dark}` } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${tone.light}` } }; cell.alignment = { wrapText: true, vertical: 'middle' }; overview.getRow(row).height = 27;
  });
  const chartStart = insightHeaderRow + Math.min(insights.length, 6) + 2;
  (options.charts ?? []).slice(0, 4).forEach((chart, index) => {
    const imageId = workbook.addImage({ base64: chartCanvas(chart), extension: 'png' }), rowOffset = Math.floor(index / 2) * 16;
    const startColumn = index % 2 ? 'G' : 'A', endColumn = index % 2 ? 'L' : 'F';
    overview.addImage(imageId, `${startColumn}${chartStart + rowOffset}:${endColumn}${chartStart + 14 + rowOffset}`);
  });
  overview.pageSetup.printArea = `A1:L${chartStart + Math.ceil(Math.min(options.charts?.length ?? 0, 4) / 2) * 16}`; overview.headerFooter.oddFooter = '&LClassPulse School Analytics&CPage &P of &N&RConfidential school record';
  options.sheets.forEach((table, sheetIndex) => {
    const sheet = workbook.addWorksheet(table.name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 5 }], pageSetup: { orientation: table.headers.length > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    table.headers.forEach((_, index) => { sheet.getColumn(index + 1).width = table.widths?.[index] ?? 18; });
    sheet.mergeCells(1, 1, 2, Math.max(1, table.headers.length)); const sheetTitle = sheet.getCell(1, 1); sheetTitle.value = table.title; sheetTitle.font = { bold: true, size: 19, color: { argb: 'FFFFFFFF' } }; sheetTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF075F68' } }; sheetTitle.alignment = { vertical: 'middle' };
    sheet.mergeCells(3, 1, 3, Math.max(1, table.headers.length)); sheet.getCell(3, 1).value = table.subtitle ?? options.subtitle; sheet.getCell(3, 1).font = { italic: true, color: { argb: 'FF475569' } }; sheet.getCell(3, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFEFF' } };
    sheet.addTable({ name: `ClassPulseTable${sheetIndex + 1}`, ref: 'A5', headerRow: true, totalsRow: false, style: { theme: 'TableStyleMedium2', showRowStripes: true }, columns: table.headers.map(header => ({ name: header, filterButton: true })), rows: table.rows });
    const header = sheet.getRow(5); header.height = 25; header.font = { bold: true, color: { argb: 'FFFFFFFF' } }; header.alignment = { vertical: 'middle', wrapText: true };
    table.rows.forEach((values, rowIndex) => values.forEach((rawValue, columnIndex) => {
      const label = table.headers[columnIndex].toLowerCase(), cell = sheet.getCell(rowIndex + 6, columnIndex + 1); cell.alignment = { vertical: 'top', wrapText: true };
      if (typeof rawValue === 'number' && (label.includes('rate') || label.includes('gpa') || label.includes('grade'))) { const tone = rawValue >= 90 ? tones.green : rawValue >= 75 ? tones.amber : tones.red; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${tone.light}` } }; cell.font = { bold: true, color: { argb: `FF${tone.dark}` } }; cell.numFmt = '0.0'; }
      if (typeof rawValue === 'string' && ['CRITICAL', 'AT-RISK'].includes(rawValue.toUpperCase())) { const tone = rawValue.toUpperCase() === 'CRITICAL' ? tones.red : tones.amber; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${tone.light}` } }; cell.font = { bold: true, color: { argb: `FF${tone.dark}` } }; }
    }));
    sheet.headerFooter.oddFooter = '&LClassPulse&CPage &P of &N&RConfidential school record';
  });
  const buffer = await workbook.xlsx.writeBuffer(); triggerDownload(buffer as ArrayBuffer, fileName);
}
