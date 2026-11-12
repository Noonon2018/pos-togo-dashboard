import { normalizeCounterparty as n, resolveAlias } from './normalize';

describe('normalizeCounterparty', () => {
  it.each([
    ['AMAZON MKTP US*2K3J45LL1 AMZN.COM/BILL WA', 'AMAZON'],
    ['AMZN Mktp US*RT5QW12P0 Amzn.com/bill WA', 'AMAZON'],
    ['Amazon Prime*1A2B3C Amzn.com/bill WA', 'AMAZON PRIME'],
    ['UBER *EATS PENDING SAN FRANCISCO CA', 'UBER EATS'],
    ['UBER   *TRIP HELP.UBER.COM CA', 'UBER'],
    ['Netflix.com 866-579-7172 CA', 'NETFLIX'],
    ['ORIG CO NAME:GUSTO ORIG ID:9876543210 DESC DATE:260807 CO ENTRY DESCR:PAYROLL', 'GUSTO'],
    ['TX COMPTROLLER DES:SALES TAX ID:3200 CCD', 'TX COMPTROLLER'],
    ['ZELLE PAYMENT TO SOMCHAI K JPM7708CD34', 'SOMCHAI K'],
    ['ZELLE FROM PRANEE S ON 09/08 REF # BAC0098', 'PRANEE S'],
    ['ZELLE PAYMENT TO GREENLEAF PLAZA LLC CONF# 88J2K1', 'GREENLEAF PLAZA LLC'],
    ['SQ *THAI BASIL CAFE Houston TX', 'THAI BASIL CAFE HOUSTON'],
    ['TST* PHO SAIGON 2 HOUSTON TX', 'PHO SAIGON 2 HOUSTON'],
    ['ASIAN MARKET WHOLESALE LLC CHECKCARD 0912', 'ASIAN MARKET WHOLESALE LLC'],
    ['PURCHASE AUTHORIZED ON 08/14 WALGREENS #1234 HOUSTON TX S123456789 CARD 4411', 'WALGREENS'],
    ['RESTAURANT DEPOT #12 HOUSTON TX', 'RESTAURANT DEPOT'],
    ['ATM WITHDRAWAL 001234 8/14 5400 BELLAIRE HOUSTON TX', 'ATM CASH'],
    ['AUTOPAY PAYMENT RECEIVED - THANK YOU', 'CARD PAYMENT RECEIVED'],
    ['STATE FARM RO 27 SFPP 1234567', 'STATE FARM'],
    // Chase checking card format
    ['Recurring Card Purchase 10/22 Google *Claude By An G.CO/Helppay# CA Card 1368', 'GOOGLE PLAY: CLAUDE BY AN'],
    ['Recurring Card Purchase 10/16 Google *Grok G.CO/Helppay# CA Card 1368', 'GOOGLE PLAY: GROK'],
    ['Card Purchase 10/02 Google *Honor of King 855-836-3987 CA Card 1368', 'GOOGLE PLAY: HONOR OF KING'],
    ['Payment Sent 09/30 Coinbase Https://Www.F CA Card 1368', 'COINBASE'],
    ['Remote Online Deposit 1', 'CHECK DEPOSIT (MOBILE)'],
    ['Zelle Payment From Somchai Jaidee Bacgauy8Idq7', 'SOMCHAI JAIDEE'],
    ['Zelle Payment From Somchai Jaidee Bacf23Jnupvj', 'SOMCHAI JAIDEE'],
    ['Card Purchase With Pin 10/06 H-E-B #575 Houston TX Card 1368', 'H-E-B'],
    ['Card Purchase 09/25 Express Food Mart Houston TX Card 1368', 'EXPRESS FOOD MART HOUSTON'],
  ])('%s -> %s', (raw, want) => expect(n(raw)).toBe(want));

  it('collapses both sides of an internal transfer to one key', () => {
    expect(n('ONLINE TRANSFER TO CHK ...9021 TRANSACTION#: 20899887766')).toBe('TRANSFER CHK 9021');
    expect(n('ONLINE TRANSFER FROM CHASE CHECKING XXXXXX9021 REF #IB0087Q2')).toBe('TRANSFER CHK 9021');
    expect(n('ONLINE TRANSFER TO SAV ...7788 TRANSACTION#: 10855443322')).toBe('TRANSFER SAV 7788');
  });

  it('does not truncate words that merely start with a reference keyword', () => {
    expect(n('REFUND FROM BEST BUY')).toContain('REFUND');
  });

  it('never returns empty', () => {
    expect(n('#12345')).not.toBe('');
    expect(n('')).toBe('UNKNOWN');
  });
});

describe('resolveAlias', () => {
  it('follows chains and survives cycles', () => {
    expect(resolveAlias('A', { A: 'B', B: 'C' })).toBe('C');
    expect(resolveAlias('X', {})).toBe('X');
    expect(['A', 'B']).toContain(resolveAlias('A', { A: 'B', B: 'A' }));
  });
});

describe('Thai bank descriptions', () => {
  it.each([
    ['รับโอนจาก KBANK x1234 นาย สมชาย ใจดี', 'สมชาย ใจดี'],
    ['รับโอนเงินพร้อมเพย์ จาก นางสาว ผู้บริจาค หนึ่ง', 'ผู้บริจาค หนึ่ง'],
    ['โอนเงินไปยัง SCB X5678 นาง แม่บ้าน วาย', 'แม่บ้าน วาย'],
    ['โอนเงินพร้อมเพย์ 081-234-5678 น.ส. ใจดี มีสุข', 'ใจดี มีสุข'],
    ['ชำระค่าสินค้าและบริการ คลินิกรักษาสัตว์ สุขใจ', 'คลินิกรักษาสัตว์ สุขใจ'],
    ['ถอนเงินสด ATM สาขาสยาม', 'ATM CASH'],
    ['ดอกเบี้ยเงินฝาก', 'INTEREST'],
    ['ค่าธรรมเนียมโอนต่างธนาคาร', 'ค่าธรรมเนียมธนาคาร'],
    ['โอนเงิน กสิกรไทย xxx-x-x1234-x บริษัท อาหารสัตว์ดี จำกัด', 'บริษัท อาหารสัตว์ดี จำกัด'],
  ])('%s -> %s', (raw, want) => expect(n(raw)).toBe(want));

  it('both sides of the same person land on one name', () => {
    expect(n('รับโอนจาก KTB x9999 นาย ประธาน เอ')).toBe(n('โอนเงินไปยัง KTB x9999 นาย ประธาน เอ'));
  });
});
