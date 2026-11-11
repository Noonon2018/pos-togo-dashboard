import type { Transaction } from './types';
import type { AddressBook } from './addressBook';
import { bookKey } from './addressBook';
import { fmtGap } from './roles';

/**
 * "Follow the money": starting at one party, walk forward in time — after money arrives somewhere,
 * only transfers that leave LATER (and before the next money arrives) can be the continuation. Stops at mixers (the trail is broken on
 * purpose), at exchanges (only the exchange / police can see further), or where no data was imported.
 */

export type StopReason = 'mixer' | 'exchange' | 'cash' | 'noData' | 'maxDepth' | 'seen';

/** Cash withdrawals: the digital trail ends; only witnesses / CCTV / deposit slips can continue it. */
export const isCash = (p: string) => /^(ATM CASH|CASH|CASH WITHDRAWAL|เงินสด.*|ถอนเงินสด.*)$/i.test(p.trim());

export interface Hop {
  depth: number;
  tx: Transaction;
  from: string;
  to: string;
  amount: number;
  unit?: string;
  /** time since the money arrived at `from` ('' for the first hop) */
  gap: string;
  gapHours: number | null;
  /** set when the trail cannot continue from `to` */
  stop?: StopReason;
}

const ts = (t: Transaction) => Date.parse(t.time ?? `${t.date}T00:00:00Z`);

export interface TraceOptions {
  maxDepth?: number;
  /** follow at most this many of the largest outgoing transfers per party */
  branch?: number;
  /** ignore transfers smaller than this share of the incoming amount (dust, fees) */
  minShare?: number;
  /** look at most this many days after money arrived (when no newer money arrives first) */
  windowDays?: number;
}

export function traceFrom(start: string, links: Transaction[], book: AddressBook = {}, opt: TraceOptions = {}): Hop[] {
  const maxDepth = opt.maxDepth ?? 6;
  const branch = opt.branch ?? 3;
  const minShare = opt.minShare ?? 0.05;
  const windowMs = (opt.windowDays ?? 30) * 86_400_000;
  const outs = new Map<string, Transaction[]>();
  const ins = new Map<string, number[]>(); // party|unit -> arrival times
  for (const l of links) {
    if (!l.link) continue;
    (outs.get(l.link.from) ?? outs.set(l.link.from, []).get(l.link.from)!).push(l);
    const k = `${l.link.to}|${l.unit ?? ''}`;
    (ins.get(k) ?? ins.set(k, []).get(k)!).push(ts(l));
  }
  for (const v of ins.values()) v.sort((a, b) => a - b);
  const hasOwnData = new Set(links.filter((l) => l.link).flatMap((l) => (l.account ? [l.account] : [])));
  // a party "has data" when we imported its own file, or when we can see it sending money on
  const known = (p: string) => hasOwnData.has(p) || outs.has(p);
  const kind = (p: string) => book[bookKey(p)]?.kind;

  const hops: Hop[] = [];
  /** parties on the current path (to stop loops); a party may be visited again for a later arrival */
  const path = new Set<string>([start]);

  /**
   * @param unit the coin the money arrived in: it can only continue in the same coin
   *             (a swap to another coin breaks the trail here — a known limitation)
   */
  const walk = (party: string, arrivedAt: number | null, inAmount: number | null, unit: string | null, depth: number) => {
    // money that arrived is assumed to be spent before the NEXT money (same coin) arrives — the
    // first-in-first-out rule investigators use — and within the window
    const next = arrivedAt === null ? null : (ins.get(`${party}|${unit ?? ''}`) ?? []).find((x) => x > arrivedAt) ?? null;
    const until = arrivedAt === null ? Infinity : Math.min(next ?? Infinity, arrivedAt + windowMs);
    const eligible = (outs.get(party) ?? [])
      .filter((t) => arrivedAt === null || (ts(t) >= arrivedAt && ts(t) < until))
      .filter((t) => unit === null || (t.unit ?? '') === unit)
      .filter((t) => inAmount === null || Math.abs(t.amount) >= inAmount * minShare);
    // the largest few per coin (amounts in different coins can't be compared)
    const byUnit = new Map<string, Transaction[]>();
    for (const t of eligible) (byUnit.get(t.unit ?? '') ?? byUnit.set(t.unit ?? '', []).get(t.unit ?? '')!).push(t);
    const candidates = [...byUnit.values()]
      .flatMap((list) => list.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, branch))
      .sort((a, b) => ts(a) - ts(b));
    for (const t of candidates) {
      const to = t.link!.to;
      const gapHours = arrivedAt === null ? null : (ts(t) - arrivedAt) / 3_600_000;
      const hop: Hop = {
        depth,
        tx: t,
        from: party,
        to,
        amount: Math.abs(t.amount),
        ...(t.unit ? { unit: t.unit } : {}),
        gap: gapHours === null ? '' : fmtGap(gapHours),
        gapHours,
      };
      hops.push(hop);
      if (kind(to) === 'mixer') hop.stop = 'mixer';
      else if (isCash(to)) hop.stop = 'cash';
      else if (kind(to) === 'exchange') hop.stop = 'exchange';
      else if (path.has(to)) hop.stop = 'seen';
      else if (depth >= maxDepth) hop.stop = 'maxDepth';
      else if (!known(to)) hop.stop = 'noData';
      else {
        path.add(to);
        const before = hops.length;
        walk(to, ts(t), Math.abs(t.amount), t.unit ?? '', depth + 1);
        path.delete(to);
        if (hops.length === before) hop.stop = 'noData'; // has a file, but nothing left afterwards
      }
    }
  };
  walk(start, null, null, null, 1);
  return hops;
}

/** Addresses where the trail stopped for lack of data — what to export next. */
export function nextToExport(hops: Hop[]): string[] {
  return [...new Set(hops.filter((h) => h.stop === 'noData').map((h) => h.to))];
}
