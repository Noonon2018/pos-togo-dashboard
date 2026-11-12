import { useLang } from '../i18n';
import type { CheckKind, FileCheck } from '../lib/fileCheck';

/** "File check": one line per dropped file — what it is, can it be used, where it went / what to get instead. */

type Info = { what: string; use?: string; why?: string; fix?: string };

const TEXT = {
  th: {
    title: 'ผลตรวจไฟล์',
    ok: 'ใช้ได้',
    bad: 'ใช้ไม่ได้',
    close: 'ปิด',
    rows: '{n} รายการ',
    payouts: '{n} งวด',
    names: '{n} ชื่อ',
    sheets: 'ชีทที่ใช้: {s}',
    skipped: 'ข้ามชีท: {s} (ไม่ใช่ตารางรายการ)',
    recOk: '✓ ยอดตรงกับยอดคงเหลือของธนาคารทุกบรรทัด เชื่อได้',
    recBad: '⚠ บางบรรทัดยอดไม่ตรง ให้เทียบกับต้นฉบับในหน้าต่างนำเข้า',
    recNone: 'ไม่มียอดคงเหลือให้ตรวจ ให้เทียบยอดรวมกับแอปธนาคาร',
    recDd: '✓ ทุกงวดบวกลบแล้วตรงกับยอดที่โอนเข้าธนาคาร เชื่อได้',
    tip: 'ไฟล์ที่ใช้ได้แน่นอน: statement จากเว็บ/แอปธนาคาร (PDF, CSV, Excel), PDF statement จาก DoorDash, ไฟล์ simulation-input และรูปถ่าย statement ที่ชัด',
    kinds: {
      statement: { what: 'ตารางรายการเงิน', use: '→ หน้าต่างนำเข้า แล้วไปหน้าสรุปและกราฟเส้นเงิน' },
      statementPdf: { what: 'statement ธนาคาร (PDF)', use: '→ หน้าต่างนำเข้า แล้วไปหน้าสรุปและกราฟเส้นเงิน' },
      scan: { what: 'ภาพสแกน/รูปถ่าย statement (อ่านด้วย OCR)', use: '→ หน้าต่างนำเข้า ตรวจตัวเลขก่อนกดนำเข้า' },
      doordash: { what: 'statement ของ DoorDash', use: '→ หน้าต่างนำเข้า (บัญชี "DoorDash") แยกค่าคอม ค่าการตลาด และยอดที่โอนเข้าธนาคาร' },
      simulation: { what: 'ไฟล์ข้อมูลพยากรณ์ (simulation-input)', use: '→ เปิดหน้า 📅 พยากรณ์เงินสดแล้ว' },
      addressBook: { what: 'สมุดรายชื่อ', use: '→ เพิ่มชื่อเข้าสมุดรายชื่อแล้ว' },
      summary: {
        what: 'รายงานสรุป',
        why: 'มีแต่ยอดรวม สถานะ และหมายเหตุ ไม่มีรายการทีละรายการว่าวันไหนใครจ่ายใครเท่าไร จึงลากเส้นเงินไม่ได้',
        fix: 'ใช้ไฟล์นี้อ่านเอง · ถ้าอยากเห็นเส้นเงิน ให้โหลด statement ของบัญชีนั้นจากธนาคาร (Download → CSV/Excel)',
      },
      form: { what: 'แบบฟอร์ม', why: 'ไม่มีรายการเงินเข้าออก', fix: 'ไม่ต้องใส่ไฟล์นี้' },
      notStatement: { what: 'เอกสารที่ไม่ใช่รายการเงิน', why: 'ไม่พบแถวที่มีทั้งวันที่และจำนวนเงิน', fix: 'ใช้ statement จากธนาคารแทน' },
      scanUnreadable: { what: 'ภาพ/สแกนที่อ่านไม่ออก', why: 'OCR อ่านแล้วไม่พบรายการ (ภาพไม่ชัด เอียง หรือไม่ใช่ statement)', fix: 'สแกนใหม่ที่ 300 dpi ตรงๆ หรือโหลด PDF/CSV จากธนาคารแทน' },
      oldOffice: { what: 'ไฟล์ Office รุ่นเก่า (.xls/.doc)', why: 'ยังไม่รองรับรูปแบบเก่า', fix: 'เปิดไฟล์แล้ว Save As เป็น .xlsx หรือ .docx แล้วใส่ใหม่' },
      unsupported: { what: 'ไฟล์ประเภทที่ไม่รองรับ', why: 'อ่านได้เฉพาะ PDF, CSV, Excel, Word, LibreOffice และรูปภาพ', fix: 'export เป็น CSV หรือ PDF' },
      error: { what: 'เปิดไฟล์ไม่ได้', why: '', fix: 'ไฟล์อาจเสียหรือมีรหัสผ่าน ลองโหลดใหม่จากต้นทาง' },
    } as Record<CheckKind, Info>,
  },
  en: {
    title: 'File check',
    ok: 'usable',
    bad: 'not usable',
    close: 'Close',
    rows: '{n} rows',
    payouts: '{n} payouts',
    names: '{n} names',
    sheets: 'sheets used: {s}',
    skipped: 'skipped sheets: {s} (not transaction lists)',
    recOk: '✓ every row matches the bank balance: trustworthy',
    recBad: '⚠ some rows do not match: compare with the original in the import window',
    recNone: 'no balance column to check against: compare the totals with your bank app',
    recDd: '✓ every payout adds up to the amount paid to the bank: trustworthy',
    tip: 'Always usable: statements downloaded from the bank (PDF, CSV, Excel), DoorDash statement PDFs, simulation-input files and clear photos of a statement.',
    kinds: {
      statement: { what: 'table of transactions', use: '→ import window, then Summary and Money-flow graph' },
      statementPdf: { what: 'bank statement (PDF)', use: '→ import window, then Summary and Money-flow graph' },
      scan: { what: 'scan / photo of a statement (OCR)', use: '→ import window; check the numbers before importing' },
      doordash: { what: 'DoorDash statement', use: '→ import window (account "DoorDash"): commission, marketing and payouts split out' },
      simulation: { what: 'forecast data (simulation-input)', use: '→ opened 📅 Cash forecast' },
      addressBook: { what: 'address book', use: '→ names added' },
      summary: {
        what: 'summary report',
        why: 'only totals, statuses and notes; no one-row-per-payment list, so no money flows can be drawn',
        fix: 'read it yourself · to see money flows, download that account\'s statement from the bank (Download → CSV/Excel)',
      },
      form: { what: 'form', why: 'no money movements', fix: 'not needed' },
      notStatement: { what: 'not a list of payments', why: 'no rows with both a date and an amount', fix: 'use a bank statement instead' },
      scanUnreadable: { what: 'unreadable scan / photo', why: 'OCR found no rows (blurry, tilted, or not a statement)', fix: 'scan again straight at 300 dpi, or download PDF/CSV from the bank' },
      oldOffice: { what: 'old Office file (.xls/.doc)', why: 'old format not supported', fix: 'open it and Save As .xlsx or .docx' },
      unsupported: { what: 'unsupported file type', why: 'PDF, CSV, Excel, Word, LibreOffice and pictures only', fix: 'export as CSV or PDF' },
      error: { what: 'could not open the file', why: '', fix: 'it may be damaged or password-protected; download it again' },
    } as Record<CheckKind, Info>,
  },
};

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));

export default function FileCheckCard({ checks, onClose }: { checks: FileCheck[]; onClose: () => void }) {
  const { lang } = useLang();
  const L = TEXT[lang];
  const good = checks.filter((c) => c.ok);
  const bad = checks.filter((c) => !c.ok);
  const sorted = [...good, ...bad];
  return (
    <section className="filecheck" aria-label={L.title}>
      <div className="filecheck-head">
        <b>🔍 {L.title}</b>
        <span className="in">
          ✅ {L.ok} {good.length}
        </span>
        {bad.length > 0 && (
          <span className="out">
            ❌ {L.bad} {bad.length}
          </span>
        )}
        <span className="spacer" />
        <button className="small" onClick={onClose}>
          {L.close}
        </button>
      </div>
      <ul>
        {sorted.map((c, i) => {
          const k = L.kinds[c.kind];
          const facts = [
            c.rows ? fill(L.rows, { n: c.rows }) : '',
            c.payouts ? fill(L.payouts, { n: c.payouts }) : '',
            c.names ? fill(L.names, { n: c.names }) : '',
            c.sheets && c.sheets.length > 1 ? fill(L.sheets, { s: c.sheets.join(', ') }) : '',
          ].filter(Boolean);
          return (
            <li key={`${c.file}-${i}`} className={c.ok ? 'ok' : 'bad'}>
              <span className="fc-icon">{c.ok ? '✅' : '❌'}</span>
              <div className="filecheck-body">
                <div>
                  <b className="filecheck-name">{c.file}</b> · {k.what}
                  {facts.length > 0 && <span className="muted"> · {facts.join(' · ')}</span>}
                </div>
                {c.ok && <div className="small">{k.use}</div>}
                {c.ok && c.reconciles !== undefined && c.kind !== 'simulation' && c.kind !== 'addressBook' && (
                  <div className={`small ${c.reconciles === true ? 'in' : c.reconciles === false ? 'warn' : 'muted'}`}>
                    {c.reconciles === true ? (c.kind === 'doordash' ? L.recDd : L.recOk) : c.reconciles === false ? L.recBad : L.recNone}
                  </div>
                )}
                {c.skipped && c.skipped.length > 0 && <div className="small muted">{fill(L.skipped, { s: c.skipped.join(', ') })}</div>}
                {!c.ok && (
                  <div className="small">
                    {k.why || c.error}
                    {k.fix && (
                      <>
                        <br />
                        <b>→</b> {k.fix}
                      </>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {bad.length > 0 && <p className="small muted">{L.tip}</p>}
    </section>
  );
}
