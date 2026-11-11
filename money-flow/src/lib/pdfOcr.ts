/**
 * Read a SCANNED statement PDF (pages that are pictures, no text): each page is drawn to a canvas
 * with pdf.js and read by tesseract.js (OCR), English + Thai. Everything runs in this browser tab,
 * with the engine and language models shipped inside the app (see vite.config.ts) — nothing is
 * uploaded or downloaded.
 *
 * OCR can misread digits (8 ↔ 3, 1 ↔ 7). The import step checks every row against the running
 * balance and the opening/closing balance, so a misread number shows up as a mismatch.
 */

export interface OcrProgress {
  page: number;
  pages: number;
  /** 0..1 inside the current page */
  part: number;
}

const base = () => new URL('ocr/', document.baseURI).href;

type Word = { text: string; x0: number; x1: number; y0: number; y1: number };
const THAI_CH = /[\u0E00-\u0E7F]/;
const NO_START = /[ะาำัิีึืุู่้๊๋็์ํๅๆ]/;
const LEADING = /[เแโใไ]/;

/**
 * One OCR line → text. Thai is written without spaces between words, and the OCR returns it in small
 * pieces (even single vowels/tone marks): glue pieces that touch, keep a space where there is a gap.
 */
export function lineText(words: Word[]): string {
  const ws = words.filter((w) => w.text.trim()).sort((a, b) => a.x0 - b.x0);
  const h = Math.max(1, ...ws.map((w) => w.y1 - w.y0)) * 0.5; // about the height of a Latin letter
  let out = '';
  let prev: Word | null = null;
  for (const w of ws) {
    const t = w.text.trim();
    if (prev) {
      const gap = w.x0 - prev.x1;
      const thai = THAI_CH.test(prev.text.slice(-1)) && THAI_CH.test(t[0]);
      // vowels / tone marks that cannot start a word, or a leading vowel waiting for its consonant
      const mustGlue = thai && (NO_START.test(t[0]) || LEADING.test(prev.text.slice(-1)));
      out += thai ? (mustGlue || gap <= h * 0.6 ? '' : ' ') : ' ';
    }
    out += t;
    prev = w;
  }
  return out;
}

/** Fallback when the OCR gives words without lines: group by vertical position. */
export function wordsToLines(words: Word[]): string[] {
  const sorted = [...words].filter((w) => w.text.trim()).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lines: { mid: number; h: number; words: Word[] }[] = [];
  for (const w of sorted) {
    const mid = (w.y0 + w.y1) / 2;
    const h = Math.max(1, w.y1 - w.y0);
    const line = lines.find((l) => Math.abs(l.mid - mid) < Math.min(l.h, h) * 0.5);
    if (line) line.words.push(w);
    else lines.push({ mid, h, words: [w] });
  }
  return lines.sort((a, b) => a.mid - b.mid).map((l) => lineText(l.words));
}

/** Common OCR slips inside amounts: "1,234.S6" → "1,234.56", "O" → "0", "l" → "1", "1 ,234.56" → "1,234.56". */
export function fixOcrLine(line: string): string {
  return line
    .replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50)) // Thai digits
    .replace(/\u0E4D\u0E32/g, '\u0E33') // ํ + า → ำ (the OCR splits sara am)
    .replace(/(?<=[-\dxX])%|%(?=[-\dxX])/g, 'x') // masked account numbers: xxx-x-x5432-x
    .replace(/^(?:[~_|=—–•·*.,'"`]+\s*)+/, '') // specks of dirt before the date
    .replace(/\s+[~_|=—•`]+(?=\s)/g, '')
    .replace(/(?<=\d)\s+(?=[,.]\d)/g, '')
    .replace(/(?<=[\d,.])[Oo](?=[\d,.])|(?<=\d)[Oo]\b/g, '0')
    .replace(/(?<=[\d,.])[lI|](?=[\d,.])/g, '1')
    .replace(/(?<=[\d,.])[Ss](?=\d)/g, '5')
    .replace(/(?<=\d,\d{3})\s?,(?=\d{2}\b)/g, '.'); // "1,234,56" (comma read for the decimal point)
}

async function makeWorker(onLog: (part: number) => void) {
  const { createWorker, OEM, PSM } = await import('tesseract.js');
  const worker = await createWorker(['eng', 'tha'], OEM.LSTM_ONLY, {
    workerPath: `${base()}worker.min.js`,
    corePath: `${base()}core`,
    langPath: `${base()}lang`,
    workerBlobURL: false, // load the worker as a normal same-origin file (strict CSP)
    cacheMethod: 'none', // nothing written to the browser's storage
    gzip: true,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onLog(m.progress);
    },
  });
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK, // keep each statement row together
    preserve_interword_spaces: '1',
  });
  return worker;
}

async function readCanvas(worker: Awaited<ReturnType<typeof makeWorker>>, canvas: HTMLCanvasElement): Promise<string[]> {
  const { data: res } = await worker.recognize(canvas, {}, { blocks: true, text: false });
  // the OCR's own lines (rows of the statement), each line's words glued as above
  const lines = res.blocks?.flatMap((b) => b.paragraphs.flatMap((pa) => pa.lines)) ?? [];
  const sortedLines = [...lines].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  return sortedLines.map((l) => fixOcrLine(lineText(l.words.map((w) => ({ text: w.text, ...w.bbox }))))).filter(Boolean);
}

function whiteCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w);
  canvas.height = Math.ceil(h);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

export async function ocrPdfToLines(data: ArrayBuffer, onProgress?: (p: OcrProgress) => void): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfWorker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker.default;
  let pageNo = 0;
  let pages = 0;
  const worker = await makeWorker((part) => pages && onProgress?.({ page: pageNo, pages, part }));
  const task = pdfjs.getDocument({ data, disableFontFace: true });
  const out: string[] = [];
  try {
    const doc = await task.promise;
    pages = doc.numPages;
    for (let p = 1; p <= doc.numPages; p++) {
      pageNo = p;
      onProgress?.({ page: p, pages, part: 0 });
      const page = await doc.getPage(p);
      // ~300 dpi: small statement print needs it, but cap the size for very large pages
      const unscaled = page.getViewport({ scale: 1 });
      const scale = Math.min(300 / 72, 4000 / Math.max(unscaled.width, unscaled.height));
      const viewport = page.getViewport({ scale });
      const { canvas, ctx } = whiteCanvas(viewport.width, viewport.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      out.push(...(await readCanvas(worker, canvas)));
      page.cleanup();
      canvas.width = canvas.height = 0; // free the memory
    }
  } finally {
    await worker.terminate();
    await task.destroy();
  }
  return out;
}

/** A photo or screenshot of a statement (.jpg / .png / …). Small images are enlarged for the OCR. */
export async function ocrImageToLines(file: Blob, onProgress?: (p: OcrProgress) => void): Promise<string[]> {
  const bmp = await createImageBitmap(file);
  const long = Math.max(bmp.width, bmp.height);
  const scale = long < 2000 ? 2000 / long : long > 5000 ? 5000 / long : 1;
  const { canvas, ctx } = whiteCanvas(bmp.width * scale, bmp.height * scale);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const worker = await makeWorker((part) => onProgress?.({ page: 1, pages: 1, part }));
  try {
    onProgress?.({ page: 1, pages: 1, part: 0 });
    return await readCanvas(worker, canvas);
  } finally {
    await worker.terminate();
    canvas.width = canvas.height = 0;
  }
}
