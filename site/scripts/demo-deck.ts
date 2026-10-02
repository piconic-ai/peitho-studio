// Peitho Studio's own introduction, rendered inside the unchanged Studio UI.
// The simulated agent changes only the layout metadata; the words stay Markdown.
export const source = `<!-- {"key":"cover"} -->
# Your ideas, in slides

Write them down. See them take shape.

---

<!-- {"key":"studio","layout":"plain"} -->
# Peitho Studio

- Write in Markdown
- See changes instantly
- Refine with your AI Agent

---

<!-- {"key":"files"} -->
# Your words stay yours

Plain Markdown and HTML. Edit with the tools you choose.
`

const animation = `<script>
if (!window.__studioIntroAnimate) {
  window.__studioIntroAnimate = root => {
    const slide = root.querySelector('.peitho-slide.swiss');
    if (!slide || slide.dataset.animated) return;
    slide.dataset.animated = 'true';
    slide.querySelectorAll('[data-reveal]').forEach((el, i) => {
      el.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 700, delay: i * 160, fill: 'backwards', easing: 'cubic-bezier(.2,.8,.2,1)' });
    });
  };
  document.addEventListener('peitho:shadow-mounted', event => window.__studioIntroAnimate(event.detail.root));
}
(window.__peithoShadowRoots || []).forEach(({root}) => window.__studioIntroAnimate(root));
</script>`

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

export function fragmentFor(source: string, title: string): string {
  const at = source.indexOf(`# ${title}`) + 2
  const start = Buffer.byteLength(source.slice(0, at))
  const end = start + Buffer.byteLength(title)
  const isIntro = title === 'Peitho Studio' || title === 'Meet Peitho Studio'
  const swiss = isIntro && source.includes('"layout":"swiss"')
  const heading = `<h1 data-reveal><span data-peitho-src="${start}-${end}" data-peitho-md="${escape(title)}">${escape(title)}</span></h1>`
  const words = ['Write in Markdown', 'See changes instantly', 'Refine with your AI Agent']
  const content = isIntro ? `<ul class="features">${words.map(word => `<li data-reveal>${word}</li>`).join('')}</ul>`
    : `<p>${title === 'Your words stay yours' ? 'Plain Markdown and HTML.<br>Edit with the tools you choose.' : 'Write them down.<br>See them take shape.'}</p>`
  return `<section class="peitho-slide ${swiss ? 'swiss' : ''}">
    ${heading}${content}
    ${swiss ? animation : ''}
  </section>`
}

export const css = `
.peitho-slide { width: var(--peitho-canvas-width,1280px); height: var(--peitho-canvas-height,720px); box-sizing: border-box; padding: 88px 88px; background: #fff; color: #202520; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; position: relative; overflow: hidden; }
.peitho-slide h1 { font-size: 72px; line-height: 1.1; letter-spacing: -.04em; margin: 0 0 56px; position: relative; z-index: 1; }
.peitho-slide p { font-size: 40px; line-height: 1.5; }
.features { padding-left: 1.2em; margin: 0; font-size: 40px; line-height: 1.9; position: relative; z-index: 1; }
.peitho-slide.swiss { background: #faf9f5; color: #171717; padding: 72px; font-family: "Helvetica Neue",Helvetica,Arial,sans-serif; }
.swiss::before { content: ""; position: absolute; inset: 0 0 0 auto; width: 35%; background: #df3526; }
.swiss h1 { max-width: 730px; font-weight: 700; font-size: 120px; line-height: .96; letter-spacing: -.065em; margin: 0; }
.swiss .features { position: absolute; left: 72px; right: 72px; top: 432px; display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 40px; list-style: none; font-size: 44px; font-weight: 500; line-height: 1.12; letter-spacing: -.035em; padding: 0; margin: 0; }
.swiss li { border-top: 2px solid currentColor; padding: 28px 16px 0 0; }
.swiss li:last-child { color: #fff; }
`
