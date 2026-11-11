import { applyMapping, guessMapping, headerSignature, looksDayFirst, parseAmount, parseCsvText, parseDate, parseDateTime } from './csv';
import type { ColumnMapping } from './types';

describe('parseAmount', () => {
  it.each([
    ['1,234.56', 1234.56],
    ['$1,234.56', 1234.56],
    ['-$12.00', -12],
    ['$-12.00', -12],
    ['(12.50)', -12.5],
    ['12.50-', -12.5],
    ['12.50 CR', 12.5],
    ['12.50 DR', -12.5],
    ['+7', 7],
    ['.99', 0.99],
  ])('%s -> %d', (raw, n) => expect(parseAmount(raw)).toBe(n));

  it.each(['', '   ', 'abc', '1.2.3', undefined])('invalid %s -> NaN', (raw) => expect(parseAmount(raw)).toBeNaN());
});

describe('parseDate', () => {
  it('handles US, ISO and 2-digit years', () => {
    expect(parseDate('08/07/2026')).toBe('2026-08-07');
    expect(parseDate('8/7/26')).toBe('2026-08-07');
    expect(parseDate('2026-08-07')).toBe('2026-08-07');
    expect(parseDate('2026-08-07T00:00:00')).toBe('2026-08-07');
    expect(parseDate('07/08/2026', 'DMY')).toBe('2026-08-07');
  });
  it('reads Thai bank dates (day first, Buddhist Era, Thai month names)', () => {
    expect(parseDate('13/01/2026')).toBe('2026-01-13'); // first number > 12 -> day first
    expect(parseDate('05/03/2567')).toBe('2024-03-05'); // พ.ศ. 2567 = 2024, day first
    expect(parseDate('05/03/67', 'DMY')).toBe('2024-03-05');
    expect(parseDate('5 มี.ค. 67')).toBe('2024-03-05');
    expect(parseDate('5 มีนาคม 2567')).toBe('2024-03-05');
    expect(parseDate('31 ธ.ค. 2566')).toBe('2023-12-31');
    expect(looksDayFirst(['05/03/2567'])).toBe(true);
    expect(looksDayFirst(['03/05/2026', '12/01/2026'])).toBe(false);
    expect(parseDateTime('05/03/2567 14:05')).toBe('2024-03-05T14:05:00Z');
  });
  it('rejects impossible dates', () => {
    expect(parseDate('02/30/2026')).toBeNull();
    expect(parseDate('13/13/2026')).toBeNull();
    expect(parseDate('31/02/2567')).toBeNull();
    expect(parseDate('hello')).toBeNull();
    expect(parseDate('')).toBeNull();
  });
});

describe('parseCsvText', () => {
  it('reads headers, strips BOM, skips blank lines', () => {
    const p = parseCsvText('﻿Date,Description,Amount\n01/02/2026,"COFFEE, LLC",-3.50\n\n', true);
    expect(p.headers).toEqual(['Date', 'Description', 'Amount']);
    expect(p.rows).toEqual([['01/02/2026', 'COFFEE, LLC', '-3.50']]);
  });
  it('names columns when there is no header row', () => {
    const p = parseCsvText('"01/02/2026","5.00","*","","X"\n', false);
    expect(p.headers).toEqual(['Column 1', 'Column 2', 'Column 3', 'Column 4', 'Column 5']);
    expect(p.rows).toHaveLength(1);
  });
});

describe('headerSignature', () => {
  it('ignores case/spacing/punctuation', () => {
    expect(headerSignature(['Posting Date', 'Amount'])).toBe(headerSignature(['posting date ', 'AMOUNT']));
  });
});

describe('guessMapping', () => {
  it('detects signed amount (Chase style)', () => {
    const m = guessMapping(['Details', 'Posting Date', 'Description', 'Amount', 'Type', 'Balance'], true);
    expect(m).toMatchObject({ date: 'Posting Date', description: 'Description', amountMode: 'signed', amount: 'Amount' });
  });
  it('infers columns from data when there is no header (Wells Fargo style)', () => {
    const p = parseCsvText('"08/21/2026","300.00","*","","ONLINE TRANSFER FROM CHK"\n"08/31/2026","-1.84","*","","FEE"\n', false);
    expect(guessMapping(p.headers, false, p.rows)).toMatchObject({
      date: 'Column 1',
      amount: 'Column 2',
      description: 'Column 5',
      amountMode: 'signed',
    });
  });
  it('detects debit/credit columns', () => {
    const m = guessMapping(['Date', 'Description', 'Debit', 'Credit', 'Balance'], true);
    expect(m).toMatchObject({ amountMode: 'debitCredit', debit: 'Debit', credit: 'Credit' });
  });
});

describe('applyMapping', () => {
  const signed: ColumnMapping = {
    hasHeader: true,
    date: 'Date',
    description: 'Description',
    amountMode: 'signed',
    amount: 'Amount',
    invert: false,
    dateFormat: 'auto',
  };

  it('converts rows and reports bad ones with line numbers', () => {
    const p = parseCsvText('Date,Description,Amount\n01/02/2026,NETFLIX.COM,-15.49\nbad,X,1\n01/03/2026,Y,\n01/04/2026,ZERO,0\n', true);
    const r = applyMapping(p, signed, 'Checking', 'f.csv');
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0]).toMatchObject({ date: '2026-01-02', amount: -15.49, counterparty: 'NETFLIX', account: 'Checking' });
    expect(r.errors.map((e) => e.row)).toEqual([3, 4]);
  });

  it('inverts credit-card sign convention', () => {
    const p = parseCsvText('Date,Description,Amount\n01/02/2026,STORE,25.00\n01/05/2026,PAYMENT THANK YOU,-100\n', true);
    const r = applyMapping(p, { ...signed, invert: true }, 'Card', 'c.csv');
    expect(r.transactions.map((t) => t.amount)).toEqual([-25, 100]);
  });

  it('combines debit and credit columns', () => {
    const p = parseCsvText('Date,Description,Debit,Credit\n2026-01-02,SYSCO,"1,200.00",\n2026-01-03,SQUARE INC,,850.25\n', true);
    const r = applyMapping(
      p,
      { ...signed, amountMode: 'debitCredit', amount: undefined, debit: 'Debit', credit: 'Credit' },
      'Biz',
      'b.csv',
    );
    expect(r.transactions.map((t) => t.amount)).toEqual([-1200, 850.25]);
    expect(r.errors).toEqual([]);
  });

  it('gives stable ids, distinct for identical rows in one file', () => {
    const text = 'Date,Description,Amount\n01/02/2026,TARGET,-5\n01/02/2026,TARGET,-5\n';
    const a = applyMapping(parseCsvText(text, true), signed, 'Card', 'x.csv').transactions;
    const b = applyMapping(parseCsvText(text, true), signed, 'Card', 'x-copy.csv').transactions;
    expect(a[0].id).not.toBe(a[1].id);
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id)); // re-import of same data → same ids
  });

  it('fails clearly when required columns are missing', () => {
    const r = applyMapping(parseCsvText('A,B\n1,2\n', true), signed, 'X', 'x.csv');
    expect(r.transactions).toEqual([]);
    expect(r.errors[0].reason).toMatch(/required/);
  });
});
