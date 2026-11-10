/**
 * Extract text lines from a PDF, entirely in the browser (pdf.js, bundled locally — no CDN,
 * nothing uploaded). Items are grouped into lines by their baseline and sorted left-to-right.
 */
export async function pdfToLines(data: ArrayBuffer): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const task = pdfjs.getDocument({ data, disableFontFace: true });
  const doc = await task.promise;
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: { x: number; y: number; w: number; s: string }[] = [];
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      items.push({ x: it.transform[4], y: it.transform[5], w: it.width, s: it.str });
    }
    // top-to-bottom, then left-to-right; items within 3pt vertically share a line
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: (typeof items)[] = [];
    for (const it of items) {
      const line = lines.find((l) => Math.abs(l[0].y - it.y) < 3);
      if (line) line.push(it);
      else lines.push([it]);
    }
    for (const l of lines) {
      l.sort((a, b) => a.x - b.x);
      out.push(l.map((i) => i.s.trim()).join(' '));
    }
    page.cleanup();
  }
  await task.destroy();
  return out;
}
