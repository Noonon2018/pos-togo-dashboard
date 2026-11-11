import fs from 'node:fs';
import path from 'node:path';
import { applyMapping, findHeaderRow, guessMapping, parseCsvText, parseDateTime } from './csv';
import { addressBookCsv, bookKey, displayName, isAddressBookCsv, kindFromName, labelsFromTags, parseAddressBook } from './addressBook';
import { computeRoles } from './roles';
import { nextToExport, traceFrom } from './trace';
import type { Transaction } from './types';

const ME = '0x1111111111111111111111111111111111111111';
const FRIEND = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHOP = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const EXCH = '0xcccccccccccccccccccccccccccccccccccccccc';
const MIX = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

const read = (f: string) => fs.readFileSync(path.resolve(__dirname, '../../samples', f), 'utf8');
const links = (f: string) => {
  const text = read(f);
  const skip = findHeaderRow(text);
  const p = parseCsvText(text, true, skip);
  return applyMapping(p, { ...guessMapping(p.headers, true, p.rows), skipRows: skip }, 'x', f).links;
};
const merged: Transaction[] = [];
{
  const seen = new Set<string>();
  for (const l of [...links('crypto-my-wallet.csv'), ...links('crypto-friend-wallet.csv'), ...links('crypto-tokens.csv')])
    if (!seen.has(l.id)) (seen.add(l.id), merged.push(l));
}
const book = parseAddressBook(read('address-book-sample.csv'));

describe('parseDateTime', () => {
  it('keeps the time when there is one', () => {
    expect(parseDateTime('2026-08-03 18:31:00')).toBe('2026-08-03T18:31:00Z');
    expect(parseDateTime('1786096800')).toBe('2026-08-07T10:00:00Z');
    expect(parseDateTime('08/03/2026')).toBeNull();
  });
  it('crypto rows carry the time', () => {
    expect(merged.find((l) => l.link!.to === MIX)?.time).toBe('2026-08-03T18:31:00Z');
  });
});

describe('address book', () => {
  it('recognizes an address-book file (and not a money file)', () => {
    expect(isAddressBookCsv(read('address-book-sample.csv'))).toBe(true);
    expect(isAddressBookCsv('ที่อยู่,ชื่อ,ประเภท\n0x1,a,b\n')).toBe(true);
    expect(isAddressBookCsv(read('crypto-my-wallet.csv'))).toBe(false);
    expect(isAddressBookCsv(read('links-sample.csv'))).toBe(false);
  });
  it('parses English/Thai types and guesses from names', () => {
    expect(book[MIX]).toEqual({ name: 'Example Mixer', kind: 'mixer' });
    expect(book[ME]).toEqual({ name: 'กระเป๋าของฉัน (ตัวอย่าง)', kind: 'mine' });
    expect(parseAddressBook('ที่อยู่,ชื่อ,ประเภท\n0xABCDEF0123456789abcdef0123456789ABCDEF01,ร้านกาแฟ,ร้าน\n')).toEqual({
      '0xabcdef0123456789abcdef0123456789abcdef01': { name: 'ร้านกาแฟ', kind: 'shop' },
    });
    expect(kindFromName('Binance 14')).toBe('exchange');
    expect(kindFromName('Tornado.Cash: Router')).toBe('mixer');
    expect(kindFromName('Uniswap V3: Router')).toBe('contract');
    expect(kindFromName('Somchai')).toBe('other');
  });
  it('round-trips through CSV and reads explorer name tags', () => {
    expect(parseAddressBook(addressBookCsv(book))).toEqual(book);
    expect(labelsFromTags({ [EXCH]: 'Coinbase 10' })).toEqual({ [EXCH]: { name: 'Coinbase 10', kind: 'exchange' } });
  });
  it('shows a label instead of the long address', () => {
    expect(displayName(MIX, book, (v) => v.slice(0, 6)).text).toBe('🌀 Example Mixer');
    expect(displayName('0x9999999999999999999999999999999999999999', book, (v) => v.slice(0, 6)).text).toBe('0x9999');
    expect(bookKey('0xABCDEF0123456789abcdef0123456789ABCDEF01')).toBe('0xabcdef0123456789abcdef0123456789abcdef01');
  });
});

describe('roles', () => {
  const roles = computeRoles(merged, book);
  it('⚡ friend passed 0.75 of 0.8 ETH on within 11 minutes', () => {
    expect(roles.get(FRIEND)).toEqual([{ id: 'passThrough', vars: { gap: '11m', in: 0.8, out: 0.75, unit: 'ETH' } }]);
  });
  it('🌀 the mixer is flagged from the address book', () => {
    expect(roles.get(MIX)?.map((r) => r.id)).toContain('mixer');
  });
  it('🏦 a hub with many counterparties looks like an exchange', () => {
    const hub = '0x5555555555555555555555555555555555555555';
    const many: Transaction[] = Array.from({ length: 14 }, (_, i) => ({
      id: `h${i}`,
      account: '',
      date: '2026-10-01',
      amount: -1,
      counterparty: hub,
      description: '',
      source: '',
      unit: 'ETH',
      link: { from: `0x${String(i).padStart(40, '7')}`, to: hub },
    }));
    expect(computeRoles(many).get(hub)?.[0]).toMatchObject({ id: 'exchangeLike', vars: { n: 14 } });
  });
  it('🆕 an address seen once in and once out, not an exported wallet', () => {
    const tmp = '0x6666666666666666666666666666666666666666';
    const t = (id: string, from: string, to: string, time: string): Transaction => ({
      id, account: '', date: time.slice(0, 10), time, amount: -1, counterparty: to, description: '', source: '', unit: 'ETH', link: { from, to },
    });
    const r = computeRoles([t('a', ME, tmp, '2026-10-01T00:00:00Z'), t('b', tmp, SHOP, '2026-10-01T02:00:00Z')]);
    expect(r.get(tmp)?.map((x) => x.id)).toEqual(['passThrough', 'oneTime']);
  });
  it('nothing is flagged without evidence', () => {
    expect(roles.get(SHOP)).toBeUndefined();
  });
});

describe('traceFrom', () => {
  it('follows my money forward in time and stops where the trail breaks', () => {
    const hops = traceFrom(ME, merged, book);
    const view = hops.map((h) => [h.depth, h.from.slice(0, 6), h.to.slice(0, 6), h.amount, h.unit, h.gap, h.stop ?? '']);
    expect(view).toEqual([
      [1, '0x1111', '0xaaaa', 0.8, 'ETH', '', ''],
      [2, '0xaaaa', '0xeeee', 0.75, 'ETH', '11m', 'mixer'], // 11 minutes later, into a mixer: trail broken on purpose
      [2, '0xaaaa', '0xbbbb', 0.1, 'ETH', '3d', 'noData'], // 61 hours later
      [2, '0xaaaa', '0x1111', 0.2, 'ETH', '30d', 'seen'], // came back to me
      [1, '0x1111', '0xbbbb', 0.15, 'ETH', '', 'noData'],
      [1, '0x1111', '0xbbbb', 120.5, 'USDC', '', 'noData'],
      [1, '0x1111', '0xaaaa', 50, 'USDC', '', 'seen'],
      [1, '0x1111', '0xcccc', 1, 'ETH', '', 'exchange'], // only the exchange / police can see further
    ]);
  });
  it('tells you which address to export next', () => {
    expect(nextToExport(traceFrom(ME, merged, book))).toEqual([SHOP]);
  });
  it('without labels, the exchange is just "no more data"', () => {
    expect(traceFrom(ME, merged, {}).find((h) => h.to === EXCH)?.stop).toBe('noData');
  });
});
