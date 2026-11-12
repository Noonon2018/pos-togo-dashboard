import fs from 'node:fs';
import path from 'node:path';
import { applyMapping, detectMe, findHeaderRow, guessMapping, looksLikeHeader, parseCsvText } from './csv';
import { accountNodeId, buildGraph, cpNodeId } from './aggregate';
import { DEFAULT_FILTERS, type Filters } from './types';

const ALL: Filters = { ...DEFAULT_FILTERS, topN: 0 };
const sample = (f: string) => fs.readFileSync(path.resolve(__dirname, '../../samples', f), 'utf8');
const load = (text: string, account: string, me?: string) => {
  const skip = findHeaderRow(text);
  const p = parseCsvText(text, true, skip);
  const m = { ...guessMapping(p.headers, true, p.rows), skipRows: skip, ...(me !== undefined ? { me } : {}) };
  return { m, r: applyMapping(p, m, account, 'test.csv') };
};

describe('findHeaderRow', () => {
  it('skips the title lines of a Venmo statement', () => {
    expect(findHeaderRow(sample('venmo-sample.csv'))).toBe(2);
  });
  it('is 0 for normal files', () => {
    expect(findHeaderRow('Date,Description,Amount\n01/02/2026,X,-1\n')).toBe(0);
    expect(findHeaderRow(sample('links-sample.csv'))).toBe(0);
  });
});

describe('Venmo (from → to, with my name)', () => {
  const { m, r } = load(sample('venmo-sample.csv'), 'Venmo');

  it('detects the columns and my name', () => {
    expect(m).toMatchObject({ flow: 'fromTo', from: 'From', to: 'To', amount: 'Amount (total)', date: 'Datetime', description: 'Note', me: 'JANE DOE' });
  });

  it('turns my rows into money in/out of the Venmo account', () => {
    expect(r.transactions.map((t) => [t.date, t.counterparty, t.amount])).toEqual([
      ['2026-08-03', 'SOMCHAI K', -32.5],
      ['2026-08-09', 'NARIN PROPERTY MGMT', -650],
      ['2026-08-15', 'PRANEE S', 85], // a "charge": Jane is From, but the + sign says money came in
      ['2026-08-20', 'SOMCHAI K', 18],
      ['2026-09-03', 'SOMCHAI K', -28.75],
      ['2026-09-09', 'NARIN PROPERTY MGMT', -650],
      ['2026-10-03', 'SOMCHAI K', -31.2],
      ['2026-10-09', 'NARIN PROPERTY MGMT', -650],
      ['2026-10-18', 'PRANEE S', 40],
    ]);
    expect(r.links).toEqual([]);
    expect(r.transactions.every((t) => t.account === 'Venmo')).toBe(true);
  });

  it('skips balance and footer lines but reports them', () => {
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors.every((e) => e.row > 3)).toBe(true);
  });
});

describe('own Excel in Thai (from → to, nobody is me)', () => {
  const { m, r } = load(sample('links-sample.csv'), 'Links', '');

  it('does not guess a "me" when one person is on many but not all rows', () => {
    // ALICE LEE is on 5 of 8 rows; treating her as "me" would count her money as mine
    expect(load(sample('links-sample.csv'), 'Links').m.me).toBe('');
  });

  it('reads Thai headers', () => {
    expect(m).toMatchObject({ flow: 'fromTo', from: 'จาก', to: 'ไป', amount: 'จำนวนเงิน', date: 'วันที่', description: 'หมายเหตุ' });
  });

  it('every row becomes a graph-only link', () => {
    expect(r.transactions).toEqual([]);
    expect(r.links).toHaveLength(8);
    expect(r.links[0]).toMatchObject({ date: '2026-08-02', amount: -1500, link: { from: 'BOB SMITH', to: 'ALICE LEE' } });
  });

  it('a chain A → B → C shows up as a network, and my account joins it', () => {
    const g = buildGraph([{ id: 'x', account: 'Personal Checking', date: '2026-08-01', amount: -5, counterparty: 'NETFLIX', description: '', source: '' }], {}, ALL, r.links);
    const e = (a: string, b: string) => g.edges.find((x) => x.source === a && x.target === b);
    expect(e(cpNodeId('BOB SMITH'), cpNodeId('ALICE LEE'))).toMatchObject({ count: 2, total: 3000 });
    expect(e(cpNodeId('ALICE LEE'), cpNodeId('CHARLIE KIM'))).toMatchObject({ count: 2, total: 2500 });
    // "PERSONAL CHECKING" in the file matches my account name -> drawn as my account box
    expect(e(cpNodeId('CHARLIE KIM'), accountNodeId('Personal Checking'))).toMatchObject({ total: 1000 });
    expect(e(accountNodeId('Personal Checking'), cpNodeId('ALICE LEE'))).toMatchObject({ total: 300 });
    expect(g.nodes.find((n) => n.id === cpNodeId('ALICE LEE'))).toMatchObject({ totalIn: 3300, totalOut: 2500 });
  });

  it('aliases and date filters apply to links', () => {
    const g = buildGraph([], { 'DAO MARKET LLC': 'Dao Market' }, { ...ALL, from: '2026-08-21' }, r.links);
    // no bank account loaded here, so "PERSONAL CHECKING" is just another party
    expect(g.nodes.map((n) => n.label).sort()).toEqual(['ALICE LEE', 'BOB SMITH', 'CHARLIE KIM', 'Dao Market', 'PERSONAL CHECKING'].sort());
    expect(g.edges.reduce((s, x) => s + x.count, 0)).toBe(4);
  });

  it('topN groups small parties into OTHER without self-loops', () => {
    const g = buildGraph([], {}, { ...ALL, topN: 1 }, r.links);
    expect(g.edges.every((x) => x.source !== x.target)).toBe(true);
  });
});

describe('detectMe', () => {
  it('needs the name on most rows', () => {
    const p = parseCsvText('From,To,Amount\nA,B,1\nC,D,2\nE,F,3\n', true);
    expect(detectMe(p, 'From', 'To')).toBeNull();
  });
  it('generic headers with my email', () => {
    const p = parseCsvText('Date,Sender,Recipient,Amount\n2026-01-01,me@x.com,shop@y.com,10\n2026-01-02,pal@z.com,me@x.com,5\n', true);
    const m = guessMapping(p.headers, true, p.rows);
    expect(m).toMatchObject({ flow: 'fromTo', from: 'Sender', to: 'Recipient', me: 'ME@X.COM' });
    const r = applyMapping(p, m, 'PayPal', 'p.csv');
    expect(r.transactions.map((t) => [t.counterparty, t.amount])).toEqual([
      ['SHOP@Y.COM', -10],
      ['PAL@Z.COM', 5],
    ]);
  });
});

describe('looksLikeHeader', () => {
  it('ignores empty header cells (Venmo starts with one) but rejects data rows', () => {
    const v = sample('venmo-sample.csv');
    expect(looksLikeHeader(parseCsvText(v, true, findHeaderRow(v)).headers)).toBe(true);
    expect(looksLikeHeader(['Date', 'Description', 'Amount'])).toBe(true);
    expect(looksLikeHeader(['08/21/2026', '300.00', '*', 'Column 4', 'ONLINE TRANSFER'])).toBe(false);
    expect(looksLikeHeader(['Column 1', 'Column 2'])).toBe(false);
  });
});
