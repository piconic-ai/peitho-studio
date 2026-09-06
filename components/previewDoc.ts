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
          var scale = Math.min(window.innerWidth / ${String(canvasWidth)}, window.innerHeight / ${String(canvasHeight)})
          el.style.transform = 'scale(' + scale + ')'
          el.style.transformOrigin = 'center center'
        }
        window.addEventListener('resize', fit)
        fit()
      })()
    </script></body></html>`
}
