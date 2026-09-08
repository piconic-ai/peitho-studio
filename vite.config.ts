import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { barefoot } from '@barefootjs/vite'
import { CSRAdapter } from '@barefootjs/client/csr-adapter'

const HERE = dirname(fileURLToPath(import.meta.url))

// `pages/index.html` is a genuine Vite entry (not a static passthrough
// asset): its inline `<script type="module">` imports `Counter.tsx`
// directly and `@barefootjs/client/runtime`. Both need real module
// resolution/bundling, which is what routes it through Vite's own
// multi-page build instead of a hand-written import map.
// `package.json`'s `dev` script runs a one-shot `vite build` (clean) and
// THEN starts `vite build --watch` alongside `tsx watch server.ts`. With
// `emptyOutDir: true` unconditional, that second, watch-mode invocation
// re-empties `dist/` the moment it starts, before its first build
// finishes writing anything back — a ~300-400ms window (measured) where
// `dist/pages/index.html` doesn't exist. `tauri dev` only waits for
// `devUrl` to accept connections, not for a real page to be servable, so
// if the Tauri window's initial load lands in that window it 404s, and
// since a WKWebView doesn't retry once loaded, the window is stuck
// showing "Not Found" even after the rebuild finishes — the exact bug
// this was chasing. Only the clean, non-watch build (the one that runs
// before the dev servers start, and `bun run build` itself) should ever
// empty the directory out from under a server that's already serving it.
const isWatchBuild = process.argv.includes('--watch')

export default defineConfig({
  base: '/static/',
  resolve: {
    // Mirrors tsconfig.json's `@/components/*` path mapping (unused by
    // the starter Counter, which is self-contained and registry-free —
    // see `bundledRegistryComponents: []` below — but a future `bf add`
    // fetching a registry component that imports via
    // `@/components/...` would need it). Vite's dev-server dependency
    // pre-scan parses raw source directly (before this plugin's own
    // `transform` hook runs) and has no notion of tsconfig `paths`
    // without this.
    alias: {
      '@/components': resolve(HERE, 'components'),
    },
  },
  // `./public` is served directly by server.ts (as a fallback under
  // `/static/` behind vite's own bundled output — see server.ts), not
  // copied by Vite itself: Vite's own default `publicDir` behavior
  // would otherwise write a second, build-order-dependent copy into
  // `dist/` that goes stale the moment `unocss` (which regenerates
  // `public/uno.css`) runs AFTER this build in `package.json`'s
  // `build` script — and server.ts's dist-first fallback chain would
  // then serve that STALE copy instead of the fresh `public/uno.css`.
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: !isWatchBuild,
    // The starter Counter has no top-level await, but this matches
    // every other JS adapter scaffold's Vite config (and the CSR
    // integration's own reasoning: several apps that grow beyond the
    // starter use top-level `await import(...)`, which needs a modern
    // target).
    target: 'esnext',
    rollupOptions: {
      input: { 'pages/index': resolve(HERE, 'pages/index.html') },
    },
  },
  plugins: [
    barefoot({
      adapter: new CSRAdapter(),
      components: ['components'],
    }),
  ],
})
