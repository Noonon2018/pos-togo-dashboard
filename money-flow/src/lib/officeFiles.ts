import { unzipSync, strFromU8 } from 'fflate';
import Papa from 'papaparse';
import { parseAmount, parseDate } from './csv';

/**
 * Read tables out of office documents, in the browser, with no Excel/Word library:
 *   .xlsx / .xlsm (Excel), .ods (LibreOffice / Google Sheets download), .docx (Word tables and text).
 * These files are ZIP archives of XML; we unzip only the parts we need and read them with small,
 * strict patterns. Old binary .xls / .doc are not supported (open and "Save As" .xlsx / .docx).
 *
 * Safety: a size cap protects against "zip bombs" (tiny files that unpack to gigabytes), and
 * repeated empty cells/rows (ODS stores "1,048,576 empty rows" as one element) are never expanded.
 */

export interface Sheet {
  name: string;
  rows: string[][];
}

const MAX_UNZIPPED = 150 * 1024 * 1024; // 150 MB of XML is far beyond any real statement
const MAX_ROWS = 200_000;
const MAX_COLS = 200;

function unzip(data: Uint8Array, want: (name: string) => boolean): Record<string, string> {
  let total = 0;
  const files = unzipSync(data, {
    filter: (f) => {
      if (!want(f.name)) return false;
      total += f.originalSize;
      if (total > MAX_UNZIPPED) throw new Error('file too large when unpacked');
      return true;
    },
  });
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) out[k] = strFromU8(v);
  return out;
}

/** XML text → plain text (entities). */
export function xmlText(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? xmlText(m[1]) : null;
};

const colIndex = (ref: string) => {
  const letters = ref.replace(/\d+$/, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

const pad = (n: number) => String(n).padStart(2, '0');
/** Excel serial day → ISO date (with time when the format shows hours). */
export function excelDate(serial: number, date1904: boolean, withTime: boolean): string {
  const ms = Math.round((serial + (date1904 ? 1462 : 0)) * 86_400_000) + Date.UTC(1899, 11, 30);
  const d = new Date(ms);
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return withTime ? `${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : day;
}

const BUILTIN_DATE = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
const isDateFormat = (code: string) => {
  const c = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''); // drop literals, colours, escapes
  return /[dy]/i.test(c) || (/m/i.test(c) && !/[hs0#]/i.test(c)); // "m/d/yyyy", "mmm-yy"; not "mm:ss" or "0.00"
};

/** Excel 2007+ workbook. */
export function readXlsx(data: Uint8Array): Sheet[] {
  const f = unzip(data, (n) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(n));
  const wb = f['xl/workbook.xml'];
  if (!wb) throw new Error('not an Excel workbook');
  const date1904 = /date1904="(1|true)"/.test(wb);
  // shared strings (rich text = several <t> runs)
  const shared = [...(f['xl/sharedStrings.xml'] ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1])).join(''),
  );
  // styles: which cell styles are dates (and which show a time)
  const styles = f['xl/styles.xml'] ?? '';
  const custom = new Map([...styles.matchAll(/<numFmt\s[^>]*>/g)].map((m) => [Number(attr(m[0], 'numFmtId')), attr(m[0], 'formatCode') ?? '']));
  const xfs = (styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '').match(/<xf\s[^>]*?\/?>/g) ?? [];
  const styleKind = xfs.map((x) => {
    const id = Number(attr(x, 'numFmtId') ?? 0);
    const code = custom.get(id) ?? '';
    const date = BUILTIN_DATE.has(id) || (custom.has(id) && isDateFormat(code));
    return date ? (/h/i.test(code) || id === 22 ? 'datetime' : 'date') : 'other';
  });
  // sheet order + names → file
  const rels = new Map(
    [...(f['xl/_rels/workbook.xml.rels'] ?? '').matchAll(/<Relationship\s[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target') ?? '']),
  );
  const sheets: Sheet[] = [];
  for (const m of wb.matchAll(/<sheet\s[^>]*>/g)) {
    if (attr(m[0], 'state') === 'hidden' || attr(m[0], 'state') === 'veryHidden') continue;
    const target = rels.get(attr(m[0], 'r:id'));
    if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = f[path];
    if (!xml) continue;
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      if (rows.length >= MAX_ROWS) break;
      const rowNo = Number(attr(`<row${r[1]}>`, 'r') ?? rows.length + 1);
      while (rows.length < rowNo - 1 && rows.length < MAX_ROWS) rows.push([]); // keep blank rows as blank
      const row: string[] = [];
      let next = 0;
      for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = `<c${c[1]}>`;
        const ref = attr(tag, 'r');
        const ci = ref ? colIndex(ref) : next;
        next = ci + 1;
        if (ci >= MAX_COLS) continue;
        const t = attr(tag, 't');
        const inner = c[2] ?? '';
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let out = '';
        if (t === 's') out = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') out = [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => xmlText(x[1])).join('');
        else if (t === 'str' || t === 'e') out = t === 'e' ? '' : xmlText(v ?? '');
        else if (t === 'b') out = v === '1' ? 'TRUE' : 'FALSE';
        else if (v !== undefined) {
          const num = Number(v);
          const kind = styleKind[Number(attr(tag, 's') ?? 0)] ?? 'other';
          if (kind !== 'other' && Number.isFinite(num) && num > 0 && num < 2_958_466) out = excelDate(num, date1904, kind === 'datetime' && num % 1 !== 0);
          else out = Number.isFinite(num) ? String(Number(num.toPrecision(15))) : xmlText(v);
        }
        while (row.length < ci) row.push('');
        row[ci] = out;
      }
      rows.push(row);
    }
    sheets.push({ name: attr(m[0], 'name') ?? `Sheet${sheets.length + 1}`, rows: trim(rows) });
  }
  return sheets;
}

/** OpenDocument spreadsheet (.ods) — LibreOffice, and Google Sheets "Download → .ods". */
export function readOds(data: Uint8Array): Sheet[] {
  const f = unzip(data, (n) => n === 'content.xml');
  const xml = f['content.xml'];
  if (!xml) throw new Error('not an OpenDocument spreadsheet');
  const sheets: Sheet[] = [];
  for (const t of xml.matchAll(/<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/g)) {
    const rows: string[][] = [];
    for (const r of t[2].matchAll(/<table:table-row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g)) {
      const row: string[] = [];
      for (const c of (r[2] ?? '').matchAll(/<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g)) {
        const tag = `<x${c[1]}>`;
        const type = attr(tag, 'office:value-type');
        let v =
          type === 'date'
            ? (attr(tag, 'office:date-value') ?? '').replace(/T(\d\d:\d\d).*$/, ' $1').replace(/ 00:00$/, '')
            : type === 'float' || type === 'currency' || type === 'percentage'
              ? (attr(tag, 'office:value') ?? '')
              : [...(c[2] ?? '').matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g)].map((p) => xmlText(p[1].replace(/<text:s\b[^>]*\/>/g, ' '))).join(' ');
        v = v.trim();
        const rep = Math.min(Number(attr(tag, 'table:number-columns-repeated') ?? 1), v ? MAX_COLS : 1);
        for (let i = 0; i < rep && row.length < MAX_COLS; i++) row.push(v);
      }
      const rep = Math.min(Number(attr(`<x${r[1]}>`, 'table:number-rows-repeated') ?? 1), row.some(Boolean) ? 1000 : 1);
      for (let i = 0; i < rep && rows.length < MAX_ROWS; i++) rows.push([...row]);
    }
    sheets.push({ name: attr(`<x${t[1]}>`, 'table:name') ?? `Sheet${sheets.length + 1}`, rows: trim(rows) });
  }
  return sheets;
}

/** Word (.docx): every table as a sheet, plus all paragraph text as lines (for statement-like text). */
export function readDocx(data: Uint8Array): { tables: Sheet[]; lines: string[] } {
  const f = unzip(data, (n) => n === 'word/document.xml');
  const xml = f['word/document.xml'];
  if (!xml) throw new Error('not a Word document');
  const cellText = (s: string) =>
    [...s.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
      .map((p) => [...p[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>/g)].map((t) => (t[1] === undefined ? ' ' : xmlText(t[1]))).join(''))
      .join(' ')
      .trim();
  const tables: Sheet[] = [];
  for (const t of xml.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>/g)) {
    const rows = [...t[1].matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)].map((r) => [...r[1].matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map((c) => cellText(c[1])));
    tables.push({ name: `Table ${tables.length + 1}`, rows: trim(rows) });
  }
  const body = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, '');
  const lines = [...body.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map((p) => cellText(`<w:p>${p[1]}</w:p>`)).filter(Boolean);
  return { tables, lines };
}

/** Drop trailing empty rows and columns. */
function trim(rows: string[][]): string[][] {
  const r = rows.map((x) => x.map((v) => v ?? ''));
  while (r.length && !r[r.length - 1].some((v) => v.trim())) r.pop();
  const width = Math.max(0, ...r.map((x) => x.reduce((w, v, i) => (v.trim() ? i + 1 : w), 0)));
  return r.map((x) => {
    const y = x.slice(0, width);
    while (y.length < width) y.push('');
    return y;
  });
}

/**
 * Is this table a list of transactions (one row = one movement of money)? At least 3 rows that hold
 * a date and an amount. A summary report (totals, statuses, notes) is not.
 */
/** One row = one movement of money: a date and an amount. */
export function isTxRow(r: string[]): boolean {
  const hasDate = r.some((v) => v.length <= 30 && !!parseDate(v));
  return hasDate && r.some((v) => v.length <= 20 && /\d/.test(v) && !parseDate(v) && Number.isFinite(parseAmount(v)));
}

export function countTxRows(rows: string[][]): number {
  return rows.filter(isTxRow).length;
}

export function looksLikeTransactions(rows: string[][]): boolean {
  let hits = 0;
  for (const r of rows) if (isTxRow(r) && ++hits >= 3) return true;
  return false;
}

export const toCsv = (rows: string[][]) => Papa.unparse(rows, { newline: '\r\n' });

export type DocKind = 'xlsx' | 'ods' | 'docx' | 'image' | 'oldOffice' | null;
export function docKind(name: string, type = ''): DocKind {
  const n = name.toLowerCase();
  if (/\.(xlsx|xlsm)$/.test(n)) return 'xlsx';
  if (/\.ods$/.test(n)) return 'ods';
  if (/\.docx$/.test(n)) return 'docx';
  if (/\.(png|jpe?g|webp|bmp|gif)$/.test(n) || /^image\/(png|jpeg|webp|bmp|gif)$/.test(type)) return 'image';
  if (/\.(xls|doc|xlsb|numbers|pages)$/.test(n)) return 'oldOffice';
  return null;
}
