// Capture fixture: a Peitho-style HTML layout driven by Markdown headings.
// Agent research is prerecorded; the figures come from IRENA's 2024/2025 releases.
export const DATA_SOURCES = [
  'https://www.irena.org/News/pressreleases/2024/Mar/Record-Growth-in-Renewables-but-Progress-Needs-to-be-Equitable',
  'https://www.irena.org/News/pressreleases/2025/Mar/Record-Breaking-Annual-Growth-in-Renewable-Power-Capacity',
]

export const source = `<!-- {"key":"cover"} -->
# Energy outlook

A presentation built with Markdown and HTML.

---

<!-- {"key":"renewables"} -->
# Renewable energy

The next chapter of the energy transition.

---

<!-- {"key":"discussion"} -->
# What comes next?

Let's explore the possibilities.
`

// Web Animations are started by JavaScript, not CSS keyframes.
const animation = `<script>
if (!window.__energyDemoAnimate) {
window.__energyDemoAnimate = root => {
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
document.addEventListener('peitho:shadow-mounted', event => window.__energyDemoAnimate(event.detail.root));
}
(window.__peithoShadowRoots || []).forEach(({root}) => window.__energyDemoAnimate(root));
</script>`

export const chart = `<div class="chart" data-reveal>
  <p class="chart-label">RENEWABLE CAPACITY ADDED · GLOBAL · GW</p>
  <div class="chart-row"><span>2023</span><div class="track"><div class="bar" data-bar style="width:80.85%"></div></div><strong>473</strong></div>
  <div class="chart-row"><span>2024</span><div class="track"><div class="bar accent" data-bar style="width:100%"></div></div><strong>585</strong></div>
  <p class="chart-source">Source: IRENA · Renewable Capacity Statistics 2024 &amp; 2025</p>
</div>`

export const chartMarkdown = `\n${chart}\n${animation}\n`

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

export function fragmentFor(source: string, title: string): string {
  const at = source.indexOf(`# ${title}`) + 2
  const start = Buffer.byteLength(source.slice(0, at))
  const end = start + Buffer.byteLength(title)
  const isEnergy = title === 'Renewable energy' || title === 'The renewable surge'
  const hasChart = isEnergy && source.includes('class="chart"')
  return `<section class="peitho-slide">
    <p class="eyebrow" data-reveal>ENERGY OUTLOOK / ${isEnergy ? '02' : title === 'Energy outlook' ? '01' : '03'}</p>
    <h1 data-reveal><span data-peitho-src="${start}-${end}" data-peitho-md="${escape(title)}">${escape(title)}</span></h1>
    ${hasChart ? chart : `<p class="subtitle" data-reveal>${isEnergy ? 'The next chapter of the energy transition.' : title === 'Energy outlook' ? 'A presentation built with Markdown and HTML.' : "Let's explore the possibilities."}</p><div class="orbit" data-reveal><span>HTML + JavaScript</span><b>Ideas in motion</b></div>`}
    <p class="footer">ENERGY BRIEFING <span>PEITHO STUDIO</span></p>
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
.peitho-slide .chart-row { display: flex; align-items: center; gap: 24px; font-size: 32px; margin: 24px 0; }
.peitho-slide .track { flex: 1; }
.peitho-slide .bar { height: 64px; background: #71b6a1; border-radius: 8px; transform-origin: left; }
.peitho-slide .bar.accent { background: #d7ff85; }
.peitho-slide .chart-row strong { width: 90px; text-align: right; }
.peitho-slide .chart-source { margin-top: 36px; font-size: 18px; color: #91c4b3; }
`
