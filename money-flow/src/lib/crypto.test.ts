import fs from 'node:fs';
import path from 'node:path';
import { applyMapping, findHeaderRow, guessMapping, looksLikeHeader, parseAmount, parseCsvText, parseDate, shortAddress, unitFromAddresses } from './csv';
import { accountNodeId, buildGraph, cpNodeId } from './aggregate';
import { DEFAULT_FILTERS, type Filters, type Transaction } from './types';

const ALL: Filters = { ...DEFAULT_FILTERS, topN: 0 };
const ME = '0x1111111111111111111111111111111111111111';
const FRIEND = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHOP = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const EXCH = '0xcccccccccccccccccccccccccccccccccccccccc';
const MIX = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

const load = (file: string) => {
  const text = fs.readFileSync(path.resolve(__dirname, '../../samples', file), 'utf8');
  const skip = findHeaderRow(text);
  const p = parseCsvText(text, true, skip);
  const m = { ...guessMapping(p.headers, true, p.rows), skipRows: skip };
  return { m, r: applyMapping(p, m, 'ignored', file) };
};

describe('helpers', () => {
  it('parses scientific notation and unix timestamps', () => {
    expect(parseAmount('1.2E-05')).toBeCloseTo(0.000012, 10);
    expect(parseDate('1786096800')).toBe('2026-08-07');
  });
  it('shortens addresses and guesses the coin', () => {
    expect(shortAddress(ME)).toBe('0x1111…1111');
    expect(shortAddress('SOMCHAI K')).toBe('SOMCHAI K');
    expect(unitFromAddresses([ME, EXCH])).toBe('ETH');
    expect(unitFromAddresses(['bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'])).toBe('BTC');
    expect(unitFromAddresses(['hello'])).toBe('COIN');
  });
});

describe('Etherscan-style export of my wallet', () => {
  const { m, r } = load('crypto-my-wallet.csv');

  it('header with digits ("CurrentValue @ $3000/Eth") is still a header', () => {
    const text = fs.readFileSync(path.resolve(__dirname, '../../samples/crypto-my-wallet.csv'), 'utf8');
    expect(looksLikeHeader(parseCsvText(text, true).headers)).toBe(true);
  });

  it('is recognized as a crypto file', () => {
    expect(m).toMatchObject({
      flow: 'fromTo',
      crypto: true,
      unit: 'ETH',
      amountMode: 'debitCredit',
      credit: 'Value_IN(ETH)',
      debit: 'Value_OUT(ETH)',
      date: 'DateTime (UTC)',
      me: ME,
      statusCol: 'Status',
      hashCol: 'Transaction Hash',
      description: 'Method',
    });
  });

  it('keeps coins out of dollar money and skips failed / zero-value rows', () => {
    expect(r.transactions).toEqual([]); // never income/spending in the summary
    expect(r.links.map((l) => [l.date, l.link!.from, l.link!.to, -l.amount, l.unit])).toEqual([
      ['2026-08-01', EXCH, ME, 2.5, 'ETH'],
      ['2026-08-03', ME, FRIEND, 0.8, 'ETH'],
      ['2026-08-10', ME, SHOP, 0.15, 'ETH'],
      ['2026-09-02', FRIEND, ME, 0.2, 'ETH'],
      ['2026-09-15', ME, EXCH, 1, 'ETH'],
    ]);
    expect(r.errors.map((e) => e.reason)).toEqual(['Failed transaction (no money moved)']);
    expect(r.links.every((l) => l.account === ME)).toBe(true); // my wallet is marked
  });
});

describe('Blockscout-style token export', () => {
  const { m, r } = load('crypto-tokens.csv');
  it('reads unix time, From/ToAddress and a symbol per row', () => {
    expect(m).toMatchObject({ crypto: true, from: 'FromAddress', to: 'ToAddress', unitCol: 'TokenSymbol', amount: 'TokensTransferred', date: 'UnixTimestamp', me: ME });
    expect(r.links.map((l) => [l.date, -l.amount, l.unit])).toEqual([
      ['2026-08-07', 500, 'USDC'],
      ['2026-08-14', 120.5, 'USDC'],
      ['2026-09-15', 50, 'USDC'],
    ]);
  });
});

describe('following the money across two wallets', () => {
  const mine = load('crypto-my-wallet.csv').r.links;
  const friend = load('crypto-friend-wallet.csv').r.links;
  const tokens = load('crypto-tokens.csv').r.links;
  // the app de-duplicates by id when files are imported: the shared transaction appears once
  const merged: Transaction[] = [];
  const seen = new Set<string>();
  for (const l of [...mine, ...friend, ...tokens]) if (!seen.has(l.id)) (seen.add(l.id), merged.push(l));

  it('counts a transaction seen in both wallets once', () => {
    expect(mine.length + friend.length - merged.filter((l) => l.unit === 'ETH').length).toBe(2);
  });

  it('builds a two-hop network: me -> friend -> mixer, and both pay the same shop', () => {
    const g = buildGraph([], {}, ALL, merged);
    const e = (a: string, b: string, unit: string) => g.edges.find((x) => x.source === a && x.target === b && x.unit === unit);
    expect(e(accountNodeId(ME), accountNodeId(FRIEND), 'ETH')).toMatchObject({ count: 1, total: 0.8 });
    expect(e(accountNodeId(FRIEND), cpNodeId(MIX), 'ETH')).toMatchObject({ total: 0.75 });
    expect(e(accountNodeId(ME), cpNodeId(SHOP), 'ETH')).toMatchObject({ total: 0.15 });
    expect(e(accountNodeId(FRIEND), cpNodeId(SHOP), 'ETH')).toMatchObject({ total: 0.1 });
    expect(e(accountNodeId(ME), cpNodeId(SHOP), 'USDC')).toMatchObject({ total: 120.5 }); // separate edge per coin
    expect(g.nodes.find((n) => n.id === cpNodeId(SHOP))?.unit).toBe('MIXED'); // ETH + USDC never summed
    expect(g.nodes.find((n) => n.id === cpNodeId(MIX))).toMatchObject({ unit: 'ETH', totalIn: 0.75 });
  });

  it('crypto never mixes with dollar edges', () => {
    const bank: Transaction = { id: 'b1', account: 'Chase', date: '2026-08-01', amount: -3000, counterparty: 'COINBASE', description: '', source: '' };
    const g = buildGraph([bank], {}, ALL, merged);
    expect(g.edges.find((x) => x.target === cpNodeId('COINBASE'))).toMatchObject({ total: 3000 });
    expect(g.edges.find((x) => x.target === cpNodeId('COINBASE'))?.unit).toBeUndefined();
  });

  it('renaming my wallet keeps it connected', () => {
    const g = buildGraph([], { [ME]: 'My MetaMask' }, ALL, merged);
    expect(g.nodes.find((n) => n.id === accountNodeId(ME))?.label).toBe('My MetaMask');
    expect(g.edges.some((x) => x.source === accountNodeId(ME) && x.target === accountNodeId(FRIEND))).toBe(true);
  });
});
