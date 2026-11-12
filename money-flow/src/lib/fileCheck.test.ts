import { whyNotTransactions } from './fileCheck';

describe('why a file has no transactions', () => {
  it('summary reports (Thai or English)', () => {
    expect(whyNotTransactions('Sales Summary (fictional)\nช่วงข้อมูล,ยอดขายสุทธิ ($),ออเดอร์\n7 วันล่าสุด,6110.47,194')).toBe('summary');
    expect(whyNotTransactions('เจ้าหนี้ / บิล,ยอดคงเหลือ ($),วันครบกำหนด,สถานะ')).toBe('summary');
    expect(whyNotTransactions('Monthly report\nTotal income 2,000')).toBe('summary');
  });
  it('a report that mentions "Form 941" is still a report', () => {
    expect(whyNotTransactions('เจ้าหนี้ / บิล,ยอดคงเหลือ\nForm 941 / TWC Q3,ยังไม่ยืนยัน')).toBe('summary');
  });
  it('forms', () => {
    expect(whyNotTransactions('Docusign Envelope ID: X\nRestaurant Name: Address:\n' + '_____ _____\n'.repeat(6))).toBe('form');
    expect(whyNotTransactions('Bank Account Update Form\nRouting number ____ Signature ____')).toBe('form');
    expect(whyNotTransactions('แบบฟอร์มเปลี่ยนบัญชี ลงชื่อ ________')).toBe('form');
  });
  it('anything else', () => {
    expect(whyNotTransactions('Meeting notes: call the CPA')).toBe('notStatement');
  });
});
