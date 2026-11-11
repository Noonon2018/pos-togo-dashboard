import { doorDashStatement, isDoorDashStatement, parseDoorDashPayouts } from './doordash';
import { applyMapping, guessMapping } from './csv';
import { categorize } from './categories';
import type { Transaction } from './types';

// Text lines in the shape pdf.js extracts from a DoorDash Merchant Statement (fictional numbers)
const LINES = [
  'Page 2 of 4',
  'Payouts',
  'Payout #500000001',
  'Deposit Initiated Mar 12, 2026',
  'Transaction Dates Mar 02, 2026- Mar 08, 2026',
  'Bank Account XXXXX9999',
  'Subtotal $1,000.00 Tax (merchant fees) $0.00',
  'Tax (subtotal) $82.50 Marketing fees -$120.00',
  'Staff tips $10.00 Customer discounts funded by you -$50.00',
  'Customer fees $0.00 Customer discounts funded by DoorDash -$20.00',
  'Tax (customer fees) $0.00 Customer discounts funded by third party $0.00',
  'Commission -$250.00 Marketing credit $20.00',
  'Tax (commission) -$5.00 Third-party contribution $0.00',
  'Merchant fees $0.00 Error charges -$12.50',
  'Adjustments $0.00',
  'Net payout $655.00',
  'Payout #500000002',
  'Deposit Initiated Mar 19, 2026',
  'Transaction Dates Mar 09, 2026- Mar 15, 2026',
  'Bank Account XXXXX9999',
  'Subtotal $400.00 Tax (merchant fees) $0.00',
  'Tax (subtotal) $33.00 Marketing fees $0.00',
  'Commission -$100.00 Marketing credit $0.00',
  'Net payout $333.00',
  'This statement is provided by DoorDash, Inc. for information purposes only.',
];

describe('DoorDash merchant statement', () => {
  it('is recognised', () => {
    expect(isDoorDashStatement(LINES.join('\n'))).toBe(true);
    expect(isDoorDashStatement('Chase\nBeginning Balance $1.00')).toBe(false);
  });

  it('splits each payout into sales, tax and what DoorDash kept', () => {
    const [p] = parseDoorDashPayouts(LINES);
    expect(p).toMatchObject({ id: '500000001', deposit: '2026-03-12', salesFrom: '2026-03-02', salesTo: '2026-03-08', bank: '9999', net: 655 });
    expect(p.parts).toEqual([
      { label: 'Delivery app sales', amount: 1010 },
      { label: 'Sales tax collected (to remit)', amount: 82.5 },
      { label: 'App commission', amount: -255 },
      { label: 'App marketing fees', amount: -120 },
      { label: 'Discounts you funded', amount: -50 },
      { label: 'Error charges and adjustments', amount: -12.5 },
    ]); // DoorDash-funded discount −20 and marketing credit +20 cancel out
  });

  it('every payout nets to zero after the bank transfer (the reconciliation check)', () => {
    const r = doorDashStatement(LINES)!;
    expect(r.reconcileDiff).toBe(0);
    expect(r.balanceMismatches).toBe(0);
    expect(r.doordash).toEqual({ payouts: 2, net: 988 });
    expect(r.parsed.rows.at(-1)).toEqual(['2026-03-19', 'Payout to bank ...9999 #500000002', '-333.00', '0.00']);
  });

  it('flags a payout whose parts do not add up', () => {
    const r = doorDashStatement(LINES.map((l) => (l === 'Net payout $333.00' ? 'Net payout $300.00' : l)))!;
    expect(r.balanceMismatches).toBe(1);
  });

  it('a payout printed in two monthly statements is kept once', () => {
    expect(parseDoorDashPayouts([...LINES, ...LINES]).length).toBe(2);
  });

  it('categories: sales, sales tax, delivery-app fees, payout = transfer; bank DOORDASH deposit = same money', () => {
    const r = doorDashStatement(LINES)!;
    const dd = applyMapping(r.parsed, guessMapping(r.parsed.headers, true, r.parsed.rows), 'DoorDash', 'dd.pdf').transactions;
    const bank: Transaction = { id: 'b1', account: 'Business Checking', date: '2026-03-13', amount: 655, description: 'DOORDASH, INC. DES:PAYMENTS ID:ST-X1Y2', counterparty: 'DOORDASH', source: 'bank.csv' };
    const cats = categorize([...dd, bank], {}, {});
    const by = (n: string) => cats.filter((c) => c.name === n).map((c) => c.category);
    expect(by('DELIVERY APP SALES')).toEqual(['deposit', 'deposit']);
    expect(by('SALES TAX COLLECTED TO REMIT')).toEqual(['sales_tax', 'sales_tax']);
    expect(by('APP COMMISSION')).toEqual(['delivery_fees', 'delivery_fees']);
    expect(by('PAYOUT TO BANK')).toEqual(['transfer', 'transfer']);
    expect(cats.find((c) => c.id === 'b1')!.category).toBe('transfer'); // not income a second time
  });
});
