import type { Transaction } from './types';
import type { AddressBook } from './addressBook';
import { bookKey } from './addressBook';
import { isCryptoAddress } from './csv';

/**
 * Behaviour hints for parties in "from → to" / crypto data. They describe ONLY what is visible in
 * the files you imported — a hint, never proof.
 */

export type RoleId = 'exchangeLike' | 'passThrough' | 'oneTime' | 'mixer' | 'splitOut' | 'splitIn' | 'splitCash' | 'roundTrip';

export interface Role {
  id: RoleId;
  /** values for the explanation text */
  vars: Record<string, string | number>;
}

const ts = (t: Transaction) => Date.parse(t.time ?? `${t.date}T00:00:00Z`);

export const ROLE_ICON: Record<RoleId, string> = { exchangeLike: '🏦', passThrough: '⚡', oneTime: '🆕', mixer: '🌀', splitOut: '🧩', splitIn: '🧩', splitCash: '💵', roundTrip: '🔁' };

export interface RoleOptions {
  /** money sent on within this many hours counts as "passed through quickly" */
  passHours?: number;
  /** share of what came in that must go out again */
  passShare?: number;
  /** distinct counterparties to look like an exchange/service */
  hubParties?: number;
  /** your imported bank accounts: never labelled "looks like an exchange" (they are known) */
  accounts?: Set<string>;
}

export function computeRoles(links: Transaction[], book: AddressBook = {}, opt: RoleOptions = {}): Map<string, Role[]> {
  const passHours = opt.passHours ?? 24;
  const passShare = opt.passShare ?? 0.8;
  const hubParties = opt.hubParties ?? 8;
  const ins = new Map<string, Transaction[]>();
  const outs = new Map<string, Transaction[]>();
  for (const l of links) {
    if (!l.link) continue;
    (outs.get(l.link.from) ?? outs.set(l.link.from, []).get(l.link.from)!).push(l);
    (ins.get(l.link.to) ?? ins.set(l.link.to, []).get(l.link.to)!).push(l);
  }
  const parties = new Set([...ins.keys(), ...outs.keys()]);
  const wallets = new Set(links.filter((l) => l.account && l.unit).map((l) => l.account)); // exported wallets
  const roles = new Map<string, Role[]>();
  const add = (p: string, r: Role) => (roles.get(p) ?? roles.set(p, []).get(p)!).push(r);

  for (const p of parties) {
    const i = ins.get(p) ?? [];
    const o = outs.get(p) ?? [];

    if (book[bookKey(p)]?.kind === 'mixer') add(p, { id: 'mixer', vars: {} });

    const partners = new Set([...i.map((t) => t.link!.from), ...o.map((t) => t.link!.to)]);
    if (!opt.accounts?.has(p) && partners.size >= hubParties && i.length + o.length >= hubParties * 1.5) add(p, { id: 'exchangeLike', vars: { n: partners.size } });

    // received X, then sent on most of it (same coin) soon after
    let best: { gapH: number; inAmt: number; outAmt: number; unit: string } | null = null;
    for (const a of i) {
      const ta = ts(a);
      const after = o.filter((b) => (b.unit ?? '') === (a.unit ?? '') && ts(b) >= ta && ts(b) - ta <= passHours * 3_600_000);
      const sent = after.reduce((s, b) => s + Math.abs(b.amount), 0);
      if (after.length && sent >= Math.abs(a.amount) * passShare) {
        const gapH = (Math.min(...after.map(ts)) - ta) / 3_600_000;
        if (!best || gapH < best.gapH) best = { gapH, inAmt: Math.abs(a.amount), outAmt: sent, unit: a.unit ?? '$' };
      }
    }
    // your imported accounts pay out the same day all the time (that is their job): no hint there
    if (best && !opt.accounts?.has(p)) add(p, { id: 'passThrough', vars: { gap: fmtGap(best.gapH), in: best.inAmt, out: best.outAmt, unit: best.unit } });

    // seen only once in and at most once out (within the imported data), and not a wallet we exported
    // throw-away addresses are a crypto pattern; one-off donors / shops are normal in bank data
    if (isCryptoAddress(p) && !wallets.has(p) && i.length === 1 && o.length <= 1 && (o.length === 0 || ts(o[0]) - ts(i[0]) <= 7 * 86_400_000) && i.length + o.length >= 2) {
      add(p, { id: 'oneTime', vars: {} });
    }
  }
  return roles;
}

/** 0.18 h → "11 นาที"-style text is done by the UI; here: compact "11m", "5h", "2d". */
export function fmtGap(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}
