import type { StatementResult } from './pdfStatement';

/**
 * One result per dropped file: what it is, whether the app can use it, where it went, and — when it
 * cannot be used — why, and what to get instead. Shown as the "file check" card.
 */

export type CheckKind =
  // usable
  | 'statement' // rows of transactions (CSV / Excel / Word table) → import window
  | 'statementPdf' // bank statement PDF
  | 'scan' // picture / scanned PDF read by OCR
  | 'doordash' // DoorDash merchant statement
  | 'simulation' // simulation-input → cash forecast
  | 'addressBook' // names → address book
  // not usable
  | 'summary' // a report of totals / statuses / notes
  | 'form' // a blank or filled form, no money movements
  | 'notStatement' // some other document
  | 'scanUnreadable' // OCR found no rows
  | 'oldOffice'
  | 'unsupported'
  | 'error';

export interface FileCheck {
  file: string;
  kind: CheckKind;
  ok: boolean;
  /** rows, sheets, payouts … */
  rows?: number;
  sheets?: string[];
  skipped?: string[];
  /** statement check: true = every balance matches, false = some do not, null = nothing to check against */
  reconciles?: boolean | null;
  payouts?: number;
  names?: number;
  error?: string;
}

export const OK_KINDS: CheckKind[] = ['statement', 'statementPdf', 'scan', 'doordash', 'simulation', 'addressBook'];

/** Why a file has no transactions: a report, a form, or something else. */
export function whyNotTransactions(text: string): 'summary' | 'form' | 'notStatement' {
  const t = text.toLowerCase();
  // fill-in blanks ("________") or an e-signature envelope: a form
  if ((t.match(/_{5,}/g) ?? []).length >= 5 || /docusign|hellosign|adobe sign/.test(t)) return 'form';
  // reports first: a report may mention a form ("Form 941") without being one
  if (/summary|total|subtotal|report|status|forecast|simulation|สรุป|รวม|ยอดคงเหลือ|หมายเหตุ|สถานะ|รายงาน|ยอดขาย|หนี้|บิล/.test(t)) return 'summary';
  if (/\b(form|template|signature|routing number|authori[sz]ation)\b|แบบฟอร์ม|ลงชื่อ|ลายมือชื่อ/.test(t)) return 'form';
  return 'notStatement';
}

/** Reconciliation result of a statement read from a PDF / picture. */
export function reconciles(pdf: StatementResult): boolean | null {
  if (pdf.reconcileDiff === null && !pdf.hasBalance) return null;
  return (pdf.reconcileDiff ?? 0) === 0 && pdf.balanceMismatches === 0;
}

/** Rows that hold a date and an amount (for the "N rows" note). */
export const countRows = (rows: string[][], isTx: (r: string[]) => boolean) => rows.filter(isTx).length;
