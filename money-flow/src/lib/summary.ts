import { CATEGORIES, categoryOf, type CategorizedTx } from './categories';
import { detectRecurring, findDuplicates } from './aggregate';
import type { Aliases } from './types';
import { budgetStatus } from './budget';

const round2 = (n: number) => Math.round(n * 100) / 100;
const dayNum = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

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

/**
 * Periods. A period key is "YYYY-MM": the cycle that starts in that month on `cycleDay`.
 * cycleDay 1 = calendar months. cycleDay 24 = statement cycles like Chase (Sep 24 → Oct 23).
 */
export interface PeriodOptions {
  cycleDay?: number;
  /** Known data range beyond the transaction dates (e.g. statement period from a PDF). */
  dataFrom?: string;
  dataTo?: string;
  /** category id -> budget per period */
  budgets?: Record<string, number>;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const isoAdd = (iso: string, days: number) => new Date((dayNum(iso) + days) * 86_400_000).toISOString().slice(0, 10);
export const clampCycleDay = (d?: number) => Math.min(28, Math.max(1, Math.round(d || 1)));

function prevMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`;
}
function nextMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`;
}

export function periodRange(key: string, cycleDay = 1): { from: string; to: string } {
  const day = pad2(clampCycleDay(cycleDay));
  return { from: `${key}-${day}`, to: isoAdd(`${nextMonth(key)}-${day}`, -1) };
}

export function periodKeyOf(date: string, cycleDay = 1): string {
  const key = date.slice(0, 7);
  return Number(date.slice(8, 10)) >= clampCycleDay(cycleDay) ? key : prevMonth(key);
}

export function periodsIn(txns: { date: string }[], cycleDay = 1): string[] {
  return [...new Set(txns.map((t) => periodKeyOf(t.date, cycleDay)))].sort();
}
/** @deprecated use periodsIn — kept for calendar months */
export const monthsIn = (txns: { date: string }[]) => periodsIn(txns, 1);

function bounds(all: { date: string }[], opts: PeriodOptions) {
  const ds = all.map((t) => t.date).sort();
  let min = ds[0] ?? '';
  let max = ds[ds.length - 1] ?? '';
  if (opts.dataFrom && (!min || opts.dataFrom < min)) min = opts.dataFrom;
  if (opts.dataTo && (!max || opts.dataTo > max)) max = opts.dataTo;
  return { min, max };
}

function coverageOf(period: string, min: string, max: string, cycleDay = 1) {
  if (period === ALL || !min) {
    const d = min ? dayNum(max) - dayNum(min) + 1 : 0;
    return { from: min, to: max, days: d, fullDays: d };
  }
  const r = periodRange(period, cycleDay);
  const from = min > r.from ? min : r.from;
  const to = max < r.to ? max : r.to;
  return { from, to, days: Math.max(0, dayNum(to) - dayNum(from) + 1), fullDays: dayNum(r.to) - dayNum(r.from) + 1 };
}

const inPeriod = (date: string, period: string, cycleDay = 1) => {
  if (period === ALL) return true;
  const r = periodRange(period, cycleDay);
  return date >= r.from && date <= r.to;
};

/** Default period: the latest one with at least 20 days of data, else everything. */
export function defaultPeriod(txns: CategorizedTx[], opts: PeriodOptions = {}): string {
  if (!txns.length) return ALL;
  const { min, max } = bounds(txns, opts);
  for (const k of periodsIn(txns, opts.cycleDay).reverse()) if (coverageOf(k, min, max, opts.cycleDay).days >= 20) return k;
  return ALL;
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

export function summarize(all: CategorizedTx[], period: string, opts: PeriodOptions = {}): PeriodSummary {
  const day = opts.cycleDay;
  const { min, max } = bounds(all, opts);
  const coverage = coverageOf(period, min, max, day);
  const cur = all.filter((t) => inPeriod(t.date, period, day));
  // Only compare with the previous period if it is (nearly) complete — comparing against a few
  // days of data produces misleading "+700%" jumps.
  const candidate = period === ALL ? null : prevMonth(period);
  const prevPeriod = candidate && coverageOf(candidate, min, max, day).days >= 20 ? candidate : null;
  const prevTx = prevPeriod ? all.filter((t) => inPeriod(t.date, prevPeriod, day)) : [];
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

/** One row per period for the bar chart; `complete` = at least 20 days of data. */
export function monthlySeries(all: CategorizedTx[], opts: PeriodOptions = {}) {
  const { min, max } = bounds(all, opts);
  return periodsIn(all, opts.cycleDay).map((k) => {
    const s = summarize(all, k, opts);
    return {
      month: k,
      income: s.income,
      spending: s.spending,
      invest: s.invest,
      transfers: s.transfers,
      net: s.net,
      complete: coverageOf(k, min, max, opts.cycleDay).days >= 20,
    };
  });
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

export function insights(all: CategorizedTx[], aliases: Aliases, period: string, opts: PeriodOptions = {}): Insight[] {
  const s = summarize(all, period, opts);
  const cur = all.filter((t) => inPeriod(t.date, period, opts.cycleDay));
  const out: Insight[] = [];
  const months = period === ALL ? Math.max(1, s.coverage.days / 30.4) : 1;
  const perMonth = (v: number) => v / months;
  const catTotal = (id: string) => s.spendCategories.find((c) => c.id === id)?.total ?? 0;

  // overall balance
  if (s.income > 0 && s.spending + s.invest > s.income) {
    out.push({ id: 'over', level: 'warn', key: 'insOverspend', vars: { gap: s.spending + s.invest - s.income } });
  } else if (s.income > 0 && s.net > 0) {
    // same number as the "left over" card: income − spending − investing
    const rate = s.net / s.income;
    out.push({ id: 'saved', level: rate >= 0.2 ? 'good' : 'info', key: 'insSaved', vars: { pct: Math.round(rate * 100), amt: s.net } });
  }

  // budgets (per period; "all data" has no budget meaning)
  if (period !== ALL && opts.budgets) {
    let okCount = 0;
    let total = 0;
    for (const [cat, limit] of Object.entries(opts.budgets)) {
      if (!(limit > 0)) continue;
      total++;
      const st = budgetStatus(catTotal(cat), limit, s.coverage.days, s.coverage.fullDays);
      const vars = { cat, spent: st.spent, limit, pct: Math.round(st.pct * 100), left: Math.max(0, st.left), projected: st.projected ?? st.spent };
      const focus = { kind: 'category' as const, value: cat };
      if (st.state === 'over') out.push({ id: `budget-over-${cat}`, level: 'warn', key: 'insBudgetOver', vars, focus });
      else if (st.state === 'pace') out.push({ id: `budget-pace-${cat}`, level: 'warn', key: 'insBudgetPace', vars, focus });
      else if (st.state === 'near') out.push({ id: `budget-near-${cat}`, level: 'info', key: 'insBudgetNear', vars, focus });
      else okCount++;
    }
    if (total > 0 && okCount === total) out.push({ id: 'budget-ok', level: 'good', key: 'insBudgetOk', vars: { n: total } });
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
    if (r.priceIncrease && inPeriod(r.lastDate, period, opts.cycleDay)) {
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

  // a large share of all spending went to ONE person (bank transfers / Zelle / PromptPay)
  const people = s.spendCategories.find((c) => c.id === 'people');
  const topPerson = people?.items[0];
  if (topPerson && s.spending > 0 && topPerson.total / s.spending >= 0.2) {
    out.push({
      id: `person-${topPerson.name}`,
      level: 'warn',
      key: 'insTopPerson',
      vars: { name: topPerson.name, amt: topPerson.total, n: topPerson.count, pct: Math.round((topPerson.total / s.spending) * 100) },
      focus: { kind: 'name', value: topPerson.name },
    });
  }

  // biggest category
  const top = s.spendCategories[0];
  if (top && top.share >= 0.25) out.push({ id: 'top', level: 'info', key: 'insTopCategory', vars: { cat: top.id, amt: top.total, pct: Math.round(top.share * 100) }, focus: { kind: 'category', value: top.id } });

  const order: Record<InsightLevel, number> = { warn: 0, info: 1, good: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
