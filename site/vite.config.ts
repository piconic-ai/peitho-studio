import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { barefoot } from '@barefootjs/vite'
import { CSRAdapter } from '@barefootjs/client/csr-adapter'

const HERE = dirname(fileURLToPath(import.meta.url))

// The landing site is a single static page: `index.html` is the Vite
// entry, and its inline `<script type="module">` imports `src/main.ts`,
// which registers the two BarefootJS islands (the download panel and the
// feature tour) and mounts them into placeholders the static HTML already
// carries. Everything outside those two islands is plain HTML, so the page
// reads fine (features, links, build instructions) before — or without —
// any JavaScript.
export default defineConfig({
  build: {
    outDir: 'dist',
    target: 'esnext',
    // Named explicitly: the barefoot plugin adds its own component entries
    // to the rollup input, and without this the page itself (Vite's
    // implicit root `index.html` entry) drops out of the build.
    rollupOptions: {
      input: { index: resolve(HERE, 'index.html') },
    },
  },
  plugins: [
    barefoot({
      adapter: new CSRAdapter(),
      components: ['src/components'],
    }),
  ],
})
