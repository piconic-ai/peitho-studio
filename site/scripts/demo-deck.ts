// Capture fixture: Markdown-driven HTML slides about HTTP server throughput.
// Prerecorded research result from Bun's published Linux HTTP benchmark.
export const DATA_SOURCES = ['https://bun.sh/docs/runtime/http/server#benchmarks']

export const source = `<!-- {"key":"cover"} -->
# HTTP performance

Runtime choices, measured and explained.

---

<!-- {"key":"throughput"} -->
# HTTP servers

Choosing a runtime for a small HTTP service.

---

<!-- {"key":"discussion"} -->
# What comes next?

Let's explore the possibilities.
`

// Web Animations are started by JavaScript, not CSS keyframes.
const animation = `<script>
if (!window.__httpDemoAnimate) {
window.__httpDemoAnimate = root => {
const slide = root.querySelector('.peitho-slide');
if (!slide || slide.dataset.animated) return;
slide.dataset.animated = 'true';
slide.querySelectorAll('[data-reveal]').forEach((el, i) => {
  el.animate([{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'translateY(0)' }],
    { duration: 700, delay: i * 120, fill: 'both', easing: 'ease-out' });
});
slide.querySelectorAll('[data-bar]').forEach((el, i) => {
  el.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
    { duration: 1600, delay: 300 + i * 300, fill: 'both', easing: 'cubic-bezier(.2,.8,.2,1)' });
});
};
document.addEventListener('peitho:shadow-mounted', event => window.__httpDemoAnimate(event.detail.root));
}
(window.__peithoShadowRoots || []).forEach(({root}) => window.__httpDemoAnimate(root));
</script>`

export const chart = `<div class="chart" data-reveal>
  <p class="chart-label">HTTP THROUGHPUT · REQUESTS / SECOND ↑</p>
  <div class="chart-row"><span>Node 16</span><div class="track"><div class="bar" data-bar style="width:40%"></div></div><strong>~64k</strong></div>
  <div class="chart-row"><span>Bun</span><div class="track"><div class="bar accent" data-bar style="width:100%"></div></div><strong>~160k</strong></div>
  <p class="chart-source">Source: Bun docs · Linux · simple HTTP response · vendor benchmark</p>
</div>`

export const chartMarkdown = `\n${chart}\n${animation}\n`

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

export function fragmentFor(source: string, title: string): string {
  const at = source.indexOf(`# ${title}`) + 2
  const start = Buffer.byteLength(source.slice(0, at))
  const end = start + Buffer.byteLength(title)
  const isThroughput = title === 'HTTP servers' || title === 'HTTP throughput'
  const hasChart = isThroughput && source.includes('class="chart"')
  return `<section class="peitho-slide">
    <p class="eyebrow" data-reveal>HTTP PERFORMANCE / ${isThroughput ? '02' : title === 'HTTP performance' ? '01' : '03'}</p>
    <h1 data-reveal><span data-peitho-src="${start}-${end}" data-peitho-md="${escape(title)}">${escape(title)}</span></h1>
    ${hasChart ? chart : `<p class="subtitle" data-reveal>${isThroughput ? 'Choosing a runtime for a small HTTP service.' : title === 'HTTP performance' ? 'Runtime choices, measured and explained.' : "Let's explore the possibilities."}</p><div class="orbit" data-reveal><span>HTML + JavaScript</span><b>Request → Response</b></div>`}
    <p class="footer">ENGINEERING NOTES <span>PEITHO STUDIO</span></p>
    ${animation}
  </section>`
}

export const css = `
.peitho-slide { width: var(--peitho-canvas-width,1280px); height: var(--peitho-canvas-height,720px); box-sizing: border-box; padding: 64px 80px; background: #102d2b; color: #effaf2; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; position: relative; overflow: hidden; }
.peitho-slide .eyebrow { margin: 0 0 30px; color: #91c4b3; font-size: 20px; letter-spacing: .16em; }
.peitho-slide h1 { font-size: 68px; line-height: 1.1; letter-spacing: -.04em; margin: 0 0 24px; max-width: 1060px; }
.peitho-slide .subtitle { font-size: 30px; color: #c3d9cf; margin: 0; }
.peitho-slide .orbit { margin-top: 50px; padding: 40px; border: 1px solid #4e7366; border-radius: 24px; background: #1b413b; }
.peitho-slide .orbit span { display: block; font-size: 20px; color: #91c4b3; margin-bottom: 16px; }
.peitho-slide .orbit b { font-size: 42px; color: #d7ff85; }
.peitho-slide .footer { position: absolute; bottom: 24px; left: 80px; right: 80px; font-size: 16px; color: #91c4b3; letter-spacing: .1em; }
.peitho-slide .footer span { float: right; }
.peitho-slide .chart { margin-top: 40px; }
.peitho-slide .chart-label { color: #91c4b3; font-size: 20px; letter-spacing: .08em; margin-bottom: 28px; }
.peitho-slide .chart-row > span { width: 150px; }
.peitho-slide .chart-row { display: flex; align-items: center; gap: 24px; font-size: 32px; margin: 24px 0; }
.peitho-slide .track { flex: 1; }
.peitho-slide .bar { height: 64px; background: #71b6a1; border-radius: 8px; transform-origin: left; }
.peitho-slide .bar.accent { background: #d7ff85; }
.peitho-slide .chart-row strong { width: 130px; text-align: right; }
.peitho-slide .chart-source { margin-top: 36px; font-size: 18px; color: #91c4b3; }
`
