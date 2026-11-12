import type { Transaction } from './types';
import type { Role } from './roles';
import { isCash } from './trace';

/**
 * Two money-laundering patterns investigators look for first. Like the other roles, these are
 * hints from the imported files only, never proof: always check the reason for each transfer.
 *
 *  🧩 Splitting ("structuring"): one large sum moved between the SAME two parties as many smaller
 *     transfers in a few days — e.g. 14 × ฿50,000–200,000 instead of one ฿2,000,000 transfer, or
 *     6 × ฿2,000,000 cash withdrawals in a week. Many DIFFERENT senders to one receiver is not
 *     flagged (that is what donations look like). Pieces must be mostly round numbers: people who
 *     split pick round amounts, while card-sale payouts (Square, Stripe) and payroll never are.
 *
 *  🔁 Round trip: money leaves a party and comes back to the same party through at least two
 *     others within N days (A → B → C → A), at least half of it. A → B → A alone is usually a
 *     refund or a loan repaid.
 */

const ts = (t: Transaction) => Date.parse(t.time ?? `${t.date}T00:00:00Z`);
const DAY = 86_400_000;

export interface StructuringOptions {
  /** look at transfers inside this many days */
  windowDays?: number;
  /** at least this many transfers */
  minCount?: number;
  /** together at least this much (same unit as the data); crypto coins are skipped */
  minTotal?: number;
}

export interface Split {
  from: string;
  to: string;
  n: number;
  days: number;
  total: number;
  max: number;
  min: number;
  firstDate: string;
  lastDate: string;
  txIds: string[];
}

export function findStructuring(links: Transaction[], opt: StructuringOptions = {}): Split[] {
  const windowMs = (opt.windowDays ?? 7) * DAY;
  const minCount = opt.minCount ?? 4;
  const minTotal = opt.minTotal ?? 10_000;
  const pairs = new Map<string, Transaction[]>();
  for (const l of links) {
    if (!l.link || l.unit || l.link.from === l.link.to) continue; // money only, not coins
    const k = `${l.link.from}\u0000${l.link.to}`;
    (pairs.get(k) ?? pairs.set(k, []).get(k)!).push(l);
  }
  const out: Split[] = [];
  for (const list of pairs.values()) {
    if (list.length < minCount) continue;
    list.sort((a, b) => ts(a) - ts(b));
    // the window (two pointers) with the largest total
    let best: { i: number; j: number; total: number } | null = null;
    let i = 0;
    let sum = 0;
    for (let j = 0; j < list.length; j++) {
      sum += Math.abs(list[j].amount);
      while (ts(list[j]) - ts(list[i]) > windowMs) sum -= Math.abs(list[i++].amount);
      if (j - i + 1 >= minCount && (!best || sum > best.total)) best = { i, j, total: sum };
    }
    if (!best || best.total < minTotal) continue;
    const w = list.slice(best.i, best.j + 1);
    const amts = w.map((t) => Math.abs(t.amount));
    const max = Math.max(...amts);
    if (max > best.total / 3) continue; // one big transfer plus small change is not "splitting"
    if (amts.filter((a) => a % 100 === 0).length < amts.length * 0.75) continue; // daily payouts like $1,331.64
    out.push({
      from: w[0].link!.from,
      to: w[0].link!.to,
      n: w.length,
      days: Math.max(1, Math.round((ts(w[w.length - 1]) - ts(w[0])) / DAY) + 1),
      total: Math.round(best.total * 100) / 100,
      max,
      min: Math.min(...amts),
      firstDate: w[0].date,
      lastDate: w[w.length - 1].date,
      txIds: w.map((t) => t.id),
    });
  }
  return out.sort((a, b) => b.total - a.total);
}

export interface RoundTripOptions {
  windowDays?: number;
  /** longest loop (number of transfers) */
  maxHops?: number;
  /** ignore onward transfers smaller than this share of what arrived */
  minShare?: number;
  /** follow at most this many of the largest onward transfers per step */
  branch?: number;
  /** at least this share of what left must come back */
  minBack?: number;
}

export interface RoundTrip {
  party: string;
  path: string[]; // the parties in between
  out: number;
  back: number;
  unit?: string;
  days: number;
  txIds: string[];
}

export function findRoundTrips(links: Transaction[], opt: RoundTripOptions = {}): RoundTrip[] {
  const windowMs = (opt.windowDays ?? 30) * DAY;
  const maxHops = opt.maxHops ?? 4;
  const minShare = opt.minShare ?? 0.1;
  const branch = opt.branch ?? 5;
  const minBack = opt.minBack ?? 0.5;
  const outs = new Map<string, Transaction[]>();
  const hasIn = new Set<string>();
  for (const l of links) {
    if (!l.link || l.link.from === l.link.to) continue;
    (outs.get(l.link.from) ?? outs.set(l.link.from, []).get(l.link.from)!).push(l);
    hasIn.add(l.link.to);
  }
  const best = new Map<string, RoundTrip>();
  for (const [start, starts] of outs) {
    if (!hasIn.has(start) || isCash(start)) continue;
    const walk = (p: string, at: number, amt: number, unit: string, chain: Transaction[]) => {
      if (p === start) {
        if (chain.length < 3) return;
        const back = Math.abs(chain[chain.length - 1].amount);
        if (back < Math.abs(chain[0].amount) * minBack) return;
        const cur = best.get(start);
        if (!cur || back > cur.back) {
          best.set(start, {
            party: start,
            path: chain.slice(0, -1).map((t) => t.link!.to),
            out: Math.abs(chain[0].amount),
            back,
            ...(unit ? { unit } : {}),
            days: Math.max(1, Math.round((ts(chain[chain.length - 1]) - ts(chain[0])) / DAY) + 1),
            txIds: chain.map((t) => t.id),
          });
        }
        return;
      }
      if (chain.length >= maxHops || isCash(p) || chain.some((t) => t.link!.from === p)) return;
      const next = (outs.get(p) ?? [])
        .filter((t) => ts(t) >= at && ts(t) - ts(chain[0]) <= windowMs && (t.unit ?? '') === unit && Math.abs(t.amount) >= amt * minShare)
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
        .slice(0, branch);
      for (const t of next) walk(t.link!.to, ts(t), Math.abs(t.amount), unit, [...chain, t]);
    };
    for (const t of starts) walk(t.link!.to, ts(t), Math.abs(t.amount), t.unit ?? '', [t]);
  }
  return [...best.values()].sort((a, b) => b.back - a.back);
}

/** The patterns as roles, so they show up on the graph dots and in the side panel. */
export function patternRoles(
  links: Transaction[],
  opt: { minTotal?: number; name?: (p: string) => string } = {},
): Map<string, Role[]> {
  const name = opt.name ?? ((p: string) => p);
  const roles = new Map<string, Role[]>();
  const add = (p: string, r: Role) => (roles.get(p) ?? roles.set(p, []).get(p)!).push(r);
  for (const s of findStructuring(links, { minTotal: opt.minTotal })) {
    const vars = { n: s.n, days: s.days, total: s.total, max: s.max, min: s.min, unit: '$' };
    if (isCash(s.to)) {
      add(s.from, { id: 'splitCash', vars }); // "cash" is not a party: flag only who withdrew
      continue;
    }
    add(s.from, { id: 'splitOut', vars: { ...vars, other: name(s.to) } });
    add(s.to, { id: 'splitIn', vars: { ...vars, other: name(s.from) } });
  }
  for (const r of findRoundTrips(links)) {
    add(r.party, { id: 'roundTrip', vars: { path: r.path.map(name).join(' → '), days: r.days, out: r.out, back: r.back, unit: r.unit ?? '$' } });
  }
  return roles;
}

/** Combine role maps (no duplicate role ids per party). */
export function mergeRoles(...maps: Map<string, Role[]>[]): Map<string, Role[]> {
  const out = new Map<string, Role[]>();
  for (const m of maps)
    for (const [p, rs] of m) {
      const cur = out.get(p) ?? out.set(p, []).get(p)!;
      for (const r of rs) if (!cur.some((c) => c.id === r.id)) cur.push(r);
    }
  return out;
}
