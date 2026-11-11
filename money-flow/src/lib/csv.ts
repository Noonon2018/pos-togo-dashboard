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
 * Does the first row look like a header? Data rows contain a date or are mostly numbers; headers
 * don't (a header may still contain digits, e.g. Etherscan's "CurrentValue @ $3000/Eth").
 * Empty header cells (named "Column N" by parseCsvText) are ignored — Venmo's header starts with one.
 */
export function looksLikeHeader(headers: string[]): boolean {
  const real = headers.filter((h) => !/^Column \d+$/.test(h));
  if (!real.length || real.some((h) => parseDate(h) !== null)) return false;
  const numeric = real.filter((h) => !Number.isNaN(parseAmount(h))).length;
  return numeric < real.length * 0.5;
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
  if (/^\d+(\.\d+)?e[-+]?\d+$/i.test(s)) {
    const n = Number(s); // 1.2E-05 (spreadsheets, crypto exports)
    return negative ? -n : n;
  }
  if (!/^\d*\.?\d+$/.test(s)) return NaN;
  const n = Number(s);
  return negative ? -n : n;
}

const pad = (n: number) => String(n).padStart(2, '0');

function validDate(y: number, m: number, d: number): string | null {
  if (y > 2400) y -= 543; // Thai Buddhist Era (พ.ศ.) → CE
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

const THAI_MONTHS: [RegExp, number][] = [
  [/^ม\.?ค\.?$|^มกรา/, 1], [/^ก\.?พ\.?$|^กุมภา/, 2], [/^มี\.?ค\.?$|^มีนา/, 3], [/^เม\.?ย\.?$|^เมษา/, 4],
  [/^พ\.?ค\.?$|^พฤษภา/, 5], [/^มิ\.?ย\.?$|^มิถุนา/, 6], [/^ก\.?ค\.?$|^กรกฎา/, 7], [/^ส\.?ค\.?$|^สิงหา/, 8],
  [/^ก\.?ย\.?$|^กันยา/, 9], [/^ต\.?ค\.?$|^ตุลา/, 10], [/^พ\.?ย\.?$|^พฤศจิกา/, 11], [/^ธ\.?ค\.?$|^ธันวา/, 12],
];

/** Two-digit years in Thai (day-first) files are Buddhist Era: 67 → พ.ศ. 2567 → 2024. */
const thaiYear = (y: number) => (y < 100 ? (y >= 40 ? 2500 + y : 2000 + y) : y);

/**
 * Parse a date into ISO YYYY-MM-DD. "auto": YYYY-MM-DD when the year comes first; day-first when the
 * first number is over 12 or the year is Buddhist Era (Thai banks); otherwise US month/day/year.
 * Also reads Thai month names ("5 มี.ค. 67", "5 มีนาคม 2567").
 */
export function parseDate(raw: string | undefined, format: DateFormat = 'auto'): string | null {
  if (!raw) return null;
  if (/^\d{9,11}$/.test(raw.trim())) {
    // unix seconds (blockchain explorers' "UnixTimestamp")
    const d = new Date(Number(raw.trim()) * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const th = raw.trim().match(/^(\d{1,2})\s*([\u0E00-\u0E7F.]+)\s*(\d{2,4})/);
  if (th) {
    const month = THAI_MONTHS.find(([re]) => re.test(th[2]))?.[1];
    return month ? validDate(thaiYear(Number(th[3])), month, Number(th[1])) : null;
  }
  const s = raw.trim().split(/[ T]/)[0];
  const parts = s.split(/[/.-]/).map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const [a, b, c] = parts.map(Number);
  let fmt = format;
  if (fmt === 'auto') fmt = parts[0].length === 4 ? 'YMD' : a > 12 || c > 2400 ? 'DMY' : 'MDY';
  switch (fmt) {
    case 'YMD':
      return validDate(a, b, c);
    case 'DMY':
      return validDate(parts[2].length <= 2 ? thaiYear(c) : c, b, a);
    default:
      return validDate(c, a, b);
  }
}

/** Day-first? True when any date in the sample has a first number over 12 or a Buddhist-Era year. */
export function looksDayFirst(values: string[]): boolean {
  return values.some((v) => {
    const p = v.trim().split(/[ T]/)[0].split(/[/.-]/);
    return p.length === 3 && p[0].length <= 2 && (Number(p[0]) > 12 || Number(p[2]) > 2400);
  });
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
  /** address -> name tag found in the file (explorer exports that include name tags) */
  labels?: Record<string, string>;
}

/**
 * Date AND time in ISO (UTC) when the cell has a time: "2026-08-03 18:20:00", "2026-08-03T18:20:00Z",
 * or unix seconds. Null when there is no time part (bank files only have dates).
 */
export function parseDateTime(raw: string | undefined, format: DateFormat = 'auto'): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (/^\d{9,11}$/.test(v)) {
    const d = new Date(Number(v) * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().replace('.000', '');
  }
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/);
  if (!m) {
    // "05/03/2567 10:15" (day-first / Thai) → reuse parseDate for the date part
    const dt = v.match(/^(\S+(?:\s+[\u0E00-\u0E7F.]+\s+\d{2,4})?)\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/);
    const iso = dt ? parseDate(dt[1], format) : null;
    if (!dt || !iso) return null;
    m = [v, iso.slice(0, 4), iso.slice(5, 7), iso.slice(8, 10), dt[2], dt[3], dt[4]] as unknown as RegExpMatchArray;
  }
  const [, y, mo, d, h, mi, se] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(se ?? 0)));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().replace('.000', '');
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
  const iTime = col(mapping.timeCol);
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
    const time = iTime >= 0 && r[iTime] ? parseDateTime(`${r[iDate]} ${r[iTime]}`, mapping.dateFormat) : null;
    const key = `${account}|${date}|${amount}|${description}${time ? `|${time}` : ''}`;
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
      ...(time ? { time } : {}),
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

  const from = find(/^from$/i, /^from[ _]?(name|account|email|email address|address)$/i, /^sender/i, /^payer/i, /^จาก/, /^ผู้โอน|^ผู้ส่ง|^ผู้จ่าย/);
  const to = find(/^to$/i, /^to[ _]?(name|account|email|email address|address)$/i, /^recipient/i, /^receiver/i, /^beneficiary/i, /^ไป|^ถึง/, /^ผู้รับ/);
  const fromTo = !!(from && to);

  // blockchain explorer exports (Etherscan, Blockscout, …)
  const valueIn = fromTo ? find(/^value[_ ]?in\b/i) : '';
  const valueOut = fromTo ? find(/^value[_ ]?out\b/i) : '';
  const unitCol = fromTo ? find(/^(token ?symbol|symbol|asset|currency|coin)$/i) : '';
  const iF = headers.indexOf(from);
  const iT = headers.indexOf(to);
  const addrRows = sample.filter((r) => isCryptoAddress(r[iF] ?? '') || isCryptoAddress(r[iT] ?? '')).length;
  const crypto = fromTo && !!(valueIn || unitCol || (sample.length > 0 && addrRows / sample.length >= 0.6));
  const unitFromHeader = (h: string) => h.match(/\(([A-Z][A-Z0-9]{1,9})\)/)?.[1] ?? '';

  const debit = fromTo ? '' : find(/^debit/i, /withdraw/i, /^ถอน/, /^เดบิต/, /^จ่าย/, /^เงินออก/);
  const credit = fromTo ? '' : find(/^credit$/i, /^credit amount/i, /deposit/i, /^ฝาก/, /^เครดิต/, /^รับ/, /^เงินเข้า/);
  const date =
    find(/^(transaction |trans\.? )?date$/i, /posting date/i, /post(ed)? date/i, /date/i, /^วันที่|^วัน/, /timestamp/i) ||
    byContent((v) => parseDate(v) !== null) ||
    headers[0] ||
    '';
  const amount = crypto
    ? find(/^(token ?value|tokens? ?transferred|value|quantity|amount)$/i, /^value\b/i, /amount/i)
    : find(/^amount$/i, /^amount \(total\)/i, /^gross$/i, /amount/i, /^จำนวนเงิน$|^จำนวน$|^ยอดเงิน$|^ยอดโอน$/) ||
      (debit || credit ? '' : byContent((v) => !Number.isNaN(parseAmount(v)), [date]));
  const description = crypto
    ? find(/^method$/i, /^method ?name$/i, /^type$/i, /^note$/i)
    : fromTo
    ? find(/^note$/i, /^memo$/i, /^description$/i, /^รายละเอียด|^หมายเหตุ|^บันทึก/, /^type$/i, /^name$/i)
    : find(/^description$/i, /description/i, /payee/i, /merchant/i, /memo/i, /details/i, /^รายละเอียด|^คำอธิบาย/, /^รายการ/) ||
      textiest([date, amount, debit, credit]);
  const timeCol = find(/^(time|เวลา)$/i);
  const iDateCol = headers.indexOf(date);
  const dayFirst = iDateCol >= 0 && looksDayFirst(sample.map((r) => r[iDateCol] ?? ''));
  return {
    hasHeader,
    date,
    description,
    ...(valueIn && valueOut
      ? { amountMode: 'debitCredit' as const, amount: undefined, debit: valueOut, credit: valueIn }
      : {
          amountMode: amount || !(debit || credit) ? ('signed' as const) : ('debitCredit' as const),
          amount: amount || undefined,
          debit: debit || undefined,
          credit: credit || undefined,
        }),
    invert: false,
    dateFormat: dayFirst ? 'DMY' : 'auto',
    ...(timeCol ? { timeCol } : {}),
    flow: fromTo ? 'fromTo' : 'account',
    ...(crypto
      ? {
          crypto: true,
          unit: unitFromHeader(valueIn || amount) || (unitCol ? '' : unitFromAddresses(sample.flatMap((r) => [r[iF] ?? '', r[iT] ?? '']))),
          unitCol: unitCol || undefined,
          statusCol: find(/^status$/i) || undefined,
          hashCol: find(/^(txhash|tx ?hash|transaction ?hash|hash)$/i) || undefined,
        }
      : {}),
    from: from || undefined,
    to: to || undefined,
    me: fromTo ? (detectMe({ headers, rows }, from, to) ?? '') : undefined,
  };
}

/** Party names: upper case for people/shops; crypto addresses keep their exact form (hex in lower case). */
const cleanName = (s: string | undefined) => {
  const v = (s ?? '').replace(/\s+/g, ' ').trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return v.toLowerCase();
  if (isCryptoAddress(v)) return v;
  return v.toUpperCase();
};

/** Ethereum-style (0x + 40 hex), Bitcoin (1…, 3…, bc1…), and other long base58/bech32 addresses. */
export function isCryptoAddress(v: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(v) || /^(bc1|tb1)[02-9ac-hj-np-z]{20,90}$/.test(v) || /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(v) || /^xch1[02-9ac-hj-np-z]{40,90}$/.test(v);
}

/** Best guess of the coin from address formats; the user can correct it in the import dialog. */
export function unitFromAddresses(values: string[]): string {
  const count = (re: RegExp) => values.filter((v) => re.test(v)).length;
  const scores: [string, number][] = [
    ['ETH', count(/^0x[0-9a-fA-F]{40}$/)],
    ['BTC', count(/^(bc1|[13])[0-9A-Za-z]{25,90}$/)],
    ['XCH', count(/^xch1/)],
  ];
  const best = scores.sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : 'COIN';
}

/** 0xd8da6bf26964af9d7eed9e03e53415d37aa96045 -> 0xd8da…6045 */
export function shortAddress(v: string): string {
  return isCryptoAddress(v) && v.length > 14 ? `${v.slice(0, 6)}…${v.slice(-4)}` : v;
}

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
  const iIn = col(mapping.credit);
  const iOut = col(mapping.debit);
  const inOut = mapping.amountMode === 'debitCredit' && (iIn >= 0 || iOut >= 0);
  const iUnit = col(mapping.unitCol);
  const iStatus = col(mapping.statusCol);
  const iErr = parsed.headers.findIndex((h) => /^err(or)?[ _]?code$/i.test(h));
  const iHash = col(mapping.hashCol);
  const iTimeFT = col(mapping.timeCol);
  // explorer exports may carry public name tags next to the addresses
  const iFromTag = parsed.headers.findIndex((h) => /^from[ _]?(name ?tag|nametag|label|name)$/i.test(h) && h !== mapping.from);
  const iToTag = parsed.headers.findIndex((h) => /^to[ _]?(name ?tag|nametag|label|name)$/i.test(h) && h !== mapping.to);
  const labels: Record<string, string> = {};
  if (iDate < 0 || (iAmt < 0 && !inOut) || iFrom < 0 || iTo < 0) {
    return { transactions, links, errors: [{ row: 0, reason: 'Date, From, To and Amount columns are required' }] };
  }
  const me = cleanName(mapping.me);
  const rowOffset = (mapping.hasHeader ? 2 : 1) + (mapping.skipRows ?? 0);
  const signed = !mapping.crypto && iAmt >= 0 && parsed.rows.some((r) => /^\s*[-(]/.test(r[iAmt] ?? '') || /-\s*$/.test(r[iAmt] ?? ''));
  const rowAmount = (r: string[]) => {
    if (!inOut) return parseAmount(r[iAmt]);
    const vin = iIn >= 0 ? parseAmount(r[iIn]) : NaN;
    const vout = iOut >= 0 ? parseAmount(r[iOut]) : NaN;
    if (Math.abs(vin) > 0) return Math.abs(vin);
    if (Math.abs(vout) > 0) return Math.abs(vout);
    return Number.isNaN(vin) && Number.isNaN(vout) ? NaN : 0;
  };
  const seen = new Map<string, number>();
  const idFor = (key: string) => {
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return hash(`${key}|${n}`);
  };

  parsed.rows.forEach((r, idx) => {
    const rowNo = idx + rowOffset;
    const date = parseDate(r[iDate], mapping.dateFormat);
    const raw = rowAmount(r);
    const from = cleanName(r[iFrom]);
    const to = cleanName(r[iTo]);
    if (mapping.crypto && ((iStatus >= 0 && /error|fail|revert/i.test(r[iStatus] ?? '')) || (iErr >= 0 && (r[iErr] ?? '').trim()))) {
      errors.push({ row: rowNo, reason: 'Failed transaction (no money moved)' });
      return;
    }
    if (mapping.crypto && raw === 0) return; // contract calls / approvals: nothing moved
    if (!date || Number.isNaN(raw) || raw === 0 || !from || !to) {
      // Venmo puts balance/summary lines without date or parties into the same file
      if (r.some((c) => c)) errors.push({ row: rowNo, reason: !date ? `Bad date "${r[iDate] ?? ''}"` : 'Missing from/to/amount' });
      return;
    }
    const note = iDesc >= 0 ? (r[iDesc] ?? '').replace(/\s+/g, ' ').trim() : '';
    if (mapping.crypto) {
      // coins keep their own unit and precision; every row is graph-only (never your dollar income/spending)
      const unit = ((iUnit >= 0 ? r[iUnit] : '') || mapping.unit || 'COIN').trim().toUpperCase();
      const amt = Math.round(Math.abs(raw) * 1e8) / 1e8;
      const hash = iHash >= 0 ? (r[iHash] ?? '').trim() : '';
      // addresses stay as names, so the same address in another wallet's file joins up in the graph;
      // `account` holds your wallet address on your own rows (drawn as your wallet), '' otherwise
      const description = [note, hash ? `tx ${hash.slice(0, 10)}…` : '', `${shortAddress(from)} → ${shortAddress(to)}`].filter(Boolean).join(' · ');
      const time = parseDateTime(r[iDate], mapping.dateFormat) ?? (iTimeFT >= 0 && r[iTimeFT] ? parseDateTime(`${r[iDate]} ${r[iTimeFT]}`, mapping.dateFormat) : null);
      if (iFromTag >= 0 && r[iFromTag]?.trim()) labels[from] = r[iFromTag].trim();
      if (iToTag >= 0 && r[iToTag]?.trim()) labels[to] = r[iToTag].trim();
      links.push({
        id: idFor(`crypto|${hash}|${date}|${amt}|${unit}|${from}|${to}`),
        account: me && (from === me || to === me) ? me : '',
        date,
        ...(time ? { time } : {}),
        description,
        amount: -amt,
        counterparty: to,
        source,
        unit,
        link: { from, to },
      });
      return;
    }
    const amt = Math.round(Math.abs(raw) * 100) / 100;
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
      const time = parseDateTime(r[iDate], mapping.dateFormat) ?? (iTimeFT >= 0 && r[iTimeFT] ? parseDateTime(`${r[iDate]} ${r[iTimeFT]}`, mapping.dateFormat) : null);
      links.push({
        id: idFor(`link|${date}|${amt}|${from}|${to}|${note}`),
        account: from,
        date,
        ...(time ? { time } : {}),
        description,
        amount: -amt,
        counterparty: to,
        source,
        link: { from, to },
      });
    }
  });
  return { transactions, links, errors, ...(Object.keys(labels).length ? { labels } : {}) };
}
