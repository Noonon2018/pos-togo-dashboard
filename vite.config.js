import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Set repoName for GitHub Pages deployment
const repoName = 'pos-togo-dashboard';

export default defineConfig({
  plugins: [react()],
  base: `/${repoName}/`,
})
