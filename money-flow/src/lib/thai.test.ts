import fs from 'node:fs';
import path from 'node:path';
import { applyMapping, findHeaderRow, guessMapping, parseCsvText } from './csv';
import { categorize } from './categories';
import { insights, summarize } from './summary';
import { isAddressBookCsv, parseAddressBook } from './addressBook';
import { computeRoles } from './roles';
import { traceFrom } from './trace';
import { buildGraph, counterpartyName, cpNodeId } from './aggregate';
import { DEFAULT_FILTERS, type Transaction } from './types';

// Fictional foundation case (all names invented) — samples/th
const read = (f: string) => fs.readFileSync(path.resolve(__dirname, '../../samples/th', f), 'utf8');
const load = (f: string, account: string) => {
  const t = read(f);
  const k = findHeaderRow(t);
  const p = parseCsvText(t, true, k);
  const m = { ...guessMapping(p.headers, true, p.rows), skipRows: k };
  return { m, r: applyMapping(p, m, account, f), rows: p.rows };
};
const FOUNDATION = 'มูลนิธิ A';
const bank = load('foundation-A-bank.csv', FOUNDATION);
const ledger = load('investigation-ledger.csv', 'ledger');
const book = parseAddressBook(read('address-book-th.csv'));
const traceLinks: Transaction[] = [
  ...ledger.r.links,
  ...bank.r.transactions.map((x) => ({
    ...x,
    account: '',
    link: x.amount < 0 ? { from: x.account, to: counterpartyName(x, {}) } : { from: counterpartyName(x, {}), to: x.account },
  })),
];

describe('Thai bank statement', () => {
  it('detects Thai columns, day-first Buddhist-Era dates and the time column', () => {
    expect(bank.m).toMatchObject({ date: 'วันที่', description: 'รายละเอียด', amountMode: 'debitCredit', debit: 'ถอนเงิน', credit: 'ฝากเงิน', dateFormat: 'DMY', timeCol: 'เวลา' });
    expect(bank.r.errors).toEqual([]);
    expect(bank.r.transactions).toHaveLength(bank.rows.length);
    expect(bank.r.transactions[0]).toMatchObject({ date: '2024-01-01', time: '2024-01-01T08:15:00Z', amount: -16000, counterparty: 'เจ้าของที่ ดอยสะเก็ด' });
  });

  it('net change matches the balance column (ends at 50,000)', () => {
    const first = bank.rows[0];
    const last = bank.rows[bank.rows.length - 1];
    const num = (v: string) => Number(v.replace(/,/g, ''));
    const opening = num(first[5]) - bank.r.transactions[0].amount;
    const net = bank.r.transactions.reduce((s, t) => s + t.amount, 0);
    expect(opening + net).toBeCloseTo(num(last[5]), 2);
    expect(num(last[5])).toBe(50000);
  });

  it('flags that a big share of spending went to one person', () => {
    const ins = insights(categorize(bank.r.transactions, {}, {}), {}, 'all');
    expect(ins.find((i) => i.key === 'insTopPerson')).toMatchObject({ level: 'warn', vars: { name: 'ประธาน เอ', amt: 3_000_000, n: 7, pct: 57 } });
  });

  it('sorts the money into foundation categories', () => {
    const s = summarize(categorize(bank.r.transactions, {}, {}), 'all');
    const cat = (id: string) => s.spendCategories.find((c) => c.id === id)?.total ?? 0;
    expect(s.incomeCategories.map((c) => c.id)).toEqual(['donation']);
    expect(cat('people')).toBe(3_360_000); // 3,000,000 to the chairperson + 12 × 30,000 salary to a proxy account
    expect(cat('personal')).toBe(102_500); // beauty clinic 89,000 + collagen 3 × 4,500
    expect(cat('housing')).toBe(192_000); // shelter rent 12 × 16,000
    expect(cat('cash')).toBe(80_000);
    expect(cat('animal_care')).toBeGreaterThan(0);
    expect(cat('animal_food')).toBeGreaterThan(0);
    expect(s.spendCategories.find((c) => c.id === 'people')?.items[0]).toMatchObject({ name: 'ประธาน เอ', total: 3_000_000, count: 7 });
  });
});

describe('investigation ledger (Thai from → to)', () => {
  it('reads Thai headers; nobody is "me"; times kept', () => {
    expect(ledger.m).toMatchObject({ flow: 'fromTo', from: 'จาก', to: 'ไป', amount: 'จำนวนเงิน', me: '', timeCol: 'เวลา', dateFormat: 'DMY' });
    expect(ledger.r.transactions).toEqual([]);
    expect(ledger.r.links[0]).toMatchObject({ date: '2024-02-12', time: '2024-02-12T11:05:00Z', link: { from: 'ประธาน เอ', to: 'แม่บ้าน วาย' }, amount: -150000 });
  });

  it('the address book file is recognized by its Thai headers', () => {
    expect(isAddressBookCsv(read('address-book-th.csv'))).toBe(true);
    expect(book['ประธาน เอ']).toEqual({ name: 'ประธานมูลนิธิ (สมมติ)', kind: 'person' });
  });

  it('second hop joins the bank statement: foundation → chair → maid → gold shop', () => {
    const g = buildGraph(bank.r.transactions, {}, { ...DEFAULT_FILTERS, topN: 0 }, ledger.r.links);
    const e = (a: string, b: string) => g.edges.find((x) => x.source === a && x.target === b);
    expect(e(`acct:${FOUNDATION}`, cpNodeId('ประธาน เอ'))).toMatchObject({ count: 7, total: 3_000_000 });
    expect(e(cpNodeId('ประธาน เอ'), cpNodeId('แม่บ้าน วาย'))).toMatchObject({ count: 6, total: 600_000 });
    expect(e(cpNodeId('แม่บ้าน วาย'), cpNodeId('ร้านทอง ตัวอย่าง'))).toMatchObject({ count: 2, total: 139_500 + 111_600 });
    expect(e(cpNodeId('ค. รับแทน'), cpNodeId('ผู้ก่อตั้ง บี'))).toMatchObject({ count: 12, total: 354_000 });
  });

  it('hints: the proxy account and the maid pass money on within hours; the foundation is not flagged', () => {
    const roles = computeRoles(traceLinks, book, { accounts: new Set([FOUNDATION]) });
    expect(roles.get('ค. รับแทน')).toEqual([{ id: 'passThrough', vars: { gap: '40m', in: 30000, out: 29500, unit: '$' } }]);
    expect(roles.get('แม่บ้าน วาย')?.[0]).toMatchObject({ id: 'passThrough', vars: { gap: '2h' } });
    expect(roles.get(FOUNDATION)).toBeUndefined();
  });

  it('trace from the foundation follows EVERY transfer to the chair, each to what happened next', () => {
    const hops = traceFrom(FOUNDATION, traceLinks, book);
    const first = hops.filter((h) => h.depth === 1);
    expect(first.map((h) => h.amount)).toEqual([600000, 500000, 500000]); // the three largest
    const after = (amount: number) => hops.filter((h) => h.depth === 2 && hops.indexOf(h) > hops.findIndex((x) => x.depth === 1 && x.amount === amount)).slice(0, 2);
    // Aug 9: 600,000 in at 16:00 → maid 120,000 one hour later → gold shop 2 hours after that
    expect(hops.find((h) => h.from === 'ประธาน เอ' && h.amount === 120000)).toMatchObject({ to: 'แม่บ้าน วาย', gap: '1h' });
    expect(hops.find((h) => h.from === 'แม่บ้าน วาย' && h.amount === 111600)).toMatchObject({ to: 'ร้านทอง ตัวอย่าง', gap: '2h', stop: 'noData' });
    // Oct 21: the later 500,000 is followed on its own (not cut off as "seen")
    expect(after(500000)[0]).toMatchObject({ from: 'ประธาน เอ', to: 'แม่บ้าน วาย', amount: 90000, gap: '1h' });
  });
});
