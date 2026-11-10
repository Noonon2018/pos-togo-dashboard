/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Strict Content-Security-Policy for the built app: no network requests at all
// (connect-src 'none'), no plugins, no forms, no external scripts — so statement data
// cannot leave the browser even if a dependency misbehaves.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'none'",
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

export default defineConfig({
  plugins: [react(), cspMeta],
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
