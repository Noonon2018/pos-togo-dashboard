import { readFileSync } from 'fs';
import { join } from 'path';
import { zipSync, strToU8 } from 'fflate';
import { docKind, excelDate, looksLikeTransactions, readDocx, readOds, readXlsx, toCsv, xmlText } from './officeFiles';
import { applyMapping, findHeaderRow, guessMapping, parseCsvText } from './csv';

// fixtures: fictional files saved by real programs (openpyxl/Excel format, LibreOffice, python-docx)
const fx = (n: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', n)));

const EXPECT = [
  ['2026-03-02', 'TOAST DEP MAR', '1396.34', '5396.34'],
  ['2026-03-03', 'DOORDASH, INC. DES:PAYMENTS', '655', '6051.34'],
  ['2026-03-04', 'SUNS WHOLESALE CLUB #12', '-206.85', '5844.49'],
  ['2026-03-05', 'CITY OF HOUSTON WATER', '-1000', '4844.49'],
  ['2026-03-06', 'ZELLE PAYMENT TO SOMCHAI (FICTIONAL)', '-0.3', '4844.19'], // 0.1+0.2 float noise removed
];

describe('Excel .xlsx', () => {
  it('reads visible sheets, real date cells and numbers; hidden sheets are skipped', () => {
    const sheets = readXlsx(fx('bank-fictional.xlsx'));
    expect(sheets.map((s) => s.name)).toEqual(['Transactions', 'Summary']);
    expect(sheets[0].rows[0][0]).toBe('Business Checking Activity (fictional)');
    expect(sheets[0].rows.slice(3)).toEqual(EXPECT);
    expect(looksLikeTransactions(sheets[0].rows)).toBe(true);
    expect(looksLikeTransactions(sheets[1].rows)).toBe(false); // a summary is not a list of payments
  });

  it('the same workbook saved by LibreOffice reads the same', () => {
    expect(readXlsx(fx('bank-libreoffice-fictional.xlsx'))[0].rows.slice(3)).toEqual(EXPECT);
  });

  it('flows into the normal CSV import (title rows skipped, columns guessed)', () => {
    const csv = toCsv(readXlsx(fx('bank-fictional.xlsx'))[0].rows);
    const parsed = parseCsvText(csv, true, findHeaderRow(csv)); // exactly what the import window does
    const t = applyMapping(parsed, guessMapping(parsed.headers, true, parsed.rows), 'Business Checking', 'bank.xlsx').transactions;
    expect(t.map((x) => [x.date, x.amount])).toEqual(EXPECT.map((r) => [r[0], Number(r[2])]));
  });

  it('Thai export: Buddhist-era text dates and ถอน/ฝาก columns survive', () => {
    const [s] = readXlsx(fx('thai-fictional.xlsx'));
    expect(s.name).toBe('รายการเดินบัญชี');
    expect(s.rows[2]).toEqual(['05/03/2567', '14:20', 'โอนเงิน', '30000', '', '75000', 'โอนเงินไปยัง KTB x1111 นาย ประธาน เอ']);
    expect(looksLikeTransactions(s.rows)).toBe(true);
  });

  it('excel serial dates (1900 and 1904 systems, with time)', () => {
    expect(excelDate(46083, false, false)).toBe('2026-03-02');
    expect(excelDate(46083.75, false, true)).toBe('2026-03-02 18:00');
    expect(excelDate(44621, true, false)).toBe('2026-03-02');
  });

  it('refuses a zip bomb', () => {
    const huge = zipSync({ 'xl/workbook.xml': strToU8('<workbook/>'), 'xl/worksheets/sheet1.xml': new Uint8Array(160 * 1024 * 1024) });
    expect(() => readXlsx(huge)).toThrow(/too large/);
  });
});

describe('OpenDocument .ods', () => {
  it('reads the LibreOffice file the same as the Excel one', () => {
    const sheets = readOds(fx('bank-fictional.ods'));
    expect(sheets.map((s) => s.name)).toEqual(['Transactions', 'Summary', 'Hidden']);
    expect(sheets[0].rows.slice(3)).toEqual(EXPECT);
  });
  it('never expands "a million empty rows"', () => {
    const xml = `<office:document-content><table:table table:name="S"><table:table-row><table:table-cell office:value-type="string"><text:p>a</text:p></table:table-cell><table:table-cell table:number-columns-repeated="16000"/></table:table-row><table:table-row table:number-rows-repeated="1048575"><table:table-cell table:number-columns-repeated="16384"/></table:table-row></table:table></office:document-content>`;
    const sheets = readOds(zipSync({ 'content.xml': strToU8(xml) }));
    expect(sheets[0].rows).toEqual([['a']]);
  });
});

describe('Word .docx', () => {
  it('reads tables of transactions', () => {
    const { tables } = readDocx(fx('statement-table-fictional.docx'));
    expect(tables[0].rows).toEqual([
      ['Date', 'Description', 'Amount'],
      ['03/02/2026', 'TOAST DEP MAR', '1,396.34'],
      ['03/04/2026', 'SUNS WHOLESALE CLUB', '-206.85'],
      ['03/05/2026', 'CITY OF HOUSTON WATER & SEWER', '-1,000.00'],
    ]);
    expect(looksLikeTransactions(tables[0].rows)).toBe(true);
  });
  it('a memo is text, not a transaction table', () => {
    const { tables, lines } = readDocx(fx('memo-fictional.docx'));
    expect(tables).toEqual([]);
    expect(lines).toEqual(['Meeting notes: call the CPA about sales tax.', 'Total debt $3,750.32']);
  });
});

describe('helpers', () => {
  it('xml entities', () => expect(xmlText('A &amp; B &lt;3 &#3585;&#x0E02;')).toBe('A & B <3 กข'));
  it('file kinds', () => {
    expect(['a.XLSX', 'b.ods', 'c.docx', 'd.jpg', 'e.xls', 'f.csv'].map((n) => docKind(n))).toEqual(['xlsx', 'ods', 'docx', 'image', 'oldOffice', null]);
  });
});
