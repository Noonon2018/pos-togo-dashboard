import type { Aliases, Transaction } from './types';
import { counterpartyTotals, counterpartyName } from './aggregate';

/**
 * Escape one CSV cell. Cells starting with = + - @ (or tab/CR) are prefixed with ' so Excel
 * does not execute them as formulas (CSV injection via crafted bank descriptions).
 */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function summaryCsv(txns: Transaction[], aliases: Aliases): string {
  const rows: (string | number)[][] = [
    ['counterparty', 'accounts', 'count_in', 'total_in', 'count_out', 'total_out', 'net', 'first_date', 'last_date'],
  ];
  for (const c of counterpartyTotals(txns, aliases).sort((a, b) => b.inflow + b.outflow - (a.inflow + a.outflow))) {
    rows.push([c.name, c.accounts.join('; '), c.countIn, c.inflow.toFixed(2), c.countOut, c.outflow.toFixed(2), c.net.toFixed(2), c.first, c.last]);
  }
  return toCsv(rows);
}

export function transactionsCsv(txns: Transaction[], aliases: Aliases): string {
  const rows: (string | number)[][] = [['date', 'account', 'counterparty', 'amount', 'description', 'source_file']];
  for (const t of [...txns].sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push([t.date, t.account, counterpartyName(t, aliases), t.amount.toFixed(2), t.description, t.source]);
  }
  return toCsv(rows);
}

export function download(filename: string, data: string | Blob, type = 'text/csv;charset=utf-8') {
  const blob = typeof data === 'string' ? new Blob(['﻿', data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
