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
    const slide = root.querySelector('.peitho-slide.rich');
    if (!slide || slide.dataset.animated) return;
    slide.dataset.animated = 'true';
    slide.querySelectorAll('[data-reveal]').forEach((el, i) => {
      el.animate([{ opacity: 0, transform: 'translateY(30px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 1000, delay: i * 200, fill: 'backwards', easing: 'cubic-bezier(.2,.8,.2,1)' });
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
  const rich = isIntro && source.includes('"layout":"feature-cards"')
  const heading = `<h1 data-reveal><span data-peitho-src="${start}-${end}" data-peitho-md="${escape(title)}">${escape(title)}</span></h1>`
  const words = ['Write in Markdown', 'See changes instantly', 'Refine with your AI Agent']
  const content = isIntro ? `<ul class="features">${words.map((word, i) => `<li data-reveal><span class="number">0${i + 1}</span><span class="feature">${word}</span><span class="arrow">↗</span></li>`).join('')}</ul>`
    : `<p>${title === 'Your words stay yours' ? 'Plain Markdown and HTML.<br>Edit with the tools you choose.' : 'Write them down.<br>See them take shape.'}</p>`
  return `<section class="peitho-slide ${rich ? 'rich' : ''}">
    ${rich ? '<div class="rings" aria-hidden="true"><i></i><i></i><i></i></div><p class="kicker" data-reveal>A DESKTOP EDITOR FOR PEITHO</p>' : ''}
    ${heading}${content}
    ${rich ? '<footer><span>YOUR WORDS. YOUR SLIDES.</span><span>MARKDOWN + HTML</span></footer>' + animation : ''}
  </section>`
}

export const css = `
.peitho-slide { width: var(--peitho-canvas-width,1280px); height: var(--peitho-canvas-height,720px); box-sizing: border-box; padding: 88px 88px; background: #fff; color: #202520; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; position: relative; overflow: hidden; }
.peitho-slide h1 { font-size: 72px; line-height: 1.1; letter-spacing: -.04em; margin: 0 0 56px; position: relative; z-index: 1; }
.peitho-slide p { font-size: 40px; line-height: 1.5; }
.features { padding-left: 1.2em; margin: 0; font-size: 40px; line-height: 1.9; position: relative; z-index: 1; }
.number, .arrow { display: none; }
.peitho-slide.rich { background: #173c34; color: #f8f8e9; padding: 62px 80px; }
.rich .kicker { font-size: 18px; letter-spacing: .12em; margin: 0 0 32px; color: #b6c8aa; }
.rich h1 { font-family: Georgia,serif; font-weight: 400; font-size: 80px; margin: 0 0 48px; }
.rich .features { list-style: none; display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 24px; padding: 0; line-height: 1.2; }
.rich li { min-height: 276px; padding: 32px; display: flex; flex-direction: column; background: #e9efdc; color: #254235; border-radius: 6px; position: relative; }
.rich li:nth-child(2) { background: #d1dfb9; }
.rich li:nth-child(3) { background: #b6ce91; }
.rich .number { display: block; font: 400 60px/1 Georgia,serif; opacity: .55; margin-bottom: 46px; }
.rich .feature { display: block; font-size: 36px; font-weight: 500; }
.rich .arrow { display: block; position: absolute; top: 32px; right: 28px; font-size: 32px; opacity: .6; }
.rich footer { display: flex; justify-content: space-between; margin-top: 40px; color: #b6c8aa; font-size: 16px; letter-spacing: .1em; }
.rings { position: absolute; inset: 0; pointer-events: none; }
.rings i { position: absolute; width: 500px; height: 500px; border: 1px solid #94b38d25; border-radius: 50%; top: -120px; right: -90px; }
.rings i:nth-child(2) { right: 10px; top: -200px; }
.rings i:nth-child(3) { right: 110px; top: -280px; }
`
