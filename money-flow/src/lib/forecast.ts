import Papa from 'papaparse';

/**
 * Cash forecast from a "simulation input" CSV (section,item,value,unit,status,source,notes):
 * the cash in the bank today, how much the restaurant sells per day, platform payouts, monthly
 * bills, dated obligations and debts. We walk forward day by day and show when the bank balance
 * would go below zero, for a bad / normal / good level of daily sales.
 *
 * Deterministic on purpose: every number on screen can be traced to a row of the file or to an
 * assumption the owner can see and change. Nothing here is stored except those assumptions.
 */

export interface SimRow {
  section: string;
  item: string;
  value: number | null;
  unit: string;
  status: string;
  source: string;
  notes: string;
}

export interface Obligation {
  id: string;
  label: string;
  amount: number;
  /** ISO date; for monthly bills the day of month is used */
  date: string;
  kind: 'dated' | 'debt' | 'card';
  status: string;
}

export interface MonthlyBill {
  id: string;
  label: string;
  amount: number;
  day: number;
  /** due day not in the file: assumed */
  dayAssumed: boolean;
  status: string;
}

export interface SimInput {
  asOf: string;
  cashCurrent: number;
  cashAvailable: number | null;
  pendingIn: { label: string; amount: number }[];
  pendingOut: { label: string; amount: number }[];
  heldUber: number;
  sales: { mean: number; sd: number; avg28: number; min: number; max: number };
  toastFeePct: number;
  toastLagDays: number;
  doordashPerWeek: number;
  doordashNext: number | null;
  grubhubPerWeek: number;
  salesTaxPct: number;
  monthly: MonthlyBill[];
  obligations: Obligation[];
  cardStatement: number | null;
  cardMinimum: number;
  cardDate: string | null;
  /** month (YYYY-MM) → sales already made this month before the forecast starts */
  salesMtd: Record<string, number>;
  /** rows the file marks UNKNOWN (shown as warnings) */
  unknown: { item: string; notes: string }[];
  rows: SimRow[];
}

const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => isoOf(new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000));
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday

export function isSimulationCsv(text: string): boolean {
  const head = (Papa.parse<string[]>(text.replace(/^﻿/, ''), { preview: 1 }).data[0] ?? []).map((h) => h.trim().toLowerCase());
  return ['section', 'item', 'value'].every((h) => head.includes(h));
}

const pretty = (item: string) =>
  item
    .replace(/^\d{4}-\d{2}-\d{2}_/, '')
    .replace(/_usd$|_pct$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

/** Due days the file does not give (owner can change them on screen). */
const DUE_DAY: [RegExp, number][] = [
  [/rent/, 1],
  [/toast/, 1],
  [/electric|constellation/, 5],
  [/waste|wm/, 15],
  [/comcast|internet/, 25],
  [/water/, 29],
];

export function parseSimulationCsv(text: string): SimInput {
  const data = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim().toLowerCase() }).data;
  const rows: SimRow[] = data.map((r) => {
    const v = (r.value ?? '').trim();
    return {
      section: (r.section ?? '').trim(),
      item: (r.item ?? '').trim(),
      value: v === '' || !Number.isFinite(Number(v)) ? null : Number(v),
      unit: (r.unit ?? '').trim(),
      status: (r.status ?? '').trim(),
      source: (r.source ?? '').trim(),
      notes: (r.notes ?? '').trim(),
    };
  });
  const get = (section: string, re: RegExp) => rows.find((r) => r.section === section && re.test(r.item));
  const num = (section: string, re: RegExp, d = 0) => get(section, re)?.value ?? d;

  const asOf =
    rows.map((r) => r.source.match(/(\d{4}-\d{2}-\d{2})/)?.[1]).filter((x): x is string => !!x).sort().at(-1) ?? isoOf(new Date());

  const pendingIn = rows
    .filter((r) => r.section === 'cash_position' && /^pending_in/.test(r.item) && r.value)
    .map((r) => ({ label: r.notes || pretty(r.item), amount: r.value! }));
  const pendingOut = rows
    .filter((r) => r.section === 'cash_position' && /(not_cleared|check_\d+_pending|pending_out)/.test(r.item) && r.value)
    .map((r) => ({ label: `${pretty(r.item)}${r.notes ? ` — ${r.notes}` : ''}`, amount: r.value! }));

  const dated = rows.filter((r) => r.section === 'dated_obligations' && r.value !== null);
  const card = dated.find((r) => /card/.test(r.item));
  const obligations: Obligation[] = [
    ...dated
      .filter((r) => r !== card)
      .map((r) => ({
        id: r.item,
        label: pretty(r.item),
        amount: r.value!,
        date: r.item.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? asOf,
        kind: 'dated' as const,
        status: r.status,
      })),
    ...rows
      .filter((r) => r.section === 'debts' && r.value !== null && r.unit.toUpperCase() === 'USD')
      .map((r) => ({ id: r.item, label: pretty(r.item), amount: r.value!, date: addDays(asOf, 2), kind: 'debt' as const, status: r.status })),
  ];

  const monthly: MonthlyBill[] = rows
    .filter((r) => r.section === 'fixed_costs_monthly' && r.value !== null)
    .map((r) => {
      const hit = DUE_DAY.find(([re]) => re.test(r.item));
      return { id: r.item, label: pretty(r.item), amount: r.value!, day: hit?.[1] ?? 1, dayAssumed: true, status: r.status };
    });

  const dd = get('sales_distribution', /doordash/);
  const ddNext = Number(dd?.notes.match(/projected payout\s*([\d,.]+)/i)?.[1]?.replace(/,/g, ''));
  const taxRow = get('dated_obligations', /sales_tax/);
  const taxPct = Number(taxRow?.source.match(/([\d.]+)%/)?.[1] ?? taxRow?.notes.match(/([\d.]+)%/)?.[1] ?? 8.25);

  return {
    asOf,
    cashCurrent: num('cash_position', /checking_current/),
    cashAvailable: get('cash_position', /checking_available/)?.value ?? null,
    pendingIn,
    pendingOut,
    heldUber: num('cash_position', /uber_held/),
    sales: {
      mean: num('sales_distribution', /daily_mean/),
      sd: num('sales_distribution', /daily_stdev/),
      avg28: num('sales_distribution', /avg_daily_28d/, num('sales_distribution', /daily_mean/)),
      min: num('sales_distribution', /daily_min/),
      max: num('sales_distribution', /daily_max/),
    },
    toastFeePct: num('platform_terms', /toast_fee_pct/),
    toastLagDays: num('platform_terms', /toast_payout_lag/, 2),
    doordashPerWeek: dd?.value ?? 0,
    doordashNext: Number.isFinite(ddNext) && ddNext > 0 ? ddNext : null,
    grubhubPerWeek: num('sales_distribution', /grubhub/),
    salesTaxPct: Number.isFinite(taxPct) ? taxPct : 8.25,
    monthly,
    obligations,
    cardStatement: card?.value ?? null,
    cardMinimum: Number(card?.notes.match(/minimum payment\s*([\d.]+)/i)?.[1] ?? 25),
    cardDate: card?.item.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null,
    salesMtd: Object.fromEntries(
      rows
        .filter((r) => r.section === 'sales_history' && /_mtd/.test(r.item) && r.value !== null)
        .map((r) => {
          const m = r.item.match(/(\d{4})_(\d{2})/);
          return [m ? `${m[1]}-${m[2]}` : '', r.value!];
        })
        .filter(([k]) => k),
    ),
    unknown: rows.filter((r) => /unknown/i.test(r.status)).map((r) => ({ item: pretty(r.item), notes: r.notes })),
    rows,
  };
}

export interface Settings {
  horizonDays: number;
  /** average Toast net sales per day for each scenario */
  salesBad: number;
  salesNormal: number;
  salesGood: number;
  /** food & supplies bought, as % of sales, spent the same day */
  foodPct: number;
  /** wages + payroll taxes as % of sales, paid weekly */
  payrollPct: number;
  /** 0 = Sunday … 5 = Friday */
  payrollWeekday: number;
  includeUber: boolean;
  uberDate: string;
  cardMode: 'min' | 'full';
  /** obligation id → pay date, or '' to leave unpaid in this window */
  payDates: Record<string, string>;
  /** monthly bill id → due day */
  dueDays: Record<string, number>;
}

export function defaultSettings(input: SimInput): Settings {
  const s = input.sales;
  return {
    horizonDays: 45,
    salesBad: Math.round(Math.max(s.min, s.mean - s.sd)),
    salesNormal: Math.round(s.avg28 || s.mean),
    salesGood: Math.round(s.mean + s.sd / 2),
    foodPct: 30,
    payrollPct: 30,
    payrollWeekday: 5,
    includeUber: false,
    uberDate: addDays(input.asOf, 12),
    cardMode: 'min',
    payDates: Object.fromEntries(input.obligations.map((o) => [o.id, o.date])),
    dueDays: Object.fromEntries(input.monthly.map((m) => [m.id, m.day])),
  };
}

export interface CashEvent {
  label: string;
  amount: number; // + in, − out
  group: 'start' | 'sales' | 'platform' | 'food' | 'payroll' | 'bill' | 'tax' | 'debt' | 'card' | 'pending' | 'uber';
}

export interface Day {
  date: string;
  sales: number;
  events: CashEvent[];
  close: number;
}

export interface Run {
  days: Day[];
  low: { date: string; value: number };
  firstNegative: string | null;
  /** last day before the balance first goes negative */
  end: number;
}

/** Walk forward day by day for one level of daily sales. */
export function simulate(input: SimInput, st: Settings, dailySales: number): Run {
  const start = input.asOf;
  const days: Day[] = [];
  const fee = 1 - input.toastFeePct / 100;
  const lag = Math.max(0, Math.round(input.toastLagDays));
  let bal = input.cashCurrent;
  let ddFirst = true;
  const salesByDay: number[] = [];
  // dated items that replace a monthly bill in their month (e.g. "2026-12-01 rent december")
  const words = (id: string) => id.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !/^(usd|month|monthly|total|of|the|\d+)$/.test(w));
  const datedMonth = new Set(
    input.obligations
      .filter((o) => o.kind === 'dated')
      .flatMap((o) => input.monthly.filter((m) => words(m.id).some((w) => words(o.id).includes(w))).map((m) => `${m.id}|${o.date.slice(0, 7)}`)),
  );
  // month → sales (already made this month + forecast), for next month's sales tax
  const monthSales = new Map<string, number>(Object.entries(input.salesMtd));
  for (let i = 0; i <= st.horizonDays; i++) {
    const date = addDays(start, i);
    const ev: CashEvent[] = [];
    if (i === 0) ev.push({ label: 'start', amount: 0, group: 'start' });
    if (i === 1) {
      for (const p of input.pendingIn) ev.push({ label: p.label, amount: p.amount, group: 'pending' });
      for (const p of input.pendingOut) ev.push({ label: p.label, amount: -p.amount, group: 'pending' });
    }
    // sales today: food bought today, money arrives after the payout lag
    const sales = dailySales;
    salesByDay.push(sales);
    monthSales.set(date.slice(0, 7), (monthSales.get(date.slice(0, 7)) ?? 0) + sales);
    if (i - lag >= 0) ev.push({ label: 'toast', amount: salesByDay[i - lag] * fee, group: 'sales' });
    if (st.foodPct > 0) ev.push({ label: 'food', amount: -sales * (st.foodPct / 100), group: 'food' });
    if (st.payrollPct > 0 && weekday(date) === st.payrollWeekday) ev.push({ label: 'payroll', amount: -dailySales * 7 * (st.payrollPct / 100), group: 'payroll' });
    // platforms pay on Thursdays
    if (weekday(date) === 4) {
      if (input.doordashPerWeek || input.doordashNext) {
        ev.push({ label: 'doordash', amount: ddFirst && input.doordashNext ? input.doordashNext : input.doordashPerWeek, group: 'platform' });
        ddFirst = false;
      }
      if (input.grubhubPerWeek) ev.push({ label: 'grubhub', amount: input.grubhubPerWeek, group: 'platform' });
    }
    // monthly bills
    const dom = Number(date.slice(8, 10));
    for (const m of input.monthly) {
      const due = st.dueDays[m.id] ?? m.day;
      if (dom === due && i > 0 && !datedMonth.has(`${m.id}|${date.slice(0, 7)}`)) ev.push({ label: m.label, amount: -m.amount, group: 'bill' });
    }
    // sales tax for last month, on the 20th (the dated file row covers the first one)
    if (dom === 20 && !input.obligations.some((o) => o.kind === 'dated' && /sales_tax/.test(o.id) && o.date.slice(0, 7) === date.slice(0, 7))) {
      const prev = addDays(`${date.slice(0, 7)}-01`, -1).slice(0, 7);
      const base = monthSales.get(prev);
      if (base) ev.push({ label: `sales tax ${prev}`, amount: -base * (input.salesTaxPct / 100), group: 'tax' });
    }
    // dated obligations and debts, on the chosen date ('' = not paid in this window)
    for (const o of input.obligations) {
      if ((st.payDates[o.id] ?? o.date) === date) ev.push({ label: o.label, amount: -o.amount, group: o.kind === 'debt' ? 'debt' : /tax/.test(o.id) ? 'tax' : 'bill' });
    }
    if (input.cardStatement !== null) {
      if (input.cardDate === date) ev.push({ label: 'card', amount: -(st.cardMode === 'full' ? input.cardStatement : input.cardMinimum), group: 'card' });
    }
    if (st.includeUber && input.heldUber && st.uberDate === date) ev.push({ label: 'uber', amount: input.heldUber, group: 'uber' });
    bal = Math.round((bal + ev.reduce((s, e) => s + e.amount, 0)) * 100) / 100;
    days.push({ date, sales, events: ev, close: bal });
  }
  let low = { date: days[0].date, value: days[0].close };
  for (const d of days) if (d.close < low.value) low = { date: d.date, value: d.close };
  const neg = days.find((d) => d.close < 0);
  return { days, low, firstNegative: neg?.date ?? null, end: days[days.length - 1].close };
}
