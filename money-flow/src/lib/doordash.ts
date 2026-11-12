import type { StatementResult } from './pdfStatement';

/**
 * DoorDash Merchant Statement (PDF from the DoorDash Merchant Portal → Financials → Statements).
 *
 * Not a bank statement: each weekly PAYOUT shows what the orders earned and what DoorDash kept.
 * We turn every payout into rows of a "DoorDash" account, so the graph shows where the delivery
 * money goes (commission, marketing, discounts, error charges) and what reached the bank:
 *
 *   + sales, + sales tax collected, − commission, − marketing, − discounts you funded, …,
 *   − payout to the bank   →  every payout nets to 0 (that is the reconciliation check).
 *
 * The account is named "DoorDash" on purpose: the bank statement's "DOORDASH" deposits then count
 * as a transfer from this account, so the same money is not counted as income twice.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

function isoOf(s: string): string | null {
  const m = s.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return null;
  const mi = MONTHS.indexOf(m[1].toLowerCase());
  return mi < 0 ? null : `${m[3]}-${pad(mi + 1)}-${pad(Number(m[2]))}`;
}

export function isDoorDashStatement(text: string): boolean {
  return /DoorDash/i.test(text) && /Net payout/.test(text) && /Payout #\d+/.test(text);
}

/** Amount printed right after a label ("Commission -$239.49"). Labels are case-sensitive on purpose:
 *  "Merchant fees" ≠ "Tax (merchant fees)". */
function amountAfter(block: string, label: string): number {
  const esc = label.replace(/[()]/g, (c) => `\\${c}`);
  const m = block.match(new RegExp(`(?:^|[\\s|])${esc}(?: \\(\\d+\\))?\\s+(-?)\\$\\s?(-?[\\d,]+\\.\\d{2})`));
  if (!m) return 0;
  const v = Number(m[2].replace(/,/g, ''));
  return m[1] === '-' || m[2].startsWith('-') ? -Math.abs(v) : v;
}

export interface DoorDashPayout {
  id: string;
  deposit: string; // ISO date the payout was sent to the bank
  salesFrom: string | null;
  salesTo: string | null;
  bank: string | null;
  net: number;
  parts: { label: string; amount: number }[];
}

export function parseDoorDashPayouts(lines: string[]): DoorDashPayout[] {
  const text = lines.join('\n');
  const chunks = text.split(/Payout #(\d+)/);
  const out: DoorDashPayout[] = [];
  for (let i = 1; i < chunks.length; i += 2) {
    const id = chunks[i];
    const block = chunks[i + 1] ?? '';
    const deposit = isoOf(block.match(/Deposit Initiated\s+([A-Za-z]{3}[a-z]*\.? \d{1,2},? \d{4})/)?.[1] ?? '');
    const dates = block.match(/Transaction Dates\s+([A-Za-z]{3}[a-z]*\.? \d{1,2},? \d{4})\s*[-–]\s*([A-Za-z]{3}[a-z]*\.? \d{1,2},? \d{4})/);
    const netM = block.match(/Net payout\s+(-?)\$\s?([\d,]+\.\d{2})/);
    if (!deposit || !netM) continue;
    const a = (l: string) => amountAfter(block, l);
    const parts = [
      { label: 'Delivery app sales', amount: a('Subtotal') + a('Staff tips') + a('Customer fees') + a('Tax (customer fees)') },
      { label: 'Sales tax collected (to remit)', amount: a('Tax (subtotal)') },
      { label: 'App commission', amount: a('Commission') + a('Tax (commission)') },
      { label: 'App merchant fees', amount: a('Merchant fees') + a('Tax (merchant fees)') },
      { label: 'App marketing fees', amount: a('Marketing fees') },
      { label: 'Discounts you funded', amount: a('Customer discounts funded by you') },
      {
        label: 'App-funded promos (net)',
        amount: a('Customer discounts funded by DoorDash') + a('Customer discounts funded by third party') + a('Marketing credit') + a('Third-party contribution'),
      },
      { label: 'Error charges and adjustments', amount: a('Error charges') + a('Adjustments') },
    ]
      .map((p) => ({ ...p, amount: Math.round(p.amount * 100) / 100 }))
      .filter((p) => p.amount !== 0);
    out.push({
      id,
      deposit,
      salesFrom: dates ? isoOf(dates[1]) : null,
      salesTo: dates ? isoOf(dates[2]) : null,
      bank: block.match(/Bank Account\s+[X*]*(\d{3,4})\b/)?.[1] ?? null,
      net: (netM[1] === '-' ? -1 : 1) * Number(netM[2].replace(/,/g, '')),
      parts,
    });
  }
  // the same payout can be printed in two monthly statements: keep one
  return [...new Map(out.map((p) => [p.id, p])).values()].sort((x, y) => x.deposit.localeCompare(y.deposit));
}

/** Rows for the normal import step, with a running balance that returns to 0 after each payout. */
export function doorDashStatement(lines: string[]): StatementResult | null {
  const text = lines.join('\n');
  if (!isDoorDashStatement(text)) return null;
  const payouts = parseDoorDashPayouts(lines);
  if (!payouts.length) return null;
  const rows: string[][] = [];
  let mismatches = 0;
  let net = 0;
  for (const p of payouts) {
    const day = p.salesTo && p.salesTo <= p.deposit ? p.salesTo : p.deposit; // the week's sales, then the payout
    const week = p.salesFrom && p.salesTo ? ` ${p.salesFrom.slice(5)}..${p.salesTo.slice(5)}` : '';
    let bal = 0;
    for (const part of p.parts) {
      bal = Math.round((bal + part.amount) * 100) / 100;
      rows.push([day, `${part.label} #${p.id}${week}`, part.amount.toFixed(2), bal.toFixed(2)]);
    }
    if (Math.abs(bal - p.net) > 0.005) mismatches++; // the parts do not add up to the printed net payout
    rows.push([p.deposit, `Payout to bank${p.bank ? ` ...${p.bank}` : ''} #${p.id}`, (-p.net).toFixed(2), (Math.round((bal - p.net) * 100) / 100).toFixed(2)]);
    net += p.net;
  }
  const sum = rows.reduce((s, r) => s + Number(r[2]), 0);
  return {
    parsed: { headers: ['Date', 'Description', 'Amount', 'Balance'], rows },
    info: { bank: 'DoorDash', last4: null, product: null, periodStart: null, periodEnd: null, beginning: 0, ending: 0 },
    hasBalance: true,
    balanceMismatches: mismatches,
    reconcileDiff: Math.round(sum * 100) / 100,
    suggestedAccount: 'DoorDash',
    doordash: { payouts: payouts.length, net: Math.round(net * 100) / 100 },
  };
}
