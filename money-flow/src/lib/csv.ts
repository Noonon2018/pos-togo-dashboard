import Papa from 'papaparse';
import type { ColumnMapping, DateFormat, Transaction } from './types';
import { normalizeCounterparty } from './normalize';

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/** Parse raw CSV text. Without a header row, columns are named "Column 1", "Column 2", ... */
export function parseCsvText(text: string, hasHeader: boolean): ParsedCsv {
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ''), {
    skipEmptyLines: 'greedy',
  });
  const all = result.data.map((r) => r.map((c) => (c ?? '').trim()));
  if (all.length === 0) return { headers: [], rows: [] };
  const width = Math.max(...all.map((r) => r.length));
  if (hasHeader) {
    const headers = all[0].map((h, i) => h || `Column ${i + 1}`);
    while (headers.length < width) headers.push(`Column ${headers.length + 1}`);
    return { headers, rows: all.slice(1) };
  }
  return { headers: Array.from({ length: width }, (_, i) => `Column ${i + 1}`), rows: all };
}

/** Stable signature of a header row, used to auto-recognize a bank's export format. */
export function headerSignature(headers: string[]): string {
  return headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, '')).join('|');
}

/**
 * Parse money strings: "$1,234.56", "-12.00", "(12.00)", "12.00-", "12.00 CR", "1.234,56" is NOT supported
 * (US banks only). Returns NaN for blanks / garbage.
 */
export function parseAmount(raw: string | undefined): number {
  if (raw == null) return NaN;
  let s = raw.trim().toUpperCase();
  if (!s) return NaN;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, '');
  if (s.endsWith('CR')) s = s.slice(0, -2);
  else if (s.endsWith('DR')) {
    negative = !negative;
    s = s.slice(0, -2);
  }
  s = s.trim();
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d*\.?\d+$/.test(s)) return NaN;
  const n = Number(s);
  return negative ? -n : n;
}

const pad = (n: number) => String(n).padStart(2, '0');

function validDate(y: number, m: number, d: number): string | null {
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Parse a date into ISO YYYY-MM-DD. "auto" = YYYY-MM-DD if year first, else US M/D/Y. */
export function parseDate(raw: string | undefined, format: DateFormat = 'auto'): string | null {
  if (!raw) return null;
  const s = raw.trim().split(/[ T]/)[0];
  const parts = s.split(/[/.-]/).map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const [a, b, c] = parts.map(Number);
  let fmt = format;
  if (fmt === 'auto') fmt = parts[0].length === 4 ? 'YMD' : 'MDY';
  switch (fmt) {
    case 'YMD':
      return validDate(a, b, c);
    case 'DMY':
      return validDate(c, b, a);
    default:
      return validDate(c, a, b);
  }
}

/** Small deterministic hash (FNV-1a) for stable transaction ids. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export interface MapResult {
  transactions: Transaction[];
  errors: { row: number; reason: string }[];
}

/**
 * Convert parsed rows into Transactions. IDs are stable for identical files, so importing the
 * same statement twice does not double-count (the app de-dupes by id).
 */
export function applyMapping(
  parsed: ParsedCsv,
  mapping: ColumnMapping,
  account: string,
  source: string,
): MapResult {
  const col = (name?: string) => (name ? parsed.headers.indexOf(name) : -1);
  const iDate = col(mapping.date);
  const iDesc = col(mapping.description);
  const iAmt = col(mapping.amount);
  const iDeb = col(mapping.debit);
  const iCred = col(mapping.credit);
  const transactions: Transaction[] = [];
  const errors: MapResult['errors'] = [];
  const seen = new Map<string, number>();
  const rowOffset = mapping.hasHeader ? 2 : 1;

  if (iDate < 0 || iDesc < 0) {
    return { transactions, errors: [{ row: 0, reason: 'Date and description columns are required' }] };
  }
  if (mapping.amountMode === 'signed' && iAmt < 0) {
    return { transactions, errors: [{ row: 0, reason: 'Amount column is required' }] };
  }
  if (mapping.amountMode === 'debitCredit' && iDeb < 0 && iCred < 0) {
    return { transactions, errors: [{ row: 0, reason: 'Debit and/or credit column is required' }] };
  }

  parsed.rows.forEach((r, idx) => {
    const rowNo = idx + rowOffset;
    const date = parseDate(r[iDate], mapping.dateFormat);
    if (!date) {
      errors.push({ row: rowNo, reason: `Bad date "${r[iDate] ?? ''}"` });
      return;
    }
    let amount: number;
    if (mapping.amountMode === 'signed') {
      amount = parseAmount(r[iAmt]);
    } else {
      const d = iDeb >= 0 ? parseAmount(r[iDeb]) : NaN;
      const c = iCred >= 0 ? parseAmount(r[iCred]) : NaN;
      if (Number.isNaN(d) && Number.isNaN(c)) amount = NaN;
      else amount = (Number.isNaN(c) ? 0 : Math.abs(c)) - (Number.isNaN(d) ? 0 : Math.abs(d));
    }
    if (Number.isNaN(amount)) {
      errors.push({ row: rowNo, reason: 'Missing/invalid amount' });
      return;
    }
    if (mapping.invert) amount = -amount;
    amount = Math.round(amount * 100) / 100;
    if (amount === 0) return;
    const description = (r[iDesc] ?? '').replace(/\s+/g, ' ').trim();
    const key = `${account}|${date}|${amount}|${description}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    transactions.push({
      id: hash(`${key}|${n}`),
      account,
      date,
      description,
      amount,
      counterparty: normalizeCounterparty(description),
      source,
    });
  });
  return { transactions, errors };
}

/**
 * Best-effort guess of column roles: by header name first, then by looking at the data
 * (needed for header-less exports such as Wells Fargo's).
 */
export function guessMapping(headers: string[], hasHeader: boolean, rows: string[][] = []): ColumnMapping {
  const find = (...res: RegExp[]) => {
    if (!hasHeader) return '';
    for (const re of res) {
      const h = headers.find((x) => re.test(x));
      if (h) return h;
    }
    return '';
  };
  // content-based fallbacks
  const sample = rows.slice(0, 50);
  const share = (i: number, test: (v: string) => boolean) =>
    sample.length ? sample.filter((r) => r[i] != null && r[i] !== '' && test(r[i])).length / sample.length : 0;
  const byContent = (test: (v: string) => boolean, exclude: string[] = []) =>
    headers.find((h, i) => !exclude.includes(h) && share(i, test) >= 0.8) ?? '';
  const textiest = (exclude: string[]) => {
    let best = '';
    let bestLen = 0;
    headers.forEach((h, i) => {
      if (exclude.includes(h)) return;
      const vals = sample.map((r) => r[i] ?? '').filter((v) => /[A-Za-z]{3}/.test(v));
      const len = vals.reduce((s, v) => s + v.length, 0) / Math.max(1, sample.length);
      if (vals.length >= sample.length * 0.6 && len > bestLen) {
        best = h;
        bestLen = len;
      }
    });
    return best;
  };

  const debit = find(/^debit/i, /withdraw/i);
  const credit = find(/^credit$/i, /^credit amount/i, /deposit/i);
  const date =
    find(/^(transaction |trans\.? )?date$/i, /posting date/i, /post(ed)? date/i, /date/i) ||
    byContent((v) => parseDate(v) !== null) ||
    headers[0] ||
    '';
  const amount = find(/^amount$/i, /amount/i) || (debit || credit ? '' : byContent((v) => !Number.isNaN(parseAmount(v)), [date]));
  const description =
    find(/^description$/i, /description/i, /payee/i, /merchant/i, /memo/i, /details/i) || textiest([date, amount, debit, credit]);
  return {
    hasHeader,
    date,
    description,
    amountMode: amount || !(debit || credit) ? 'signed' : 'debitCredit',
    amount: amount || undefined,
    debit: debit || undefined,
    credit: credit || undefined,
    invert: false,
    dateFormat: 'auto',
  };
}
