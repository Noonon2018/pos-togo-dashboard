import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// TODO: Replace 'your-username/your-repo' with your actual GitHub repo name
const repoName = 'your-username/your-repo';

export default defineConfig({
  plugins: [react()],
  base: `/${repoName}/`,
})
