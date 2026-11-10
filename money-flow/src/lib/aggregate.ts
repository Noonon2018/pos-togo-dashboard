import type { Aliases, Filters, Transaction } from './types';
import { resolveAlias } from './normalize';

export const OTHER_NODE = 'cp:__other__';

export interface GraphNode {
  id: string;
  label: string;
  kind: 'account' | 'counterparty' | 'other';
  totalIn: number; // money flowing INTO this node
  totalOut: number; // money flowing OUT of this node
  count: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  count: number;
  total: number;
  txIds: string[];
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Inflows on the receiving account that were matched to an outflow on the sending account. */
  mirroredTransferIds: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const dayNum = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

export const accountNodeId = (name: string) => `acct:${name}`;
export const cpNodeId = (name: string) => `cp:${name}`;

/** Final display name of a transaction's counterparty after user aliases. */
export function counterpartyName(t: Transaction, aliases: Aliases): string {
  return resolveAlias(t.counterparty, aliases);
}

/** If the counterparty resolves to one of my own accounts, return that account's name. */
export function ownAccountOf(t: Transaction, aliases: Aliases, accounts: Set<string>): string | null {
  const name = counterpartyName(t, aliases);
  for (const a of accounts) if (a.toUpperCase() === name.toUpperCase() && a !== t.account) return a;
  return null;
}

export function filterTransactions(txns: Transaction[], f: Filters): Transaction[] {
  return txns.filter(
    (t) =>
      (!f.from || t.date >= f.from) &&
      (!f.to || t.date <= f.to) &&
      Math.abs(t.amount) >= (f.minAmount || 0) &&
      (f.direction === 'all' || (f.direction === 'in' ? t.amount > 0 : t.amount < 0)) &&
      (f.accounts.length === 0 || f.accounts.includes(t.account)),
  );
}

/**
 * Transfers between two of my accounts show up twice (out of A, into B). Return the ids of the
 * inflow side for every pair matched on amount and date (±5 days), so it can be counted once.
 */
export function findMirroredTransfers(txns: Transaction[], aliases: Aliases, accounts: Set<string>): Set<string> {
  const outs = new Map<string, Transaction[]>();
  for (const t of txns) {
    if (t.amount >= 0) continue;
    const to = ownAccountOf(t, aliases, accounts);
    if (!to) continue;
    const k = `${t.account}>${to}|${-t.amount}`;
    (outs.get(k) ?? outs.set(k, []).get(k)!).push(t);
  }
  const used = new Set<string>();
  const mirrored = new Set<string>();
  for (const t of txns) {
    if (t.amount <= 0) continue;
    const from = ownAccountOf(t, aliases, accounts);
    if (!from) continue;
    const cands = outs.get(`${from}>${t.account}|${t.amount}`) ?? [];
    const match = cands
      .filter((o) => !used.has(o.id) && Math.abs(dayNum(o.date) - dayNum(t.date)) <= 5)
      .sort((a, b) => Math.abs(dayNum(a.date) - dayNum(t.date)) - Math.abs(dayNum(b.date) - dayNum(t.date)))[0];
    if (match) {
      used.add(match.id);
      mirrored.add(t.id);
    }
  }
  return mirrored;
}

/** Build the aggregated, directed flow graph. Edge totals are always positive dollars. */
export function buildGraph(all: Transaction[], aliases: Aliases, filters: Filters): Graph {
  const accounts = new Set(all.map((t) => t.account));
  const txns = filterTransactions(all, filters);
  const mirrored = findMirroredTransfers(txns, aliases, accounts);

  // rank external counterparties by volume to apply topN
  const volume = new Map<string, number>();
  for (const t of txns) {
    if (mirrored.has(t.id) || ownAccountOf(t, aliases, accounts)) continue;
    const n = counterpartyName(t, aliases);
    volume.set(n, (volume.get(n) ?? 0) + Math.abs(t.amount));
  }
  const ranked = [...volume.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  const keep = filters.topN > 0 ? new Set(ranked.slice(0, filters.topN)) : new Set(ranked);
  const otherCount = ranked.length - keep.size;

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const node = (id: string, label: string, kind: GraphNode['kind']) =>
    nodes.get(id) ?? nodes.set(id, { id, label, kind, totalIn: 0, totalOut: 0, count: 0 }).get(id)!;

  for (const t of txns) {
    if (mirrored.has(t.id)) continue;
    const acct = node(accountNodeId(t.account), t.account, 'account');
    const own = ownAccountOf(t, aliases, accounts);
    let other: GraphNode;
    if (own) other = node(accountNodeId(own), own, 'account');
    else {
      const name = counterpartyName(t, aliases);
      other = keep.has(name)
        ? node(cpNodeId(name), name, 'counterparty')
        : node(OTHER_NODE, `OTHER (${otherCount} counterparties)`, 'other');
    }
    const amt = Math.abs(t.amount);
    const [src, dst] = t.amount < 0 ? [acct, other] : [other, acct];
    src.totalOut += amt;
    dst.totalIn += amt;
    src.count++;
    dst.count++;
    const eid = `${src.id}->${dst.id}`;
    const e = edges.get(eid) ?? edges.set(eid, { id: eid, source: src.id, target: dst.id, count: 0, total: 0, txIds: [] }).get(eid)!;
    e.count++;
    e.total += amt;
    e.txIds.push(t.id);
  }
  for (const n of nodes.values()) {
    n.totalIn = round2(n.totalIn);
    n.totalOut = round2(n.totalOut);
  }
  for (const e of edges.values()) e.total = round2(e.total);
  return { nodes: [...nodes.values()], edges: [...edges.values()], mirroredTransferIds: [...mirrored] };
}

export interface AccountTotal {
  account: string;
  inflow: number;
  outflow: number;
  net: number;
  count: number;
  first: string;
  last: string;
}

/** Raw per-account totals — these should match the statement file exactly (use for reconciliation). */
export function accountTotals(txns: Transaction[]): AccountTotal[] {
  const m = new Map<string, AccountTotal>();
  for (const t of txns) {
    const a =
      m.get(t.account) ??
      m.set(t.account, { account: t.account, inflow: 0, outflow: 0, net: 0, count: 0, first: t.date, last: t.date }).get(t.account)!;
    if (t.amount > 0) a.inflow += t.amount;
    else a.outflow += -t.amount;
    a.count++;
    if (t.date < a.first) a.first = t.date;
    if (t.date > a.last) a.last = t.date;
  }
  return [...m.values()].map((a) => ({
    ...a,
    inflow: round2(a.inflow),
    outflow: round2(a.outflow),
    net: round2(a.inflow - a.outflow),
  }));
}

export interface CounterpartyTotal {
  name: string;
  inflow: number;
  outflow: number;
  net: number;
  countIn: number;
  countOut: number;
  accounts: string[];
  first: string;
  last: string;
}

/** Totals per external counterparty (transfers between my own accounts excluded). */
export function counterpartyTotals(txns: Transaction[], aliases: Aliases): CounterpartyTotal[] {
  const accounts = new Set(txns.map((t) => t.account));
  const m = new Map<string, CounterpartyTotal & { _acc: Set<string> }>();
  for (const t of txns) {
    if (ownAccountOf(t, aliases, accounts)) continue;
    const name = counterpartyName(t, aliases);
    const c =
      m.get(name) ??
      m
        .set(name, { name, inflow: 0, outflow: 0, net: 0, countIn: 0, countOut: 0, accounts: [], first: t.date, last: t.date, _acc: new Set() })
        .get(name)!;
    if (t.amount > 0) {
      c.inflow += t.amount;
      c.countIn++;
    } else {
      c.outflow += -t.amount;
      c.countOut++;
    }
    c._acc.add(t.account);
    if (t.date < c.first) c.first = t.date;
    if (t.date > c.last) c.last = t.date;
  }
  return [...m.values()].map(({ _acc, ...c }) => ({
    ...c,
    inflow: round2(c.inflow),
    outflow: round2(c.outflow),
    net: round2(c.inflow - c.outflow),
    accounts: [..._acc].sort(),
  }));
}

export function topCounterparties(txns: Transaction[], aliases: Aliases, dir: 'in' | 'out', limit = 10) {
  const key = dir === 'in' ? 'inflow' : 'outflow';
  return counterpartyTotals(txns, aliases)
    .filter((c) => c[key] > 0)
    .sort((a, b) => b[key] - a[key])
    .slice(0, limit);
}

export interface MonthTotal {
  month: string; // YYYY-MM
  inflow: number;
  outflow: number;
  net: number;
  /** Money moved between my own accounts (counted once, excluded from in/out). */
  transfers: number;
  count: number;
}

export function monthlyTotals(txns: Transaction[], aliases: Aliases): MonthTotal[] {
  const accounts = new Set(txns.map((t) => t.account));
  const mirrored = findMirroredTransfers(txns, aliases, accounts);
  const m = new Map<string, MonthTotal>();
  for (const t of txns) {
    const month = t.date.slice(0, 7);
    const r = m.get(month) ?? m.set(month, { month, inflow: 0, outflow: 0, net: 0, transfers: 0, count: 0 }).get(month)!;
    r.count++;
    if (mirrored.has(t.id)) continue;
    if (ownAccountOf(t, aliases, accounts)) r.transfers += Math.abs(t.amount);
    else if (t.amount > 0) r.inflow += t.amount;
    else r.outflow += -t.amount;
  }
  return [...m.values()]
    .map((r) => ({ ...r, inflow: round2(r.inflow), outflow: round2(r.outflow), transfers: round2(r.transfers), net: round2(r.inflow - r.outflow) }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

const FREQS: { name: Frequency; days: number; tol: number; perYear: number }[] = [
  { name: 'weekly', days: 7, tol: 1, perYear: 52 },
  { name: 'biweekly', days: 14, tol: 2, perYear: 26 },
  { name: 'monthly', days: 30.4, tol: 4, perYear: 12 },
  { name: 'quarterly', days: 91, tol: 7, perYear: 4 },
  { name: 'yearly', days: 365, tol: 10, perYear: 1 },
];

export interface RecurringCharge {
  counterparty: string;
  /** out = bills/subscriptions/suppliers, in = paychecks/regular deposits */
  direction: 'in' | 'out';
  account: string;
  frequency: Frequency;
  count: number;
  typicalAmount: number;
  lastAmount: number;
  lastDate: string;
  nextExpected: string;
  annualCost: number;
  /** Last charge is >5% above the typical amount (price increase?). */
  priceIncrease: boolean;
}

/** Next expected date: calendar-aware for monthly/quarterly/yearly (Jan 31 + 1 month = Feb 28). */
export function nextDate(iso: string, f: Frequency): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = f === 'monthly' ? 1 : f === 'quarterly' ? 3 : f === 'yearly' ? 12 : 0;
  if (!months) return new Date((dayNum(iso) + (f === 'weekly' ? 7 : 14)) * 86_400_000).toISOString().slice(0, 10);
  const total = m - 1 + months;
  const ny = y + Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * Detect recurring flows: same counterparty + account + direction, at least 3 (2 for yearly),
 * regular spacing, and similar amounts (±20% of median for ≥75% of charges).
 */
export function detectRecurring(txns: Transaction[], aliases: Aliases): RecurringCharge[] {
  const accounts = new Set(txns.map((t) => t.account));
  const groups = new Map<string, Transaction[]>();
  for (const t of txns) {
    if (ownAccountOf(t, aliases, accounts)) continue;
    const k = `${counterpartyName(t, aliases)}\u0000${t.account}\u0000${t.amount < 0 ? 'out' : 'in'}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(t);
  }
  const out: RecurringCharge[] = [];
  for (const [k, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    const amounts = list.map((t) => Math.abs(t.amount));
    const medAmt = median(amounts);
    const similar = amounts.filter((a) => Math.abs(a - medAmt) <= medAmt * 0.2).length;
    if (similar / amounts.length < 0.75) continue;
    const gaps = list.slice(1).map((t, i) => dayNum(t.date) - dayNum(list[i].date));
    const medGap = median(gaps);
    const freq = FREQS.find((f) => Math.abs(medGap - f.days) <= f.tol);
    if (!freq) continue;
    if (list.length < (freq.name === 'yearly' ? 2 : 3)) continue;
    const regular = gaps.filter((g) => Math.abs(g - freq.days) <= freq.tol + 1).length;
    if (regular / gaps.length < 0.75) continue;
    const last = list[list.length - 1];
    const next = nextDate(last.date, freq.name);
    const [counterparty, account, direction] = k.split('\u0000');
    out.push({
      counterparty,
      direction: direction as 'in' | 'out',
      account,
      frequency: freq.name,
      count: list.length,
      typicalAmount: round2(medAmt),
      lastAmount: Math.abs(last.amount),
      lastDate: last.date,
      nextExpected: next,
      annualCost: round2(medAmt * freq.perYear),
      priceIncrease: direction === 'out' && Math.abs(last.amount) > medAmt * 1.05,
    });
  }
  return out.sort((a, b) => b.annualCost - a.annualCost);
}

export interface DuplicateGroup {
  kind: 'exact' | 'near';
  account: string;
  counterparty: string;
  amount: number;
  transactions: Transaction[];
}

/**
 * Possible double charges: same account, counterparty and amount, either on the same day
 * ("exact") or within 2 days ("near"). These are leads to check, not proof.
 */
export function findDuplicates(txns: Transaction[], aliases: Aliases): DuplicateGroup[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of txns) {
    const k = `${t.account}\u0000${counterpartyName(t, aliases)}\u0000${t.amount}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(t);
  }
  const out: DuplicateGroup[] = [];
  for (const [k, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    let cluster: Transaction[] = [list[0]];
    const flush = () => {
      if (cluster.length > 1) {
        const [account, counterparty] = k.split('\u0000');
        out.push({
          kind: cluster.every((t) => t.date === cluster[0].date) ? 'exact' : 'near',
          account,
          counterparty,
          amount: cluster[0].amount,
          transactions: cluster,
        });
      }
    };
    for (let i = 1; i < list.length; i++) {
      if (dayNum(list[i].date) - dayNum(cluster[cluster.length - 1].date) <= 2) cluster.push(list[i]);
      else {
        flush();
        cluster = [list[i]];
      }
    }
    flush();
  }
  return out.sort((a, b) => (a.kind === b.kind ? Math.abs(b.amount) - Math.abs(a.amount) : a.kind === 'exact' ? -1 : 1));
}
