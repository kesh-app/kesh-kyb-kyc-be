import * as XLSX from 'xlsx';

export type Sheet = {
  name: string; // xlsx sheet tab name (<=31 chars)
  columns: string[]; // header row
  rows: any[][]; // cell values aligned to columns
};

// Guard against CSV/spreadsheet formula injection: a value that starts with
// = + - @ (or tab/CR variants) is prefixed with an apostrophe so it renders as text.
function sanitize(value: any): string | number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return value;
  const s = typeof value === 'string' ? value : String(value);
  if (/^[=+\-@\t\r]/.test(s)) return `'${s}`;
  return s;
}

export function buildXlsx(sheets: Sheet[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const aoa = [sheet.columns, ...sheet.rows.map((r) => r.map(sanitize))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Auto width (safe, supported by community build) — cap so a long cell can't blow it up.
    ws['!cols'] = sheet.columns.map((_, i) => {
      let max = String(sheet.columns[i] ?? '').length;
      for (const row of sheet.rows) {
        const v = row[i];
        const len = v === null || v === undefined ? 0 : String(v).length;
        if (len > max) max = len;
      }
      return { wch: Math.min(max + 2, 60) };
    });
    // Sheet names must be unique and <=31 chars.
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function csvCell(value: any): string {
  const v = sanitize(value);
  if (v === null) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildCsv(sheet: Sheet): Buffer {
  const lines = [
    sheet.columns.map(csvCell).join(','),
    ...sheet.rows.map((r) => r.map(csvCell).join(',')),
  ];
  // UTF-8 BOM so Excel opens Indonesian characters correctly.
  return Buffer.from('﻿' + lines.join('\r\n'), 'utf8');
}
