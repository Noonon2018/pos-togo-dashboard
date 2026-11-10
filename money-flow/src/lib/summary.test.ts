import { autoCategory, categorize, type CategoryOverrides } from './categories';
import { ALL, defaultPeriod, insights, monthlySeries, summarize } from './summary';
import { normalizeCounterparty } from './normalize';
import type { Transaction } from './types';

let seq = 0;
const tx = (date: string, amount: number, description: string, account = 'Checking'): Transaction => ({
  id: `t${seq++}`,
  account,
  date,
  amount,
  description,
  counterparty: normalizeCounterparty(description),
  source: 'test',
});

describe('autoCategory', () => {
  const cat = (desc: string, amount = -10) => {
    const t = tx('2026-10-01', amount, desc);
    return autoCategory(t, t.counterparty, false);
  };
  it.each([
    ['Recurring Card Purchase 10/22 Google *Claude By An G.CO/Helppay# CA Card 1368', 'ai'],
    ['Recurring Card Purchase 10/16 Google *Grok G.CO/Helppay# CA Card 1368', 'ai'],
    ['Recurring Card Purchase 10/15 Openai *Chatgpt Subscr Openai.Com CA Card 1368', 'ai'],
    ['Recurring Card Purchase 10/08 Google *G1Ai101M 855-836-3987 CA Card 1368', 'ai'],
    ['Card Purchase 10/02 Google *Honor of King 855-836-3987 CA Card 1368', 'games'],
    ['Recurring Card Purchase 09/30 Google *Microsoft On G.CO/Helppay# CA Card 1368', 'apps'],
    ['Recurring Card Purchase 10/22 Netflix.Com Netflix.Com CA Card 1368', 'apps'],
    ['Recurring Card Purchase 10/02 Amazon Prime*Kd5Bg9V Amzn.Com/Bill WA Card 1368', 'apps'],
    ['Card Purchase 10/02 Amazon Mktpl*593P59Z Amzn.Com/Bill WA Card 1368', 'shopping'],
    ['Card Purchase 09/25 Express Food Mart Houston TX Card 1368', 'convenience'],
    ['Card Purchase 09/23 Andrew Liquor Houston TX Card 1368', 'alcohol'],
    ['Card Purchase 09/24 Doordash*09/22-2 Orde 855-431-0459 CA Card 1368', 'dining'],
    ['Card Purchase With Pin 10/06 H-E-B #575 Houston TX Card 1368', 'grocery'],
    ['Card Purchase With Pin 10/10 Hong Kong Food Houston TX Card 1368', 'grocery'],
    ['Recurring Card Purchase 09/23 Visible 866-331-3527 CO Card 1368', 'phone'],
    ['Payment Sent 09/30 Coinbase Https://Www.F CA Card 1368', 'invest'],
    ['ATM Withdrawal 10/01 13070 Bellaire Blvd Houston TX Card 1368', 'cash'],
    ['ZELLE PAYMENT TO SOMCHAI K JPM7708CD34', 'people'],
    ['ZELLE PAYMENT TO NARIN PROPERTY MGMT JPM9908AB12', 'housing'],
    ['SYSCO HOUSTON INC ACH DEBIT 20260804', 'business'],
    ['ONLINE TRANSFER TO SAV ...7788 TRANSACTION#: 10855443322', 'transfer'],
  ])('%s -> %s', (desc, want) => expect(cat(desc)).toBe(want));

  it.each([
    ['Remote Online Deposit 1', 'deposit'],
    ['Zelle Payment From Somchai Jaidee Bacf23Jnupvj', 'from_people'],
    ['ORIG CO NAME:GUSTO ORIG ID:9876543210 DESC DATE:260807 CO ENTRY DESCR:PAYROLL', 'salary'],
    ['INTEREST PAYMENT', 'interest'],
    ['AMAZON MKTP US*ZZ1QW8 AMZN.COM/BILL WA RETURN', 'refund'],
  ])('income %s -> %s', (desc, want) => expect(cat(desc, 50)).toBe(want));
});

describe('categorize', () => {
  it('applies user overrides only in the right direction', () => {
    const t = [tx('2026-10-01', -30, 'MYSTERY SHOP'), tx('2026-10-02', 30, 'MYSTERY SHOP')];
    const o: CategoryOverrides = { 'MYSTERY SHOP': 'grocery' };
    expect(categorize(t, {}, o).map((x) => x.category)).toEqual(['grocery', 'income_other']);
  });
  it('own-account transfers win over everything', () => {
    const t = [tx('2026-10-01', -500, 'ONLINE TRANSFER TO SAV ...7788', 'Checking'), tx('2026-10-02', 1, 'X', 'Savings')];
    expect(categorize(t, { 'TRANSFER SAV 7788': 'Savings' }, { Savings: 'grocery' })[0].category).toBe('transfer');
  });
});

// A month shaped like a real personal checking statement (fake data)
const month = [
  tx('2026-09-24', -25, 'Recurring Card Purchase 09/23 Visible 866-331-3527 CO Card 1368'),
  tx('2026-09-30', 1120, 'Remote Online Deposit 1'),
  tx('2026-10-01', -160, 'Payment Sent 09/30 Coinbase Https://Www.F CA Card 1368'),
  tx('2026-10-01', -300, 'ATM Withdrawal 10/01 13070 Bellaire Blvd Houston TX Card 1368'),
  tx('2026-10-15', 1820, 'Remote Online Deposit 1'),
  tx('2026-10-15', -53.2, 'Recurring Card Purchase 10/15 Openai *Chatgpt Subscr Openai.Com CA Card 1368'),
  tx('2026-10-19', -108.25, 'Recurring Card Purchase 10/16 Google *Grok G.CO/Helppay# CA Card 1368'),
  tx('2026-10-21', -21.64, 'Recurring Card Purchase 10/21 Google *Chatgpt 855-836-3987 CA Card 1368'),
  tx('2026-10-22', -233.82, 'Recurring Card Purchase 10/22 Google *Claude By An G.CO/Helppay# CA Card 1368'),
  tx('2026-10-22', -32.48, 'Recurring Card Purchase 10/22 Google *Grok G.CO/Helppay# CA Card 1368'),
  tx('2026-10-22', -29.22, 'Recurring Card Purchase 10/22 Netflix.Com Netflix.Com CA Card 1368'),
  ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 13].map((d) => tx(`2026-10-${String(d).padStart(2, '0')}`, -12.5, 'Card Purchase 10/01 Express Food Mart Houston TX Card 1368')),
  tx('2026-10-14', 100, 'Zelle Payment From Somchai Jaidee Bacgauy8Idq7'),
];
const ct = categorize(month, {}, {});

describe('summarize', () => {
  it('splits income, real spending and investing', () => {
    const s = summarize(ct, '2026-10');
    expect(s.income).toBe(1920);
    expect(s.invest).toBe(160);
    expect(s.spending).toBeCloseTo(300 + 53.2 + 108.25 + 21.64 + 233.82 + 32.48 + 29.22 + 125, 2);
    expect(s.net).toBeCloseTo(s.income - s.spending - s.invest, 2);
    expect(s.spendCategories[0]).toMatchObject({ id: 'ai', count: 5 });
    expect(s.spendCategories[0].items[0]).toMatchObject({ name: 'GOOGLE PLAY: CLAUDE BY AN', total: 233.82 });
    expect(s.prev).toBeNull(); // September has only 7 days of data -> no misleading comparison
    expect(s.coverage).toMatchObject({ from: '2026-10-01', to: '2026-10-22', days: 22, fullDays: 31 });
  });
  it('picks the latest month with ≥20 days of data by default', () => {
    expect(defaultPeriod(ct)).toBe('2026-10');
    expect(defaultPeriod(categorize([tx('2026-10-01', -1, 'A'), tx('2026-10-05', -1, 'B')], {}, {}))).toBe(ALL);
  });
  it('monthly series has one row per month', () => {
    expect(monthlySeries(ct).map((m) => m.month)).toEqual(['2026-09', '2026-10']);
  });
});

describe('previous-month comparison', () => {
  it('compares only against a (nearly) complete previous month', () => {
    const full = categorize(
      [
        ...Array.from({ length: 30 }, (_, i) => tx(`2026-09-${String(i + 1).padStart(2, '0')}`, -10, 'H-E-B #1 HOUSTON TX')),
        ...Array.from({ length: 31 }, (_, i) => tx(`2026-10-${String(i + 1).padStart(2, '0')}`, -20, 'H-E-B #1 HOUSTON TX')),
      ],
      {},
      {},
    );
    const s = summarize(full, '2026-10');
    expect(s.prev).toMatchObject({ spending: 300 });
    expect(insights(full, {}, '2026-10').some((i) => i.id === 'up-grocery')).toBe(true);
  });
});

describe('insights', () => {
  const ins = insights(ct, {}, '2026-10');
  const ids = ins.map((i) => i.id);
  it('finds the things a person should look at', () => {
    expect(ids).toEqual(
      expect.arrayContaining(['ai', 'subs', 'dupsvc-ChatGPT', 'double-GOOGLE PLAY: GROK', 'freq-EXPRESS FOOD MART HOUSTON', 'cash', 'invest', 'saved']),
    );
    expect(ins.find((i) => i.id === 'dupsvc-ChatGPT')?.vars.names).toBe('OPENAI + GOOGLE PLAY: CHATGPT');
    expect(ins.find((i) => i.id === 'ai')).toMatchObject({ level: 'warn', vars: { n: 4 } });
    expect(ins.find((i) => i.id === 'freq-EXPRESS FOOD MART HOUSTON')?.vars).toMatchObject({ n: 10, amt: 125 });
  });
  it('lists warnings first', () => {
    const levels = ins.map((i) => i.level);
    expect(levels.indexOf('info')).toBeGreaterThan(levels.lastIndexOf('warn'));
  });
  it('warns when spending + investing exceeds income', () => {
    const t = categorize([tx('2026-10-01', 100, 'Remote Online Deposit 1'), tx('2026-10-02', -150, 'H-E-B #1 HOUSTON TX')], {}, {});
    expect(insights(t, {}, '2026-10')[0]).toMatchObject({ id: 'over', level: 'warn' });
  });
});
