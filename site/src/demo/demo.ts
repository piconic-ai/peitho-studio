export {}
// A self-contained product illustration, not a connection to a live agent.
// The editable Markdown, both layouts, and the animated reveal share one source.
const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const markdown = get<HTMLTextAreaElement>('markdown')
const presentation = get('presentation')
const points = get('slide-points')
const request = get('request')
const send = get<HTMLButtonElement>('send')
const playLabel = get('play-label')
const original = markdown.value
const agentPrompt = request.textContent!
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
let controller: AbortController | null = null
let designed = false
let stage: 0 | 1 = 0
let animations: Animation[] = []

function announce(text: string) { get('announcement').textContent = text }
function animate(elements: Element[], delay = 80) {
  animations.forEach(a => a.cancel())
  animations = []
  if (reducedMotion.matches) return
  animations = elements.map((el, index) => el.animate(
    [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)' }],
    { duration: 650, delay: index * delay, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' },
  ))
}
function renderMarkdown() {
  const lines = markdown.value.split('\n')
  const title = lines.find(line => /^#\s/.test(line))?.replace(/^#\s+/, '') ?? ''
  get('slide-title').textContent = title
  const items = lines.filter(line => /^[-*]\s/.test(line)).slice(0, 3)
  points.replaceChildren(...items.map((line, index) => {
    const item = document.createElement('li')
    const number = document.createElement('span')
    number.className = 'point-number'
    number.textContent = `0${index + 1}`
    const text = document.createElement('span')
    text.className = 'point-text'
    text.textContent = line.replace(/^[-*]\s+/, '')
    const arrow = document.createElement('span')
    arrow.className = 'point-arrow'
    arrow.textContent = '↗'
    arrow.setAttribute('aria-hidden', 'true')
    item.append(number, text, arrow)
    return item
  }))
}
function layout(rich: boolean, motion = true) {
  presentation.classList.toggle('rich', rich)
  get('before').setAttribute('aria-pressed', String(!rich))
  get('after').setAttribute('aria-pressed', String(rich))
  get('preview-note').textContent = rich ? 'Your words. A new expression.' : 'Plain text. Your content.'
  if (rich && motion) animate([get('slide-title'), ...points.children, get('layout-mark')])
  else { animations.forEach(a => a.cancel()); animations = [] }
}
function chapter(next: 0 | 1) {
  stage = next
  get('write-panel').hidden = next !== 0
  get('agent-panel').hidden = next !== 1
  get('step-write').setAttribute('aria-current', next === 0 ? 'step' : 'false')
  get('step-design').setAttribute('aria-current', next === 1 ? 'step' : 'false')
  get('chapter').textContent = next === 0 ? '01 — YOUR WORDS' : '02 — A LITTLE HELP WITH THE LOOK'
  get('story-title').textContent = next === 0 ? 'Edit the words. See the slide.' : 'Ask for a beautiful arrangement.'
  get('story-description').textContent = next === 0
    ? 'Write in Markdown. Your preview follows as you type.'
    : 'Leave a comment. Your AI Agent can refine the HTML layout.'
  get('preview-status').textContent = next === 0 ? 'Updates as you type' : 'HTML + CSS + JavaScript'
  get('comparison').hidden = !designed || next === 0
  layout(next === 1 && designed, false)
}
function stop() {
  controller?.abort()
  controller = null
  playLabel.textContent = 'Replay the story'
  get('play').setAttribute('aria-label', 'Replay the story')
  request.textContent = agentPrompt
  send.disabled = designed
  send.textContent = designed ? 'Layout updated ✓' : 'Send to Agent ↗'
}
function finishDesign() {
  designed = true
  send.disabled = true
  send.textContent = 'Layout updated ✓'
  get('response').hidden = false
  get('comparison').hidden = false
  layout(true)
  announce('The layout is ready. Your words are unchanged. Compare Before and After.')
}
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return }
  const abort = () => { clearTimeout(timer); reject(signal.reason) }
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
  signal.addEventListener('abort', abort, { once: true })
})
async function runDesign(signal: AbortSignal) {
  send.disabled = true
  send.textContent = 'Refining the layout…'
  await wait(reducedMotion.matches ? 200 : 1100, signal)
  finishDesign()
}
async function play() {
  if (controller) { stop(); return }
  controller = new AbortController()
  const signal = controller.signal
  designed = false
  get('response').hidden = true
  send.disabled = false
  send.textContent = 'Send to Agent ↗'
  markdown.value = original
  renderMarkdown()
  chapter(0)
  playLabel.textContent = 'Stop the story'
  get('play').setAttribute('aria-label', 'Stop the story')
  try {
    await wait(1300, signal)
    const title = '# Meet Peitho Studio'
    if (reducedMotion.matches) {
      markdown.value = original.replace('# Peitho Studio', title)
      renderMarkdown()
    } else {
      for (let n = 2; n <= title.length; n++) {
        markdown.value = original.replace('# Peitho Studio', title.slice(0, n))
        renderMarkdown()
        await wait(65, signal)
      }
    }
    await wait(2300, signal)
    chapter(1)
    request.textContent = ''
    for (let n = 1; n <= agentPrompt.length; n++) {
      request.textContent = agentPrompt.slice(0, n)
      await wait(reducedMotion.matches ? 0 : 17, signal)
    }
    await wait(1000, signal)
    await runDesign(signal)
    await wait(2200, signal)
    await wait(1800, signal)
    await wait(1400, signal)
    controller = null
    playLabel.textContent = 'Replay the story'
    get('play').setAttribute('aria-label', 'Replay the story')
  } catch (error) { if (!signal.aborted) throw error }
}
markdown.addEventListener('input', () => { stop(); renderMarkdown() })
get('step-write').addEventListener('click', () => { stop(); chapter(0) })
get('step-design').addEventListener('click', () => { stop(); chapter(1) })
get('before').addEventListener('click', () => { stop(); layout(false); announce('Original layout') })
get('after').addEventListener('click', () => { stop(); layout(true); announce('Refined layout') })
get('play').addEventListener('click', () => { void play() })
send.addEventListener('click', async () => {
  stop()
  controller = new AbortController()
  const signal = controller.signal
  try { await runDesign(signal); controller = null } catch (error) { if (!signal.aborted) throw error }
})
document.addEventListener('visibilitychange', () => { if (document.hidden) stop() })
reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) animations.forEach(a => a.finish()) })
// Keep the site's embed fitted to the slide content, including its mobile layout.
new ResizeObserver(() => {
  if (window.parent !== window) window.parent.postMessage({ type: 'peitho-tour-height', height: Math.ceil(document.querySelector('.tour')!.getBoundingClientRect().height) }, location.origin)
}).observe(document.querySelector('.tour')!)
renderMarkdown()
chapter(stage)
