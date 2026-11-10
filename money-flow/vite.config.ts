/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Production build gets a strict CSP: no network requests at all (connect-src 'none'),
// so statement data physically cannot leave the browser.
const csp: Plugin = {
  name: 'strict-csp',
  apply: 'build',
  transformIndexHtml(html) {
    return html.replace(
      '<meta charset="UTF-8" />',
      `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; form-action 'none'" />`,
    );
  },
};

export default defineConfig({
  plugins: [react(), csp],
  base: './',
  server: { host: '127.0.0.1' },
  build: { chunkSizeWarningLimit: 1200 }, // cytoscape is ~500 kB; fine for a local tool
  test: { globals: true, environment: 'node' },
});
