import { fixOcrLine, lineText, wordsToLines } from './pdfOcr';

describe('wordsToLines', () => {
  it('groups words on the same row (even slightly tilted) and orders them left to right', () => {
    const w = (text: string, x0: number, y0: number) => ({ text, x0, x1: x0 + 40, y0, y1: y0 + 20 });
    expect(wordsToLines([w('-40.25', 500, 103), w('12/22', 10, 100), w('Doordash', 80, 101), w('12/29', 10, 140), w('2,000.00', 500, 141)])).toEqual([
      '12/22 Doordash -40.25',
      '12/29 2,000.00',
    ]);
  });
});

describe('fixOcrLine', () => {
  it('repairs the usual digit slips inside amounts, leaving words alone', () => {
    expect(fixOcrLine('12/22 Card Purchase Doordash -4O.25 1,2S4.56')).toBe('12/22 Card Purchase Doordash -40.25 1,254.56');
    expect(fixOcrLine('Store 1 ,234.56 9l9.75')).toBe('Store 1,234.56 919.75');
    expect(fixOcrLine('05/03/2567 โอนเงิน 30,000,00 75,000.00')).toBe('05/03/2567 โอนเงิน 30,000.00 75,000.00');
    expect(fixOcrLine('Online Transfer To Sav Ol')).toBe('Online Transfer To Sav Ol');
  });
});

describe('lineText', () => {
  it('glues Thai pieces that touch, keeps spaces at real gaps and between Latin words', () => {
    const w = (text: string, x0: number, x1: number) => ({ text, x0, x1, y0: 0, y1: 40 });
    expect(lineText([w('05/03/2567', 0, 100), w('รับ', 120, 150), w('โอน', 151, 180), w('เงิน', 182, 215), w('จาก', 260, 290), w('KTB', 300, 340), w('5,000.00', 400, 480)])).toBe(
      '05/03/2567 รับโอนเงิน จาก KTB 5,000.00',
    );
  });
});
describe('fixOcrLine noise', () => {
  it('drops specks before the date', () => {
    expect(fixOcrLine('~~ 06/03/2567 09:00 ชำระ 12,500.50')).toBe('06/03/2567 09:00 ชำระ 12,500.50');
  });
});

describe('Thai OCR repairs', () => {
  it('keeps a split-off vowel with its word, fixes sara am, Thai digits and masked account numbers', () => {
    const w = (text: string, x0: number, x1: number) => ({ text, x0, x1, y0: 0, y1: 40 });
    expect(lineText([w('ยอดยกม', 0, 90), w('า', 110, 120), w('100,000.00', 160, 260)])).toBe('ยอดยกมา 100,000.00');
    expect(fixOcrLine('วันที่ เวลา รายการ จํานวนเงิน')).toBe('วันที่ เวลา รายการ จำนวนเงิน');
    expect(fixOcrLine('ยอดยกไป ๔๒,๔๙๙.๕๐')).toBe('ยอดยกไป 42,499.50');
    expect(fixOcrLine('เลขที่บัญชี xxx-%-%5432-%')).toBe('เลขที่บัญชี xxx-x-x5432-x');
  });
});
