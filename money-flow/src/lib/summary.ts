import { CATEGORIES, categoryOf, type CategorizedTx } from './categories';
import { detectRecurring, findDuplicates } from './aggregate';
import type { Aliases } from './types';

const round2 = (n: number) => Math.round(n * 100) / 100;
const dayNum = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
const daysInMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export const ALL = 'all';

export interface CategoryTotal {
  id: string;
  total: number;
  count: number;
  prevTotal: number;
  /** share of spending (spend + cash), 0–1 */
  share: number;
  items: { name: string; total: number; count: number }[];
}

export interface PeriodSummary {
  period: string; // YYYY-MM or 'all'
  prevPeriod: string | null;
  income: number;
  spending: number; // spend + cash
  invest: number;
  transfers: number;
  net: number; // income − spending − invest
  savingsRate: number | null; // (income − spending) / income
  prev: { income: number; spending: number; invest: number } | null;
  spendCategories: CategoryTotal[];
  incomeCategories: CategoryTotal[];
  investCategory: CategoryTotal | null;
  coverage: { from: string; to: string; days: number; fullDays: number };
  txCount: number;
}

export function monthsIn(txns: CategorizedTx[]): string[] {
  return [...new Set(txns.map((t) => t.date.slice(0, 7)))].sort();
}

/** Default period: the latest month that has at least 20 days of data, else everything. */
export function defaultPeriod(txns: CategorizedTx[]): string {
  if (!txns.length) return ALL;
  const ds = txns.map((t) => t.date).sort();
  const [min, max] = [ds[0], ds[ds.length - 1]];
  const months = monthsIn(txns).reverse();
  for (const m of months) if (coverageOf(m, min, max).days >= 20) return m;
  return ALL;
}

function coverageOf(period: string, min: string, max: string) {
  if (period === ALL) return { from: min, to: max, days: dayNum(max) - dayNum(min) + 1, fullDays: dayNum(max) - dayNum(min) + 1 };
  const start = `${period}-01`;
  const end = `${period}-${String(daysInMonth(period)).padStart(2, '0')}`;
  const from = min > start ? min : start;
  const to = max < end ? max : end;
  return { from, to, days: Math.max(0, dayNum(to) - dayNum(from) + 1), fullDays: daysInMonth(period) };
}

const inPeriod = (t: CategorizedTx, period: string) => period === ALL || t.date.startsWith(period);

function prevMonth(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function totals(txns: CategorizedTx[]) {
  let income = 0;
  let spending = 0;
  let invest = 0;
  let transfers = 0;
  for (const t of txns) {
    const k = categoryOf(t.category).kind;
    if (k === 'transfer') transfers += Math.abs(t.amount);
    else if (k === 'invest') invest -= t.amount; // money into investments (net of withdrawals)
    else if (k === 'income') income += t.amount;
    else spending -= t.amount; // spend + cash; refunds inside a spend category reduce it
  }
  return { income: round2(income), spending: round2(spending), invest: round2(invest), transfers: round2(transfers) };
}

function groupCategories(txns: CategorizedTx[], prevTx: CategorizedTx[], kinds: string[], sign: 1 | -1, base: number): CategoryTotal[] {
  const by = new Map<string, { total: number; count: number; items: Map<string, { total: number; count: number }> }>();
  for (const t of txns) {
    if (!kinds.includes(categoryOf(t.category).kind)) continue;
    const g = by.get(t.category) ?? by.set(t.category, { total: 0, count: 0, items: new Map() }).get(t.category)!;
    g.total += sign * t.amount;
    g.count++;
    const it = g.items.get(t.name) ?? g.items.set(t.name, { total: 0, count: 0 }).get(t.name)!;
    it.total += sign * t.amount;
    it.count++;
  }
  const prevBy = new Map<string, number>();
  for (const t of prevTx) if (kinds.includes(categoryOf(t.category).kind)) prevBy.set(t.category, (prevBy.get(t.category) ?? 0) + sign * t.amount);
  return [...by.entries()]
    .map(([id, g]) => ({
      id,
      total: round2(g.total),
      count: g.count,
      prevTotal: round2(prevBy.get(id) ?? 0),
      share: base > 0 ? g.total / base : 0,
      items: [...g.items.entries()]
        .map(([name, v]) => ({ name, total: round2(v.total), count: v.count }))
        .sort((a, b) => b.total - a.total),
    }))
    .filter((c) => Math.abs(c.total) >= 0.005)
    .sort((a, b) => b.total - a.total);
}

export function summarize(all: CategorizedTx[], period: string): PeriodSummary {
  const ds = all.map((t) => t.date).sort();
  const coverage = coverageOf(period, ds[0] ?? '', ds[ds.length - 1] ?? '');
  const cur = all.filter((t) => inPeriod(t, period));
  // Only compare with the previous month if it is (nearly) complete — comparing against a few
  // days of data produces misleading "+700%" jumps.
  const candidate = period === ALL ? null : prevMonth(period);
  const prevPeriod = candidate && coverageOf(candidate, ds[0] ?? '', ds[ds.length - 1] ?? '').days >= 20 ? candidate : null;
  const prevTx = prevPeriod ? all.filter((t) => t.date.startsWith(prevPeriod)) : [];
  const tt = totals(cur);
  const pt = prevTx.length ? totals(prevTx) : null;
  return {
    period,
    prevPeriod: pt ? prevPeriod : null,
    ...tt,
    net: round2(tt.income - tt.spending - tt.invest),
    savingsRate: tt.income > 0 ? (tt.income - tt.spending) / tt.income : null,
    prev: pt ? { income: pt.income, spending: pt.spending, invest: pt.invest } : null,
    spendCategories: groupCategories(cur, prevTx, ['spend', 'cash'], -1, tt.spending),
    incomeCategories: groupCategories(cur, prevTx, ['income'], 1, tt.income),
    investCategory: groupCategories(cur, prevTx, ['invest'], -1, tt.invest)[0] ?? null,
    coverage,
    txCount: cur.length,
  };
}

/** Monthly series for the bar chart. */
export function monthlySeries(all: CategorizedTx[]) {
  return monthsIn(all).map((m) => ({ month: m, ...totals(all.filter((t) => t.date.startsWith(m))) }));
}

// ---------------------------------------------------------------- insights

export type InsightLevel = 'warn' | 'info' | 'good';

export interface Insight {
  id: string;
  level: InsightLevel;
  /** i18n key */
  key: string;
  vars: Record<string, string | number>;
  /** counterparty / category to jump to */
  focus?: { kind: 'name' | 'category'; value: string };
}

/** One service paid through different routes (e.g. OpenAI directly AND via Google Play). */
const SERVICES: [string, RegExp][] = [
  ['ChatGPT', /OPENAI|CHATGPT/],
  ['Claude', /ANTHROPIC|CLAUDE/],
  ['Grok', /\bGROK\b|\bX\.AI\b|\bXAI\b/],
  ['Gemini', /GEMINI|GOOGLE ONE/],
  ['Perplexity', /PERPLEXITY/],
  ['Netflix', /NETFLIX/],
  ['Spotify', /SPOTIFY/],
  ['YouTube', /YOUTUBE/],
  ['Microsoft', /MICROSOFT|XBOX GAME PASS/],
  ['Amazon Prime', /AMAZON PRIME|PRIME VIDEO/],
  ['Disney+', /DISNEY/],
];

export function insights(all: CategorizedTx[], aliases: Aliases, period: string): Insight[] {
  const s = summarize(all, period);
  const cur = all.filter((t) => inPeriod(t, period));
  const out: Insight[] = [];
  const months = period === ALL ? Math.max(1, s.coverage.days / 30.4) : 1;
  const perMonth = (v: number) => v / months;
  const catTotal = (id: string) => s.spendCategories.find((c) => c.id === id)?.total ?? 0;

  // overall balance
  if (s.income > 0 && s.spending + s.invest > s.income) {
    out.push({ id: 'over', level: 'warn', key: 'insOverspend', vars: { gap: s.spending + s.invest - s.income } });
  } else if (s.income > 0 && s.savingsRate !== null && s.savingsRate > 0) {
    out.push({ id: 'saved', level: s.savingsRate >= 0.2 ? 'good' : 'info', key: 'insSaved', vars: { pct: Math.round(s.savingsRate * 100), amt: s.income - s.spending } });
  }

  // AI + subscriptions
  const ai = catTotal('ai');
  if (ai >= 50) {
    const services = new Set(cur.filter((t) => t.category === 'ai' && t.amount < 0).map((t) => t.name)).size;
    out.push({ id: 'ai', level: ai >= 150 ? 'warn' : 'info', key: 'insAi', vars: { amt: perMonth(ai), year: perMonth(ai) * 12, n: services }, focus: { kind: 'category', value: 'ai' } });
  }
  const subs = CATEGORIES.filter((c) => c.subscription).reduce((sum, c) => sum + catTotal(c.id), 0);
  if (subs > 0) out.push({ id: 'subs', level: 'info', key: 'insSubs', vars: { amt: perMonth(subs), year: perMonth(subs) * 12 } });

  // same service through two payment routes
  const outNames = [...new Set(cur.filter((t) => t.amount < 0).map((t) => t.name))];
  for (const [service, re] of SERVICES) {
    const names = outNames.filter((n) => re.test(n));
    if (names.length >= 2) {
      const amt = cur.filter((t) => t.amount < 0 && names.includes(t.name)).reduce((x, t) => x - t.amount, 0);
      out.push({ id: `dupsvc-${service}`, level: 'warn', key: 'insDupService', vars: { service, names: names.join(' + '), amt } });
    }
  }

  // a subscription billed twice within 7 days
  const subTx = cur.filter((t) => t.amount < 0 && categoryOf(t.category).subscription);
  const byName = new Map<string, CategorizedTx[]>();
  for (const t of subTx) (byName.get(t.name) ?? byName.set(t.name, []).get(t.name)!).push(t);
  for (const [name, list] of byName) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < list.length; i++) {
      if (dayNum(list[i].date) - dayNum(list[i - 1].date) <= 7) {
        out.push({
          id: `double-${name}`,
          level: 'warn',
          key: 'insDoubleBill',
          vars: { name, d1: list[i - 1].date, a1: -list[i - 1].amount, d2: list[i].date, a2: -list[i].amount },
          focus: { kind: 'name', value: name },
        });
        break;
      }
    }
  }

  // many small purchases at one place
  const spendByName = new Map<string, CategorizedTx[]>();
  for (const t of cur) if (t.amount < 0 && categoryOf(t.category).kind === 'spend' && !categoryOf(t.category).subscription) (spendByName.get(t.name) ?? spendByName.set(t.name, []).get(t.name)!).push(t);
  const frequent = [...spendByName.entries()]
    .map(([name, list]) => ({ name, n: list.length, amt: list.reduce((x, t) => x - t.amount, 0) }))
    .filter((f) => perMonth(f.n) >= 8 && f.amt / f.n < 40)
    .sort((a, b) => b.amt - a.amt)
    .slice(0, 2);
  for (const f of frequent)
    out.push({ id: `freq-${f.name}`, level: 'info', key: 'insFrequent', vars: { name: f.name, n: f.n, amt: f.amt, avg: f.amt / f.n, year: perMonth(f.amt) * 12 }, focus: { kind: 'name', value: f.name } });

  // category jumped vs previous month
  if (s.prev) {
    s.spendCategories
      .filter((c) => c.prevTotal > 0 && c.total - c.prevTotal >= 50 && c.total / c.prevTotal >= 1.3)
      .sort((a, b) => b.total - b.prevTotal - (a.total - a.prevTotal))
      .slice(0, 3) // the three biggest jumps; more is noise
      .forEach((c) =>
        out.push({ id: `up-${c.id}`, level: 'warn', key: 'insCategoryUp', vars: { cat: c.id, from: c.prevTotal, to: c.total, pct: Math.round((c.total / c.prevTotal - 1) * 100) }, focus: { kind: 'category', value: c.id } }),
      );
  }

  // recurring price increases (look at all data, report those whose last charge is in this period)
  for (const r of detectRecurring(all, aliases)) {
    if (r.priceIncrease && inPeriod({ date: r.lastDate } as CategorizedTx, period)) {
      out.push({ id: `price-${r.counterparty}`, level: 'warn', key: 'insPriceUp', vars: { name: r.counterparty, from: r.typicalAmount, to: r.lastAmount }, focus: { kind: 'name', value: r.counterparty } });
    }
  }

  // exact duplicate charges
  for (const d of findDuplicates(cur, aliases)) {
    if (d.kind === 'exact' && d.amount < 0) {
      out.push({ id: `dup-${d.counterparty}-${d.transactions[0].date}`, level: 'warn', key: 'insDuplicate', vars: { name: d.counterparty, amt: -d.amount, n: d.transactions.length, date: d.transactions[0].date }, focus: { kind: 'name', value: d.counterparty } });
    }
  }

  // cash and investing
  const cash = catTotal('cash');
  if (cash >= 100 && cash >= s.spending * 0.03) out.push({ id: 'cash', level: 'info', key: 'insCash', vars: { amt: cash, pct: s.spending > 0 ? Math.round((cash / s.spending) * 100) : 0 }, focus: { kind: 'category', value: 'cash' } });
  if (s.invest > 0) out.push({ id: 'invest', level: 'info', key: 'insInvest', vars: { amt: s.invest, pct: s.income > 0 ? Math.round((s.invest / s.income) * 100) : 0 }, focus: { kind: 'category', value: 'invest' } });

  // biggest category
  const top = s.spendCategories[0];
  if (top && top.share >= 0.25) out.push({ id: 'top', level: 'info', key: 'insTopCategory', vars: { cat: top.id, amt: top.total, pct: Math.round(top.share * 100) }, focus: { kind: 'category', value: top.id } });

  const order: Record<InsightLevel, number> = { warn: 0, info: 1, good: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
