import Papa from 'papaparse';
import type { ColumnMapping, DateFormat, Transaction } from './types';
import { normalizeCounterparty } from './normalize';

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/**
 * Parse raw CSV text. Without a header row, columns are named "Column 1", "Column 2", ...
 * `skipRows` drops title lines that some exports (Venmo, PayPal) put above the header.
 */
export function parseCsvText(text: string, hasHeader: boolean, skipRows = 0): ParsedCsv {
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
    skipEmptyLines: 'greedy',
  });
  const all = result.data.map((r) => r.map((c) => (c ?? '').trim())).slice(skipRows);
  if (all.length === 0) return { headers: [], rows: [] };
  const width = Math.max(...all.map((r) => r.length));
  if (hasHeader) {
    const headers = all[0].map((h, i) => h || `Column ${i + 1}`);
    while (headers.length < width) headers.push(`Column ${headers.length + 1}`);
    return { headers, rows: all.slice(1) };
  }
  return { headers: Array.from({ length: width }, (_, i) => `Column ${i + 1}`), rows: all };
}

/**
 * Find the header row when an export starts with title lines ("Account Statement - …").
 * The header is the first of the first 15 lines that is mostly filled, has 3+ cells, and
 * contains no dates or money amounts. Returns 0 when the first line already looks like that.
 */
export function findHeaderRow(text: string): number {
  const rows = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy', preview: 15 }).data.map((r) =>
    r.map((c) => (c ?? '').trim()),
  );
  const width = Math.max(0, ...rows.map((r) => r.filter(Boolean).length));
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].filter(Boolean);
    if (cells.length < 3 || cells.length < width * 0.5) continue;
    if (cells.some((c) => parseDate(c) !== null || !Number.isNaN(parseAmount(c)))) continue;
    return i;
  }
  return 0;
}

/**
 * Does the first row look like a header? Bank data rows always contain digits (dates, amounts);
 * header cells don't. Empty header cells (named "Column N" by parseCsvText) are ignored —
 * Venmo's header starts with one.
 */
export function looksLikeHeader(headers: string[]): boolean {
  const real = headers.filter((h) => !/^Column \d+$/.test(h));
  return real.length > 0 && !real.some((h) => /\d/.test(h));
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
  /** "from → to" rows between two other parties (graph only) */
  links: Transaction[];
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
  if (mapping.flow === 'fromTo') return applyFromTo(parsed, mapping, account, source);
  const col = (name?: string) => (name ? parsed.headers.indexOf(name) : -1);
  const iDate = col(mapping.date);
  const iDesc = col(mapping.description);
  const iAmt = col(mapping.amount);
  const iDeb = col(mapping.debit);
  const iCred = col(mapping.credit);
  const transactions: Transaction[] = [];
  const errors: MapResult['errors'] = [];
  const seen = new Map<string, number>();
  const rowOffset = (mapping.hasHeader ? 2 : 1) + (mapping.skipRows ?? 0);

  if (iDate < 0 || iDesc < 0) {
    return { transactions, links: [], errors: [{ row: 0, reason: 'Date and description columns are required' }] };
  }
  if (mapping.amountMode === 'signed' && iAmt < 0) {
    return { transactions, links: [], errors: [{ row: 0, reason: 'Amount column is required' }] };
  }
  if (mapping.amountMode === 'debitCredit' && iDeb < 0 && iCred < 0) {
    return { transactions, links: [], errors: [{ row: 0, reason: 'Debit and/or credit column is required' }] };
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
  return { transactions, links: [], errors };
}

/**
 * Best-effort guess of column roles: by header name first, then by looking at the data
 * (needed for header-less exports such as Wells Fargo's). Detects "from → to" files
 * (Venmo, PayPal, your own Excel) when both a sender and a recipient column exist.
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
      const vals = sample.map((r) => r[i] ?? '').filter((v) => /[A-Za-z\u0E00-\u0E7F]{3}/.test(v));
      const len = vals.reduce((s, v) => s + v.length, 0) / Math.max(1, sample.length);
      if (vals.length >= sample.length * 0.6 && len > bestLen) {
        best = h;
        bestLen = len;
      }
    });
    return best;
  };

  const from = find(/^from$/i, /^from (name|account|email|email address)$/i, /^sender/i, /^payer/i, /^จาก/, /^ผู้โอน|^ผู้ส่ง|^ผู้จ่าย/);
  const to = find(/^to$/i, /^to (name|account|email|email address)$/i, /^recipient/i, /^receiver/i, /^beneficiary/i, /^ไป|^ถึง/, /^ผู้รับ/);
  const fromTo = !!(from && to);

  const debit = fromTo ? '' : find(/^debit/i, /withdraw/i);
  const credit = fromTo ? '' : find(/^credit$/i, /^credit amount/i, /deposit/i);
  const date =
    find(/^(transaction |trans\.? )?date$/i, /posting date/i, /post(ed)? date/i, /date/i, /^วันที่|^วัน/) ||
    byContent((v) => parseDate(v) !== null) ||
    headers[0] ||
    '';
  const amount =
    find(/^amount$/i, /^amount \(total\)/i, /^gross$/i, /amount/i, /^จำนวน|^ยอด/) ||
    (debit || credit ? '' : byContent((v) => !Number.isNaN(parseAmount(v)), [date]));
  const description = fromTo
    ? find(/^note$/i, /^memo$/i, /^description$/i, /^รายละเอียด|^หมายเหตุ|^บันทึก/, /^type$/i, /^name$/i)
    : find(/^description$/i, /description/i, /payee/i, /merchant/i, /memo/i, /details/i) || textiest([date, amount, debit, credit]);
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
    flow: fromTo ? 'fromTo' : 'account',
    from: from || undefined,
    to: to || undefined,
    me: fromTo ? (detectMe({ headers, rows }, from, to) ?? '') : undefined,
  };
}

const cleanName = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * The file owner: the name on (nearly) every row, as in a Venmo/PayPal export of your own account.
 * The bar is high (90%) on purpose: guessing wrong would count someone else's money as yours.
 */
export function detectMe(parsed: ParsedCsv, fromCol: string, toCol: string): string | null {
  const iF = parsed.headers.indexOf(fromCol);
  const iT = parsed.headers.indexOf(toCol);
  if (iF < 0 || iT < 0) return null;
  const rows = parsed.rows.filter((r) => r[iF] || r[iT]);
  const count = new Map<string, number>();
  for (const r of rows) for (const v of new Set([cleanName(r[iF]), cleanName(r[iT])])) if (v) count.set(v, (count.get(v) ?? 0) + 1);
  const [best, n] = [...count.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  return best && rows.length >= 2 && n >= rows.length * 0.9 ? best : null;
}

/**
 * "from → to" files. Rows that involve `me` become normal transactions of `account`
 * (money out when I paid, money in when I was paid); rows between two other people become
 * graph-only links. When the file has signed amounts (Venmo: "- $10.00"), the sign decides
 * the direction for my rows, because a Venmo "charge" lists the requester under From.
 */
function applyFromTo(parsed: ParsedCsv, mapping: ColumnMapping, account: string, source: string): MapResult {
  const col = (name?: string) => (name ? parsed.headers.indexOf(name) : -1);
  const iDate = col(mapping.date);
  const iAmt = col(mapping.amount);
  const iFrom = col(mapping.from);
  const iTo = col(mapping.to);
  const iDesc = col(mapping.description);
  const transactions: Transaction[] = [];
  const links: Transaction[] = [];
  const errors: MapResult['errors'] = [];
  if (iDate < 0 || iAmt < 0 || iFrom < 0 || iTo < 0) {
    return { transactions, links, errors: [{ row: 0, reason: 'Date, From, To and Amount columns are required' }] };
  }
  const me = cleanName(mapping.me);
  const rowOffset = (mapping.hasHeader ? 2 : 1) + (mapping.skipRows ?? 0);
  const signed = parsed.rows.some((r) => /^\s*[-(]/.test(r[iAmt] ?? '') || /-\s*$/.test(r[iAmt] ?? ''));
  const seen = new Map<string, number>();
  const idFor = (key: string) => {
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return hash(`${key}|${n}`);
  };

  parsed.rows.forEach((r, idx) => {
    const rowNo = idx + rowOffset;
    const date = parseDate(r[iDate], mapping.dateFormat);
    const raw = parseAmount(r[iAmt]);
    const from = cleanName(r[iFrom]);
    const to = cleanName(r[iTo]);
    if (!date || Number.isNaN(raw) || raw === 0 || !from || !to) {
      // Venmo puts balance/summary lines without date or parties into the same file
      if (r.some((c) => c)) errors.push({ row: rowNo, reason: !date ? `Bad date "${r[iDate] ?? ''}"` : 'Missing from/to/amount' });
      return;
    }
    const amt = Math.round(Math.abs(raw) * 100) / 100;
    const note = iDesc >= 0 ? (r[iDesc] ?? '').replace(/\s+/g, ' ').trim() : '';
    const description = note ? `${note} (${from} → ${to})` : `${from} → ${to}`;
    const mine = me && (from === me || to === me);
    if (mine) {
      const outflow = signed ? raw < 0 : from === me;
      const other = from === me ? to : from;
      const amount = outflow ? -amt : amt;
      transactions.push({
        id: idFor(`${account}|${date}|${amount}|${description}`),
        account,
        date,
        description,
        amount,
        counterparty: other,
        source,
      });
    } else {
      links.push({
        id: idFor(`link|${date}|${amt}|${from}|${to}|${note}`),
        account: from,
        date,
        description,
        amount: -amt,
        counterparty: to,
        source,
        link: { from, to },
      });
    }
  });
  return { transactions, links, errors };
}
