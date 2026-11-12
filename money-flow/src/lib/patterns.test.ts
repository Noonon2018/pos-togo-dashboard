import { findRoundTrips, findStructuring, mergeRoles, patternRoles } from './patterns';
import type { Transaction } from './types';

let n = 0;
const mk = (from: string, to: string, time: string, amount: number, unit?: string): Transaction => ({
  id: `t${n++}`,
  account: '',
  date: time.slice(0, 10),
  time,
  amount: -amount,
  counterparty: to,
  description: '',
  source: '',
  link: { from, to },
  ...(unit ? { unit } : {}),
});

describe('findStructuring (🧩 splitting)', () => {
  it('flags many smaller transfers between the same two parties in a few days', () => {
    const links = [50_000, 200_000, 150_000, 100_000, 180_000].map((a, i) => mk('FOUNDATION', 'TREASURER', `2024-05-0${i + 1}T10:00:00Z`, a));
    const [s] = findStructuring(links, { minTotal: 300_000 });
    expect(s).toMatchObject({ from: 'FOUNDATION', to: 'TREASURER', n: 5, days: 5, total: 680_000, max: 200_000, min: 50_000 });
  });

  it('flags repeated cash withdrawals (6 × 2,000,000 in a week)', () => {
    const links = [1, 2, 3, 4, 5, 6].map((d) => mk('CONTRACTOR M', 'ATM CASH', `2024-06-0${d}T09:00:00Z`, 2_000_000));
    expect(findStructuring(links, { minTotal: 300_000 })[0]).toMatchObject({ n: 6, total: 12_000_000 });
  });

  it('does not flag monthly bills, small amounts, one big transfer, or many different donors', () => {
    const monthly = [1, 2, 3, 4, 5, 6].map((m) => mk('ME', 'LANDLORD', `2024-0${m}-01T08:00:00Z`, 16_000));
    const small = [1, 2, 3, 4, 5].map((d) => mk('ME', 'CAFE', `2024-01-0${d}T08:00:00Z`, 20));
    const oneBig = [mk('A', 'B', '2024-01-01T00:00:00Z', 1_000_000), ...[2, 3, 4].map((d) => mk('A', 'B', `2024-01-0${d}T00:00:00Z`, 100))];
    const donors = [1, 2, 3, 4, 5, 6].map((i) => mk(`DONOR ${i}`, 'FOUNDATION', `2024-01-0${i}T00:00:00Z`, 100_000));
    expect(findStructuring([...monthly, ...small, ...oneBig, ...donors], { minTotal: 300_000 })).toEqual([]);
  });

  it('ignores crypto coins (amounts are not money)', () => {
    const links = [1, 2, 3, 4].map((d) => mk('0xa', '0xb', `2024-01-0${d}T00:00:00Z`, 500_000, 'USDT'));
    expect(findStructuring(links, { minTotal: 10 })).toEqual([]);
  });
});

describe('findRoundTrips (🔁 money comes back)', () => {
  it('finds A → B → C → A within the window', () => {
    const links = [
      mk('FOUNDER', 'FOUNDATION', '2024-03-01T10:00:00Z', 1_000_000),
      mk('FOUNDATION', 'CONTRACTOR A', '2024-03-05T10:00:00Z', 900_000),
      mk('CONTRACTOR A', 'FOUNDER', '2024-03-05T15:00:00Z', 850_000),
    ];
    const r = findRoundTrips(links);
    // only the founder: the founder paid the foundation BEFORE the contractor paid the founder
    expect(r.map((x) => [x.party, x.path.join(' → '), x.out, x.back, x.days])).toEqual([['FOUNDER', 'FOUNDATION → CONTRACTOR A', 1_000_000, 850_000, 5]]);
  });

  it('ignores refunds (A → shop → A), money that comes back too late, or out of time order', () => {
    const links = [
      mk('ME', 'SHOP', '2024-01-01T10:00:00Z', 100),
      mk('SHOP', 'ME', '2024-01-03T10:00:00Z', 100),
      mk('X', 'Y', '2024-01-01T00:00:00Z', 1000),
      mk('Y', 'Z', '2024-01-02T00:00:00Z', 1000),
      mk('Z', 'X', '2024-03-30T00:00:00Z', 1000), // 3 months later
      mk('P', 'Q', '2024-02-10T00:00:00Z', 1000),
      mk('Q', 'R', '2024-02-01T00:00:00Z', 1000), // before the money arrived at Q
      mk('R', 'P', '2024-02-11T00:00:00Z', 1000),
    ];
    expect(findRoundTrips(links)).toEqual([]);
  });

  it('stops at cash withdrawals', () => {
    const links = [
      mk('A', 'B', '2024-01-01T00:00:00Z', 1000),
      mk('B', 'ATM CASH', '2024-01-01T01:00:00Z', 1000),
      mk('ATM CASH', 'A', '2024-01-01T02:00:00Z', 1000),
    ];
    expect(findRoundTrips(links)).toEqual([]);
  });
});

describe('patternRoles', () => {
  it('puts 🧩 on both sides and 🔁 on the origin, merged without duplicates', () => {
    const links = [
      ...[1, 2, 3, 4].map((d) => mk('F', 'T', `2024-05-0${d}T10:00:00Z`, 100_000)),
      mk('T', 'C', '2024-05-06T10:00:00Z', 300_000),
      mk('C', 'F', '2024-05-07T10:00:00Z', 250_000),
    ];
    const roles = patternRoles(links, { minTotal: 300_000 });
    expect(roles.get('F')!.map((r) => r.id)).toEqual(['splitOut', 'roundTrip']);
    expect(roles.get('T')!.map((r) => r.id)).toEqual(['splitIn']); // F paid T before C paid F: no loop from T
    expect(roles.get('F')![0].vars).toMatchObject({ n: 4, total: 400_000, other: 'T' });
    const merged = mergeRoles(roles, roles);
    expect(merged.get('F')!.length).toBe(2);
  });
});

describe('cash withdrawals in pieces', () => {
  it('flags only the party that withdrew (cash is not a person)', () => {
    const links = [1, 2, 3, 4].map((d) => mk('CONTRACTOR M', 'ATM CASH', `2024-06-0${d}T09:00:00Z`, 500_000));
    const roles = patternRoles(links, { minTotal: 300_000 });
    expect(roles.get('CONTRACTOR M')!.map((r) => r.id)).toEqual(['splitCash']);
    expect(roles.has('ATM CASH')).toBe(false);
  });
});

describe('no false alarms on normal business money', () => {
  it('daily card-sale payouts (odd amounts) are not "splitting"', () => {
    const links = [1331.64, 2556.89, 1904.12, 2210.5, 1788.07, 2433.18, 2262.96].map((a, i) => mk('SQUARE (DEPOSIT)', 'Business Checking', `2024-01-0${i + 1}T06:00:00Z`, a));
    expect(findStructuring(links, { minTotal: 10_000 })).toEqual([]);
  });
  it('a loop that takes longer than the window overall, or returns little, is not a round trip', () => {
    const slow = [
      mk('A', 'B', '2024-01-01T00:00:00Z', 1500),
      mk('B', 'C', '2024-01-20T00:00:00Z', 1500),
      mk('C', 'A', '2024-02-05T00:00:00Z', 1400),
    ];
    const little = [
      mk('P', 'Q', '2024-01-01T00:00:00Z', 1000),
      mk('Q', 'R', '2024-01-02T00:00:00Z', 1000),
      mk('R', 'P', '2024-01-03T00:00:00Z', 200),
    ];
    expect(findRoundTrips([...slow, ...little])).toEqual([]);
  });
});
