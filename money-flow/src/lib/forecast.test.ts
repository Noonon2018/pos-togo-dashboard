import { defaultSettings, isSimulationCsv, parseSimulationCsv, simulate, type Settings } from './forecast';

// Fictional numbers chosen to be easy to check by hand. 2026-03-02 is a Monday.
const CSV = `section,item,value,unit,status,source,notes
cash_position,checking_available_usd,1200,USD,confirmed,Bank 2026-03-02 09:00,
cash_position,checking_current_usd,1000,USD,confirmed,Bank 2026-03-02 09:00,
cash_position,pending_in_toast_usd,300,USD,confirmed,Bank pending 2026-03-02,Toast payout in transit
cash_position,uber_held_excluded_usd,500,USD,confirmed,Uber 2026-03-01,HELD
cash_position,check_7_sent_not_cleared_usd,100,USD,confirmed,Owner,"Electric check"
sales_history,toast_net_sales_2026_03_mtd_to_1st,400,USD,confirmed,Toast,
sales_distribution,toast_daily_mean_recent17,500,USD/day,confirmed,Toast,
sales_distribution,toast_daily_stdev_recent17,200,USD/day,confirmed,Toast,
sales_distribution,toast_daily_min_recent17,250,USD/day,confirmed,Toast,
sales_distribution,toast_daily_max_recent17,900,USD/day,confirmed,Toast,
sales_distribution,toast_avg_daily_28d,450,USD/day,confirmed,Toast,
sales_distribution,doordash_payout_per_week,70,USD/week,estimate,pace,"Cycle projected payout 90.50, final due Thu"
platform_terms,toast_payout_lag_days,2,days,confirmed,Observed,
platform_terms,toast_fee_pct,0,percent,confirmed,Observed,
fixed_costs_monthly,rent,2000,USD/month,confirmed,Lease,Due 1st
fixed_costs_monthly,payroll_total,,USD/month,UNKNOWN,No data,BIGGEST GAP
dated_obligations,2026-03-06_sales_tax_feb_reserve,80,USD,estimate,10% x Feb sales 800,ESTIMATE ONLY
dated_obligations,2026-03-05_card_0480_statement_balance,600,USD,confirmed,Card,Minimum payment 25.00; APR UNKNOWN
dated_obligations,2026-04-01_rent_april,2000,USD,confirmed,Lease,
debts,water_overdue,150,USD,confirmed,Bill,overdue
debts,card_apr,,percent,UNKNOWN,Not on file,
`;

describe('simulation input file', () => {
  const input = parseSimulationCsv(CSV);
  it('is recognised and read', () => {
    expect(isSimulationCsv(CSV)).toBe(true);
    expect(isSimulationCsv('Date,Description,Amount\n')).toBe(false);
    expect(input).toMatchObject({
      asOf: '2026-03-02',
      cashCurrent: 1000,
      heldUber: 500,
      doordashPerWeek: 70,
      doordashNext: 90.5,
      salesTaxPct: 10,
      cardStatement: 600,
      cardMinimum: 25,
      cardDate: '2026-03-05',
      salesMtd: { '2026-03': 400 },
    });
    expect(input.pendingIn).toEqual([{ label: 'Toast payout in transit', amount: 300 }]);
    expect(input.pendingOut.map((p) => p.amount)).toEqual([100]);
    expect(input.unknown.map((u) => u.item)).toEqual(['Payroll Total', 'Card Apr']);
    expect(input.obligations.map((o) => [o.id, o.date, o.amount, o.kind])).toEqual([
      ['2026-03-06_sales_tax_feb_reserve', '2026-03-06', 80, 'dated'],
      ['2026-04-01_rent_april', '2026-04-01', 2000, 'dated'],
      ['water_overdue', '2026-03-04', 150, 'debt'], // debts default to 2 days after the file date
    ]);
  });

  it('scenarios come from the sales spread', () => {
    expect(defaultSettings(input)).toMatchObject({ salesBad: 300, salesNormal: 450, salesGood: 600, foodPct: 30, payrollPct: 30 });
  });

  it('walks day by day: pending, payout lag, food, payroll, platforms, bills, debts, card', () => {
    const st: Settings = { ...defaultSettings(input), horizonDays: 6, foodPct: 10, payrollPct: 20 };
    const r = simulate(input, st, 500);
    const sums = r.days.map((d) => [d.date, Math.round(d.events.reduce((s, e) => s + e.amount, 0) * 100) / 100]);
    expect(sums).toEqual([
      ['2026-03-02', -50], // Mon: food 10% of 500
      ['2026-03-03', 150], // Tue: pending +300 −100, food −50
      ['2026-03-04', 300], // Wed: first Toast payout (Mon sales, 2-day lag) +500, food −50, water debt −150
      ['2026-03-05', 515.5], // Thu: Toast +500, food −50, DoorDash first payout 90.50, card minimum −25
      ['2026-03-06', -330], // Fri: Toast +500, food −50, payroll 20% × 7 × 500 = −700, Feb sales tax −80
      ['2026-03-07', 450],
      ['2026-03-08', 450],
    ]);
    expect(r.days.at(-1)!.close).toBe(1000 + (-50 + 150 + 300 + 515.5 - 330 + 450 + 450));
    expect(r.firstNegative).toBeNull();
  });

  it('finds the first day below zero; the dated April rent replaces the monthly rent', () => {
    const st: Settings = { ...defaultSettings(input), horizonDays: 31, foodPct: 0, payrollPct: 0 };
    const r = simulate(input, st, 0); // no sales at all
    const rent = r.days.flatMap((d) => d.events.filter((e) => e.amount === -2000).map(() => d.date));
    expect(rent).toEqual(['2026-04-01']); // once, not twice
    expect(r.firstNegative).toBe('2026-04-01');
  });

  it('next month sales tax = (sales already made + forecast) × rate, on the 20th', () => {
    const st: Settings = { ...defaultSettings(input), horizonDays: 50, foodPct: 0, payrollPct: 0 };
    const r = simulate(input, st, 100);
    const tax = r.days.find((d) => d.date === '2026-04-20')!.events.find((e) => e.group === 'tax')!;
    expect(tax.amount).toBeCloseTo(-(400 + 30 * 100) * 0.1, 2); // March: 400 before + 30 days × 100
  });

  it('Uber money only when switched on, and paying the card in full', () => {
    const base: Settings = { ...defaultSettings(input), horizonDays: 14, foodPct: 0, payrollPct: 0 };
    const off = simulate(input, base, 0).end;
    expect(simulate(input, { ...base, includeUber: true, uberDate: '2026-03-10' }, 0).end).toBe(off + 500);
    expect(simulate(input, { ...base, cardMode: 'full' }, 0).end).toBe(off - 575);
    expect(simulate(input, { ...base, payDates: { ...base.payDates, water_overdue: '' } }, 0).end).toBe(off + 150);
  });
});
