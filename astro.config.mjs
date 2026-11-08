// @ts-check
import { defineConfig } from 'astro/config';

// Static output for GitHub Pages at https://dioramavr.app (public/CNAME).
// Every page is a folder with index.html, so /download/ and /tpm-vr/ are stable URLs.
export default defineConfig({
  site: 'https://dioramavr.app',
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'never' },
  devToolbar: { enabled: false },
});
