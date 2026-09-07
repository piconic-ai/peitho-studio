// A slide fragment (e.g. `<section class="lt peitho-slide">...`) is just
// markup — it has no <head>/CSS of its own. `buildSlidePreviewDoc` wraps it
// into a standalone HTML document (the deck's own peitho.css loaded via
// <base>, plus a script that scales `.peitho-slide` to fit whatever box the
// iframe ends up in) so the same document works for both a small list
// thumbnail and the large Preview pane. Pure string templating — no
// signals, no DOM, no IPC — so the caller (`Studio.tsx`) is responsible for
// resolving `baseUrl`/`canvasWidth`/`canvasHeight` from whatever reactive
// state it currently has.
export function buildSlidePreviewDoc(fragmentHtml: string, baseUrl: string, canvasWidth: number, canvasHeight: number): string {
  return `<!doctype html><html><head><base href="${baseUrl}"><link rel="stylesheet" href="peitho.css"><style>
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #000; display: flex; align-items: center; justify-content: center; }
      :root { --peitho-canvas-width: ${String(canvasWidth)}px; --peitho-canvas-height: ${String(canvasHeight)}px; }
      /* Without this, being a flex child of <body> lets the browser
         shrink .peitho-slide below its native canvas width to fit a small
         iframe (flex-shrink defaults to 1) — that reflows/wraps the
         slide's own text at the shrunken width *before* the scale
         transform below runs, instead of shrinking the correctly-wrapped
         full-size rendering. Pin it to its native size and let transform
         do 100% of the size reduction. */
      .peitho-slide { flex-shrink: 0; }
    </style></head><body>${fragmentHtml}<script>
      (function () {
        function fit() {
          var el = document.querySelector('.peitho-slide')
          if (!el) return
          // Math.min is "contain": on a box whose own aspect ratio doesn't
          // match the canvas (e.g. the large "selected slide" preview pane,
          // which is just \`flex-1 w-full\` with no aspect-ratio lock of its
          // own) this intentionally letterboxes, showing body's black
          // background as real, sizeable bars — do not switch this to
          // Math.max ("cover"), which blows up content on the tighter axis
          // instead (confirmed the hard way: it did exactly that here).
          // The thumbnail wrapper *is* separately aspect-ratio-locked in
          // Studio.tsx to match the canvas, so there Math.min should in
          // theory make both axes agree exactly — but that CSS layout
          // computation and this script's own division are independent
          // rounding paths that rarely land on the *exact* same ratio,
          // leaving a hairline gap on one axis that shows through as a
          // faint line — 0.5% wasn't enough of a margin in WKWebView specifically
          // (this rendered pixel-perfect with zero gap under Chromium at that
          // margin, but a hairline was still reported against the real Tauri
          // app; WebKit's sub-pixel transform/layout rounding isn't guaranteed
          // to match Chromium's, and this repo has no way to test actual
          // WebKit against a network-isolated sandbox). 2% is still safely
          // inside the theme's own slide padding (64px/72px out of 720/1280 —
          // see themes/base.css in the peitho repo), so it stays imperceptible
          // while giving real headroom against whichever engine's rounding
          // this turns out to be.
          var scale = Math.min(window.innerWidth / ${String(canvasWidth)}, window.innerHeight / ${String(canvasHeight)}) * 1.02
          el.style.transform = 'scale(' + scale + ')'
          el.style.transformOrigin = 'center center'
        }
        window.addEventListener('resize', fit)
        fit()
      })()
    </script></body></html>`
}
