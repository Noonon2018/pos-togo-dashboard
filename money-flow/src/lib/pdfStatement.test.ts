import { parseStatementLines, statementInfo } from './pdfStatement';
import { applyMapping, guessMapping } from './csv';

// Synthetic text in the shape pdf.js extracts from a Chase checking statement (fake data).
const CHASE = [
  'CHASE',
  'December 20, 2025 through January 19, 2026',
  'Account Number: 000000123454321',
  'JANE DOE',
  'CHECKING SUMMARY Chase Total Checking',
  'Beginning Balance $1,000.00',
  'Deposits and Additions 2,100.00',
  'ATM & Debit Card Withdrawals -360.50',
  'Ending Balance $2,739.50',
  'TRANSACTION DETAIL',
  'DATE DESCRIPTION AMOUNT BALANCE',
  'Beginning Balance $1,000.00',
  '12/22 Card Purchase 12/21 Doordash*12/20-2 Orde 855-431-0459 CA Card -40.25 959.75',
  '1368',
  '12/29 Remote Online Deposit 1 2,000.00 2,959.75',
  '12/31 Recurring Card Purchase 12/31 Google *Claude By An G.CO/Helppay# CA',
  'Card 1368',
  '-20.00 2,939.75', // amount printed on the wrapped line
  'Page 1 of 3',
  'CHASE',
  'December 20, 2025 through January 19, 2026',
  'Account Number: 000000123454321',
  'TRANSACTION DETAIL (continued)',
  'DATE DESCRIPTION AMOUNT BALANCE',
  '01/02 Zelle Payment From Somchai Jaidee Bacf23Jnupvj 100.00 3,039.75',
  '01/05 ATM Withdrawal 01/05 13070 Bellaire Blvd Houston TX Card 1368 -300.00 2,739.75',
  '01/06 Card Purchase 01/05 Express Food Mart Houston TX Card 1368 - 0.25 2,739.50', // sign split off by pdf.js
  'Ending Balance $2,739.50',
  'IN CASE OF ERRORS OR QUESTIONS ABOUT YOUR ELECTRONIC FUNDS TRANSFERS:',
  'Call us at 1-866-564-2262 or write us 01/02 nonsense 12.00',
];

describe('statementInfo', () => {
  it('reads bank, period, last 4 and balances', () => {
    expect(statementInfo(CHASE.join('\n'))).toEqual({
      bank: 'Chase',
      last4: '4321',
      product: 'Chase Total Checking',
      periodStart: '2025-12-20',
      periodEnd: '2026-01-19',
      beginning: 1000,
      ending: 2739.5,
    });
  });
});

describe('parseStatementLines', () => {
  const r = parseStatementLines(CHASE);

  it('extracts every transaction, joining wrapped lines', () => {
    expect(r.parsed.rows).toEqual([
      ['2025-12-22', 'Card Purchase 12/21 Doordash*12/20-2 Orde 855-431-0459 CA Card 1368', '-40.25', '959.75'],
      ['2025-12-29', 'Remote Online Deposit 1', '2000.00', '2959.75'],
      ['2025-12-31', 'Recurring Card Purchase 12/31 Google *Claude By An G.CO/Helppay# CA Card 1368', '-20.00', '2939.75'],
      ['2026-01-02', 'Zelle Payment From Somchai Jaidee Bacf23Jnupvj', '100.00', '3039.75'],
      ['2026-01-05', 'ATM Withdrawal 01/05 13070 Bellaire Blvd Houston TX Card 1368', '-300.00', '2739.75'],
      ['2026-01-06', 'Card Purchase 01/05 Express Food Mart Houston TX Card 1368', '-0.25', '2739.50'],
    ]);
  });

  it('reconciles against beginning/ending balance and the running balance', () => {
    expect(r.reconcileDiff).toBe(0);
    expect(r.balanceMismatches).toBe(0);
    expect(r.hasBalance).toBe(true);
    expect(r.suggestedAccount).toBe('Chase Total Checking …4321');
  });

  it('fixes signs from the balance column when the "-" is missing', () => {
    const lines = ['Beginning Balance $100.00', '03/01 Store A 10.00 90.00', '03/02 Refund 5.00 95.00', 'Ending Balance $95.00'];
    const x = parseStatementLines(lines, 2026);
    expect(x.parsed.rows.map((row) => row[2])).toEqual(['-10.00', '5.00']);
    expect(x.reconcileDiff).toBe(0);
  });

  it('flags a statement that does not reconcile', () => {
    const lines = ['Beginning Balance $100.00', '03/01 Store A -10.00 90.00', 'Ending Balance $50.00'];
    expect(parseStatementLines(lines, 2026).reconcileDiff).toBe(40);
  });

  it('handles credit-card layout without balance column', () => {
    const lines = ['04/03 AMAZON MKTPL*AB12CD Amzn.com/bill WA 43.26', '04/10 Payment Thank You-Mobile -500.00'];
    const x = parseStatementLines(lines, 2026);
    expect(x.hasBalance).toBe(false);
    expect(x.parsed.rows).toEqual([
      ['2026-04-03', 'AMAZON MKTPL*AB12CD Amzn.com/bill WA', '43.26', ''],
      ['2026-04-10', 'Payment Thank You-Mobile', '-500.00', ''],
    ]);
  });

  it('feeds straight into the normal import step', () => {
    const t = applyMapping(r.parsed, guessMapping(r.parsed.headers, true, r.parsed.rows), 'Chase', 's.pdf').transactions;
    expect(t.map((x) => x.counterparty)).toEqual([
      'DOORDASH',
      'CHECK DEPOSIT (MOBILE)',
      'GOOGLE PLAY: CLAUDE BY AN',
      'SOMCHAI JAIDEE',
      'ATM CASH',
      'EXPRESS FOOD MART HOUSTON',
    ]);
    expect(t.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(1739.5, 2);
  });
});

// Synthetic lines in the shape of a Thai bank statement PDF (fictional data)
describe('Thai PDF statement', () => {
  const TH = [
    'ธนาคารกสิกรไทย',
    'รายการเดินบัญชี เลขที่บัญชี xxx-x-x5432-x',
    'ชื่อบัญชี มูลนิธิช่วยสัตว์ ตัวอย่าง',
    'วันที่ เวลา รายการ ถอนเงิน/ฝากเงิน ยอดคงเหลือ',
    'ยอดยกมา 100,000.00',
    '05/03/2567 10:15 รับโอนเงินพร้อมเพย์ จาก นาย ผู้บริจาค 001 5,000.00 105,000.00',
    '05/03/2567 14:20 โอนเงินไปยัง KTB x1111 นาย ประธาน เอ 30,000.00 75,000.00',
    '06 มี.ค. 67 09:00 ชำระค่าสินค้าและบริการ คลินิกรักษาสัตว์ สุขใจ 12,500.50 62,499.50',
    'ยอดยกไป 62,499.50',
    'หน้า 1/1',
  ];
  const r = parseStatementLines(TH, 2026);

  it('reads day-first Buddhist-Era dates, Thai month names, and fixes signs from the balance', () => {
    expect(r.parsed.rows).toEqual([
      ['2024-03-05', 'รับโอนเงินพร้อมเพย์ จาก นาย ผู้บริจาค 001', '5000.00', '105000.00'],
      ['2024-03-05', 'โอนเงินไปยัง KTB x1111 นาย ประธาน เอ', '-30000.00', '75000.00'],
      ['2024-03-06', 'ชำระค่าสินค้าและบริการ คลินิกรักษาสัตว์ สุขใจ', '-12500.50', '62499.50'],
    ]);
  });
  it('reconciles with ยอดยกมา / ยอดยกไป and names the bank account', () => {
    expect(r.info).toMatchObject({ bank: 'KBank', last4: '5432', beginning: 100000, ending: 62499.5 });
    expect(r.reconcileDiff).toBe(0);
    expect(r.balanceMismatches).toBe(0);
    expect(r.suggestedAccount).toBe('KBank …5432');
  });
  it('without an opening balance, signs come from the previous balance', () => {
    const x = parseStatementLines(TH.filter((l) => !l.startsWith('ยอดยกมา')), 2026);
    expect(x.parsed.rows.map((row) => row[2])).toEqual(['5000.00', '-30000.00', '-12500.50']);
  });
});
