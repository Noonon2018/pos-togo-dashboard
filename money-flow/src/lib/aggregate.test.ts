import fs from 'node:fs';
import path from 'node:path';
import {
  OTHER_NODE,
  accountNodeId,
  accountTotals,
  buildGraph,
  cpNodeId,
  detectRecurring,
  filterTransactions,
  findDuplicates,
  monthlyTotals,
  nextDate,
  topCounterparties,
} from './aggregate';
import { applyMapping, guessMapping, parseCsvText } from './csv';
import { summaryCsv, csvCell } from './exportCsv';
import { DEFAULT_FILTERS, type Filters, type Transaction } from './types';

let seq = 0;
const tx = (account: string, date: string, amount: number, counterparty: string): Transaction => ({
  id: `t${seq++}`,
  account,
  date,
  amount,
  counterparty,
  description: counterparty,
  source: 'test',
});
const ALL: Filters = { ...DEFAULT_FILTERS, topN: 0 };

describe('buildGraph', () => {
  const txns = [
    tx('Checking', '2026-01-01', -10, 'NETFLIX'),
    tx('Checking', '2026-02-01', -10, 'NETFLIX'),
    tx('Checking', '2026-01-15', 2000, 'GUSTO'),
    tx('Card', '2026-01-03', -55.5, 'AMAZON'),
    tx('Card', '2026-01-04', -4.5, 'AMAZON'),
  ];

  it('aggregates directed edges with count and total', () => {
    const g = buildGraph(txns, {}, ALL);
    const e = (s: string, t: string) => g.edges.find((x) => x.source === s && x.target === t);
    expect(e(accountNodeId('Checking'), cpNodeId('NETFLIX'))).toMatchObject({ count: 2, total: 20 });
    expect(e(cpNodeId('GUSTO'), accountNodeId('Checking'))).toMatchObject({ count: 1, total: 2000 });
    expect(e(accountNodeId('Card'), cpNodeId('AMAZON'))).toMatchObject({ count: 2, total: 60 });
    expect(g.nodes.find((x) => x.id === accountNodeId('Checking'))).toMatchObject({ totalIn: 2000, totalOut: 20 });
  });

  it('edge totals sum to the raw absolute total (nothing lost)', () => {
    const g = buildGraph(txns, {}, ALL);
    const edgeSum = g.edges.reduce((s, e) => s + e.total, 0);
    expect(edgeSum).toBeCloseTo(txns.reduce((s, t) => s + Math.abs(t.amount), 0), 2);
  });

  it('applies aliases to merge counterparties', () => {
    const g = buildGraph([...txns, tx('Card', '2026-01-05', -5, 'AMZN DIGITAL')], { 'AMZN DIGITAL': 'AMAZON' }, ALL);
    expect(g.edges.find((e) => e.target === cpNodeId('AMAZON'))).toMatchObject({ count: 3, total: 65 });
  });

  it('groups small counterparties into OTHER when topN is set, preserving totals', () => {
    const g = buildGraph(txns, {}, { ...ALL, topN: 1 });
    expect(g.nodes.some((x) => x.id === cpNodeId('GUSTO'))).toBe(true);
    const other = g.nodes.find((x) => x.id === OTHER_NODE)!;
    expect(other.label).toMatch(/2 counterparties/);
    expect(other.totalIn).toBe(80); // 20 NETFLIX + 60 AMAZON
  });

  it('counts an internal transfer once and links the two account nodes', () => {
    const t = [
      tx('Checking', '2026-01-20', -500, 'TRANSFER SAV 7788'),
      tx('Savings', '2026-01-21', 500, 'TRANSFER CHK 9021'),
    ];
    const aliases = { 'TRANSFER SAV 7788': 'Savings', 'TRANSFER CHK 9021': 'Checking' };
    const g = buildGraph(t, aliases, ALL);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ source: accountNodeId('Checking'), target: accountNodeId('Savings'), count: 1, total: 500 });
    expect(g.mirroredTransferIds).toEqual([t[1].id]);
  });

  it('does not pair transfers whose amounts or dates do not match', () => {
    const t = [
      tx('Checking', '2026-01-20', -500, 'Savings'),
      tx('Savings', '2026-02-20', 500, 'Checking'),
      tx('Savings', '2026-01-21', 499, 'Checking'),
    ];
    const g = buildGraph(t, {}, ALL);
    expect(g.mirroredTransferIds).toEqual([]);
    expect(g.edges.find((e) => e.source === accountNodeId('Savings'))?.count).toBeUndefined();
  });
});

describe('filters', () => {
  const txns = [tx('A', '2026-01-01', -5, 'X'), tx('A', '2026-02-01', 50, 'Y'), tx('B', '2026-03-01', -500, 'Z')];
  it('date range / min amount / direction / account', () => {
    expect(filterTransactions(txns, { ...ALL, from: '2026-01-15', to: '2026-02-28' })).toHaveLength(1);
    expect(filterTransactions(txns, { ...ALL, minAmount: 10 })).toHaveLength(2);
    expect(filterTransactions(txns, { ...ALL, direction: 'in' }).map((t) => t.counterparty)).toEqual(['Y']);
    expect(filterTransactions(txns, { ...ALL, direction: 'out' })).toHaveLength(2);
    expect(filterTransactions(txns, { ...ALL, accounts: ['B'] })).toHaveLength(1);
  });
});

describe('summaries', () => {
  const txns = [
    tx('A', '2026-01-02', -100, 'SYSCO'),
    tx('A', '2026-01-09', -300, 'SYSCO'),
    tx('A', '2026-01-10', 900, 'SQUARE'),
    tx('A', '2026-02-10', 1000, 'SQUARE'),
    tx('A', '2026-02-11', -50, 'B'),
    tx('B', '2026-02-11', 50, 'A'),
  ];
  it('top counterparties', () => {
    expect(topCounterparties(txns, {}, 'out').map((c) => [c.name, c.outflow])).toEqual([['SYSCO', 400]]);
    expect(topCounterparties(txns, {}, 'in')[0]).toMatchObject({ name: 'SQUARE', inflow: 1900, countIn: 2 });
  });
  it('monthly totals keep transfers separate and counted once', () => {
    expect(monthlyTotals(txns, {})).toEqual([
      { month: '2026-01', inflow: 900, outflow: 400, net: 500, transfers: 0, count: 3 },
      { month: '2026-02', inflow: 1000, outflow: 0, net: 1000, transfers: 50, count: 3 },
    ]);
  });
  it('account totals are raw (match the statement)', () => {
    expect(accountTotals(txns).find((a) => a.account === 'A')).toMatchObject({ inflow: 1900, outflow: 450, net: 1450, count: 5 });
  });
});

describe('detectRecurring', () => {
  it('finds a monthly subscription and flags a price increase', () => {
    const t = ['2026-01-14', '2026-02-14', '2026-03-14', '2026-04-14'].map((d, i) => tx('Card', d, i === 3 ? -22 : -20, 'OPENAI'));
    const [r] = detectRecurring(t, {});
    expect(r).toMatchObject({ counterparty: 'OPENAI', direction: 'out', frequency: 'monthly', count: 4, priceIncrease: true, nextExpected: '2026-05-14' });
    expect(r.annualCost).toBe(240);
  });
  it('finds weekly supplier orders', () => {
    const t = [0, 7, 14, 21, 28].map((d) => tx('Biz', new Date(Date.UTC(2026, 0, 6 + d)).toISOString().slice(0, 10), -1500 - d, 'SYSCO'));
    expect(detectRecurring(t, {})[0]).toMatchObject({ frequency: 'weekly', count: 5 });
  });
  it('ignores irregular spending', () => {
    const t = ['2026-01-01', '2026-01-03', '2026-02-20', '2026-03-01'].map((d) => tx('Card', d, -40, 'SHELL'));
    expect(detectRecurring(t, {})).toEqual([]);
  });
  it('ignores wildly varying amounts', () => {
    const t = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'].map((d, i) => tx('Card', d, -[10, 200, 35, 500][i], 'AMAZON'));
    expect(detectRecurring(t, {})).toEqual([]);
  });
});

describe('nextDate', () => {
  it('is calendar aware', () => {
    expect(nextDate('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(nextDate('2026-11-15', 'quarterly')).toBe('2027-02-15');
    expect(nextDate('2026-03-01', 'yearly')).toBe('2027-03-01');
    expect(nextDate('2026-12-29', 'weekly')).toBe('2027-01-05');
  });
});

describe('findDuplicates', () => {
  it('flags same-day and near (≤2 days) repeats', () => {
    const t = [
      tx('Card', '2026-09-19', -64.37, 'TARGET'),
      tx('Card', '2026-09-19', -64.37, 'TARGET'),
      tx('Biz', '2026-09-22', -1876.4, 'SYSCO'),
      tx('Biz', '2026-09-23', -1876.4, 'SYSCO'),
      tx('Biz', '2026-09-30', -1876.4, 'SYSCO'),
      tx('Card', '2026-09-19', -64.37, 'COSTCO'),
    ];
    const d = findDuplicates(t, {});
    expect(d.map((g) => [g.kind, g.counterparty, g.transactions.length])).toEqual([
      ['exact', 'TARGET', 2],
      ['near', 'SYSCO', 2],
    ]);
  });
});

describe('export', () => {
  it('neutralizes spreadsheet formulas and quotes', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('A, B')).toBe('"A, B"');
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell('-58005.71')).toBe('-58005.71'); // plain negative numbers stay numeric
    expect(csvCell('-1+2')).toBe("'-1+2");
  });
  it('summary csv has one row per counterparty', () => {
    const csv = summaryCsv([tx('A', '2026-01-01', -5, 'X'), tx('A', '2026-01-02', 7, 'X')], {});
    expect(csv.trim().split('\r\n')).toEqual([
      'counterparty,accounts,count_in,total_in,count_out,total_out,net,first_date,last_date',
      'X,A,1,7.00,1,5.00,2.00,2026-01-01,2026-01-02',
    ]);
  });
});

describe('sample files (end-to-end)', () => {
  const dir = path.resolve(__dirname, '../../samples');
  const load = (file: string, account: string, opts: { hasHeader?: boolean; invert?: boolean; patch?: object } = {}) => {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const p = parseCsvText(text, opts.hasHeader ?? true);
    const m = { ...guessMapping(p.headers, opts.hasHeader ?? true, p.rows), invert: !!opts.invert, ...opts.patch };
    const r = applyMapping(p, m, account, file);
    expect(r.errors).toEqual([]);
    return { txns: r.transactions, rows: p.rows };
  };

  const chk = load('personal-checking.csv', 'Personal Checking');
  const card = load('credit-card.csv', 'Credit Card', { invert: true });
  const biz = load('business-checking.csv', 'Business Checking');
  const sav = load('savings-noheader.csv', 'Savings', { hasHeader: false });
  const all = [...chk.txns, ...card.txns, ...biz.txns, ...sav.txns];

  it('imports every row', () => {
    expect(chk.txns).toHaveLength(chk.rows.length);
    expect(card.txns).toHaveLength(card.rows.length);
    expect(biz.txns).toHaveLength(biz.rows.length);
    expect(sav.txns).toHaveLength(6);
  });

  it('checking net change matches the Balance column', () => {
    const first = chk.rows[0];
    const last = chk.rows[chk.rows.length - 1];
    const opening = Number(first[5]) - Number(first[3]);
    const net = accountTotals(chk.txns)[0].net;
    expect(opening + net).toBeCloseTo(Number(last[5]), 2);
  });

  it('graph conserves money once transfers are aliased to accounts', () => {
    const aliases = {
      'TRANSFER CHK 4411': 'Business Checking',
      'TRANSFER CHK 9021': 'Personal Checking', // from biz and savings side
      'TRANSFER SAV 7788': 'Savings',
      'AMEX EPAYMENT ACH PMT': 'Credit Card',
      'CARD PAYMENT RECEIVED': 'Personal Checking',
    };
    const g = buildGraph(all, aliases, ALL);
    // 3 owner draws + 3 savings transfers + 3 card payments are mirrored (counted once)
    expect(g.mirroredTransferIds).toHaveLength(9);
    const rawAbs = all.reduce((s, t) => s + Math.abs(t.amount), 0);
    const mirroredAbs = all.filter((t) => g.mirroredTransferIds.includes(t.id)).reduce((s, t) => s + t.amount, 0);
    const edgeSum = g.edges.reduce((s, e) => s + e.total, 0);
    expect(edgeSum).toBeCloseTo(rawAbs - mirroredAbs, 1);
    const e = g.edges.find((x) => x.source === accountNodeId('Business Checking') && x.target === accountNodeId('Personal Checking'));
    expect(e).toMatchObject({ count: 3, total: 4500 });
  });

  it('detects the planted subscriptions, double charge and Sysco near-duplicate', () => {
    const rec = detectRecurring(all, {}).map((r) => `${r.counterparty}:${r.frequency}`);
    expect(rec).toEqual(expect.arrayContaining(['NETFLIX:monthly', 'SPOTIFY:monthly', 'OPENAI:monthly', 'STATE FARM:monthly', 'GUSTO:biweekly']));
    expect(detectRecurring(all, {}).find((r) => r.counterparty === 'GUSTO' && r.account === 'Personal Checking')?.direction).toBe('in');
    expect(detectRecurring(all, {}).find((r) => r.counterparty === 'OPENAI')?.priceIncrease).toBe(true);
    const dups = findDuplicates(all, {});
    expect(dups.find((d) => d.counterparty === 'TARGET')?.kind).toBe('exact');
    expect(dups.find((d) => d.counterparty === 'SYSCO')).toMatchObject({ kind: 'near', account: 'Business Checking' });
  });
});
