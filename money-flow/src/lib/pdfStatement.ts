import type { ParsedCsv } from './csv';
import { parseAmount, parseDate } from './csv';

/**
 * Turn the text lines of a bank statement PDF into rows the normal import step understands
 * (Date, Description, Amount, Balance). Works on the common US layout:
 *
 *   MM/DD  description text ......  amount  [balance]
 *          (description may wrap onto the next line)
 *
 * Tested against Chase checking statements; other banks with the same shape usually work too.
 */

export interface StatementInfo {
  bank: string | null;
  last4: string | null;
  product: string | null;
  periodStart: string | null; // ISO
  periodEnd: string | null;
  beginning: number | null;
  ending: number | null;
}

export interface StatementResult {
  parsed: ParsedCsv;
  info: StatementInfo;
  hasBalance: boolean;
  /** Rows whose printed balance didn't match the running total (0 = all good). */
  balanceMismatches: number;
  /** beginning + Σamounts − ending; 0 means the statement reconciles. null if unknown. */
  reconcileDiff: number | null;
  suggestedAccount: string;
  /** set for DoorDash merchant statements (not a bank statement) */
  doordash?: { payouts: number; net: number };
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONEY = /^\(?-?\$?\d{1,3}(,\d{3})*\.\d{2}\)?-?$|^\(?-?\$?\d+\.\d{2}\)?-?$/;
const START = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(.*)$/;
// lines that end a transaction block (headers, footers, totals, statement boilerplate)
const STOP =
  /^(ending balance|beginning balance|total\b|page \d+ of|transaction detail|date\s+description|\*start\*|\*end\*|in case of errors|daily ending balance|checking summary|service fee|this page intentionally|ยอดยกมา|ยอดยกไป|ยอดคงเหลือยก|รวม|หน้าที่|หน้า \d|วันที่\s+(เวลา\s+)?รายการ)/i;
// Thai statements: "05 มี.ค. 67 ..." (Thai month name)
const START_TH = /^(\d{1,2})\s+([\u0E00-\u0E7F.]{2,10})\s+(\d{2,4})\s+(.*)$/;
const THAI = /[\u0E00-\u0E7F]/;

const pad = (n: number) => String(n).padStart(2, '0');

function parseLongDate(s: string): { y: number; m: number; d: number } | null {
  const m = s.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return null;
  const mi = MONTHS.indexOf(m[1].toLowerCase());
  return mi < 0 ? null : { y: Number(m[3]), m: mi + 1, d: Number(m[2]) };
}

export function statementInfo(text: string): StatementInfo {
  const period =
    text.match(/([A-Za-z]+ \d{1,2},? \d{4})\s*(?:through|to|-|–)\s*([A-Za-z]+ \d{1,2},? \d{4})/i) ?? null;
  const ps = period ? parseLongDate(period[1]) : null;
  const pe = period ? parseLongDate(period[2]) : null;
  const iso = (x: { y: number; m: number; d: number } | null) => (x ? `${x.y}-${pad(x.m)}-${pad(x.d)}` : null);
  const money = (re: RegExp) => {
    const m = text.match(re);
    return m ? parseAmount(m[1]) : null;
  };
  const acct =
    text.match(/Account (?:Number|No\.?|#)\s*:?\s*[X*\d\s-]*?(\d{4})\b/i) ??
    text.match(/(?:เลขที่บัญชี|บัญชีเลขที่)\s*:?\s*[\dXx* -]*?(\d{4})(?:-\w)?(?:\s|$)/);
  const bank = /กสิกร|KASIKORN|K ?PLUS/i.test(text)
    ? 'KBank'
    : /ไทยพาณิชย์|\bSCB\b/.test(text)
      ? 'SCB'
      : /กรุงไทย|KRUNGTHAI/i.test(text)
        ? 'KTB'
        : /กรุงศรี|KRUNGSRI/i.test(text)
          ? 'Krungsri'
          : /กรุงเทพ|BANGKOK BANK/i.test(text)
            ? 'BBL'
            : /\bchase\b/i.test(text)
    ? 'Chase'
    : /bank of america/i.test(text)
      ? 'BofA'
      : /wells fargo/i.test(text)
        ? 'Wells Fargo'
        : /capital one/i.test(text)
          ? 'Capital One'
          : /citibank|\bciti\b/i.test(text)
            ? 'Citi'
            : null;
  // Title-case product name ("Chase College Checking"), not the "CHECKING SUMMARY" heading
  const product =
    text.match(/\b(Chase(?: [A-Z][a-z]+){0,3} (?:Checking|Savings))\b/)?.[1] ??
    text.match(/\b((?:[A-Z][a-z]+ ){1,3}(?:Checking|Savings))\b/)?.[1] ??
    null;
  return {
    bank,
    last4: acct?.[1] ?? null,
    product,
    periodStart: iso(ps),
    periodEnd: iso(pe),
    beginning:
      money(/Beginning Balance\s*\$?\s*(-?[\d,]+\.\d{2})/i) ??
      money(/(?:ยอดยกมา|ยอดคงเหลือยกมา|BALANCE B\/F|BROUGHT FORWARD)\s*:?\s*(-?[\d,]+\.\d{2})/i),
    ending:
      money(/Ending Balance\s*\$?\s*(-?[\d,]+\.\d{2})/i) ??
      money(/(?:ยอดยกไป|ยอดคงเหลือยกไป|BALANCE C\/F|CARRIED FORWARD)\s*:?\s*(-?[\d,]+\.\d{2})/i),
  };
}

/** Pick the year for an MM/DD inside a statement period that may cross New Year. */
function yearFor(month: number, info: StatementInfo, fallbackYear: number): number {
  if (!info.periodStart || !info.periodEnd) return fallbackYear;
  const [sy, sm] = info.periodStart.split('-').map(Number);
  const [ey] = info.periodEnd.split('-').map(Number);
  if (sy === ey) return sy;
  return month >= sm ? sy : ey;
}

export function parseStatementLines(lines: string[], fallbackYear = new Date().getFullYear()): StatementResult {
  const text = lines.join('\n');
  const info = statementInfo(text);

  // 1) group lines into blocks that start with a date
  const thaiDoc = THAI.test(text); // Thai statements write day/month/(Buddhist-Era) year
  const blocks: { m: number; d: number; y?: number; iso?: string; parts: string[] }[] = [];
  let cur: (typeof blocks)[number] | null = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const st = line.match(START);
    const th = thaiDoc ? line.match(START_TH) : null;
    const thIso = th ? parseDate(`${th[1]} ${th[2]} ${th[3]}`) : null;
    if (th && thIso) {
      cur = { m: 0, d: 0, iso: thIso, parts: [th[4]] };
      blocks.push(cur);
    } else if (st && thaiDoc && Number(st[1]) <= 31 && Number(st[2]) <= 12) {
      const iso = st[3] ? parseDate(`${st[1]}/${st[2]}/${st[3]}`, 'DMY') : null;
      cur = { m: Number(st[2]), d: Number(st[1]), ...(iso ? { iso } : {}), parts: [st[4]] };
      blocks.push(cur);
    } else if (st && Number(st[1]) <= 12 && Number(st[2]) <= 31) {
      cur = { m: Number(st[1]), d: Number(st[2]), y: st[3] ? Number(st[3]) : undefined, parts: [st[4]] };
      blocks.push(cur);
    } else if (STOP.test(line)) {
      cur = null;
    } else if (cur && cur.parts.length < 4) {
      cur.parts.push(line); // wrapped description (or the amount on its own line)
    }
  }

  // 2) inside each block the trailing money tokens are amount [+ balance]
  type Row = { date: string; desc: string; amount: number; balance: number | null };
  const rows: Row[] = [];
  for (const b of blocks) {
    // pdf.js often splits the sign from the number ("- 14.70", "$ 1,000.00"): glue them back
    const tokens = b.parts
      .join(' ')
      .replace(/^\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s+/, '') // time column ("10:15") before the description
      .replace(/(^|\s)(-|\$|-\$)\s+(?=[\d$])/g, '$1$2')
      .split(' ');
    const money: number[] = [];
    const desc: string[] = [];
    for (const t of tokens) {
      if (MONEY.test(t)) money.push(parseAmount(t.replace(/^\((.*)\)$/, '-$1')));
      else desc.push(t);
    }
    if (money.length === 0 || desc.length === 0) continue;
    const amount = money.length >= 2 ? money[money.length - 2] : money[0];
    const balance = money.length >= 2 ? money[money.length - 1] : null;
    let y = b.y ?? yearFor(b.m, info, fallbackYear);
    if (y > 2400) y -= 543;
    if (y < 100) y += 2000;
    rows.push({ date: b.iso ?? `${y}-${pad(b.m)}-${pad(b.d)}`, desc: desc.join(' '), amount, balance });
  }

  // 3) with a balance column, trust the balance to fix signs and to check the extraction
  const hasBalance = rows.length > 0 && rows.filter((r) => r.balance !== null).length >= rows.length * 0.8;
  let mismatches = 0;
  if (hasBalance && info.beginning !== null) {
    let run = info.beginning;
    for (const r of rows) {
      if (r.balance === null) {
        run = Math.round((run + r.amount) * 100) / 100;
        continue;
      }
      const diff = Math.round((r.balance - run) * 100) / 100;
      if (Math.abs(diff) === Math.abs(r.amount) && diff !== r.amount) r.amount = diff; // sign printed without "-"
      if (Math.abs(run + r.amount - r.balance) > 0.005) mismatches++;
      run = r.balance;
    }
  } else if (hasBalance) {
    // no opening balance printed: use the previous row's balance; for the first row, guess from the words
    let prev: number | null = null;
    for (const r of rows) {
      if (prev !== null && r.balance !== null) {
        const diff = Math.round((r.balance - prev) * 100) / 100;
        if (Math.abs(diff) === Math.abs(r.amount) && diff !== r.amount) r.amount = diff;
        else if (Math.abs(prev + r.amount - r.balance) > 0.005) mismatches++;
      } else if (prev === null && r.amount > 0 && /ถอน|โอนไป|โอนเงินไป|ชำระ|จ่าย|ค่าธรรมเนียม|WITHDRAW|PAYMENT|DEBIT/i.test(r.desc)) {
        r.amount = -r.amount;
      }
      if (r.balance !== null) prev = r.balance;
    }
  }
  const net = rows.reduce((s, r) => s + r.amount, 0);
  const reconcileDiff =
    info.beginning !== null && info.ending !== null ? Math.round((info.beginning + net - info.ending) * 100) / 100 : null;

  const suggestedAccount = [info.bank, info.product?.replace(/^Chase /, ''), info.last4 ? `…${info.last4}` : null]
    .filter(Boolean)
    .join(' ');

  return {
    parsed: {
      headers: ['Date', 'Description', 'Amount', 'Balance'],
      rows: rows.map((r) => [r.date, r.desc, r.amount.toFixed(2), r.balance === null ? '' : r.balance.toFixed(2)]),
    },
    info,
    hasBalance,
    balanceMismatches: mismatches,
    reconcileDiff,
    suggestedAccount: suggestedAccount || '',
  };
}
