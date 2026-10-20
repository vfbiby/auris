import { defineConfig } from 'vite';

// GitHub Pages serves the site from /auris/
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/auris/' : '/',
});
