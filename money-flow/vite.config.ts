/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Strict Content-Security-Policy for the built app: no network requests at all
// (connect-src 'none'), no plugins, no forms, no external scripts — so statement data
// cannot leave the browser even if a dependency misbehaves.
const CSP = [
  "default-src 'self'",
  // 'wasm-unsafe-eval': lets the OCR engine (WebAssembly, bundled locally) run; no JS eval
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  // 'self' = only files of this app on 127.0.0.1 (the OCR model); still nothing can go to the internet
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const cspMeta: Plugin = {
  name: 'strict-csp',
  apply: 'build',
  transformIndexHtml(html) {
    return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
  },
};

// OCR for scanned PDFs (tesseract.js): ship the worker, engine and the English + Thai models
// with the app so reading a scan needs no internet (the library would use a CDN otherwise).
const require = createRequire(import.meta.url);
const OCR_FILES: Record<string, string> = {
  'ocr/worker.min.js': require.resolve('tesseract.js/dist/worker.min.js'),
  ...Object.fromEntries(
    ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'].map((f) => [
      `ocr/core/${f}`,
      require.resolve(`tesseract.js-core/${f}`),
    ]),
  ),
  'ocr/lang/eng.traineddata.gz': require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),
  'ocr/lang/tha.traineddata.gz': require.resolve('@tesseract.js-data/tha/4.0.0_best_int/tha.traineddata.gz'),
};
const ocrAssets: Plugin = {
  name: 'ocr-assets',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const key = (req.url ?? '').split('?')[0].replace(/^\//, '');
      const file = OCR_FILES[key];
      if (!file) return next();
      res.setHeader('Content-Type', key.endsWith('.gz') ? 'application/octet-stream' : 'text/javascript');
      res.end(readFileSync(file));
    });
  },
  generateBundle() {
    for (const [fileName, file] of Object.entries(OCR_FILES)) this.emitFile({ type: 'asset', fileName, source: readFileSync(file) });
  },
};

export default defineConfig({
  plugins: [react(), cspMeta, ocrAssets],
  base: './',
  server: { host: '127.0.0.1' },
  // `npm run app` / the desktop launcher: only reachable from this computer (127.0.0.1),
  // fixed port, and hardened response headers.
  preview: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    headers: {
      'Content-Security-Policy': `${CSP}; frame-ancestors 'none'`,
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), payment=(), clipboard-read=()',
      'Cache-Control': 'no-store',
    },
  },
  build: { chunkSizeWarningLimit: 1200 }, // cytoscape is ~500 kB; fine for a local tool
  test: { globals: true, environment: 'node' },
});
