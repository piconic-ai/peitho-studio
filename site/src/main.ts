// Entry for the page's BarefootJS islands. The CSR adapter's generate()
// emits nothing on its own, so registering the component (the side-effect
// import) and mounting it happens here, into placeholders the static
// `index.html` already contains. DownloadPanel lists release files beneath
// the Homebrew installation instructions.
// Charis SIL, the face of the Peitho Studio wordmark (brand/), for the
// page's headings. Latin only; Vite emits it as a hashed file with a <link>.
import '@fontsource/charis-sil/latin-400.css'
import { render } from '@barefootjs/client/runtime'
import './components/DownloadPanel'

const list = document.getElementById('download-list')
if (list) render(list, 'DownloadPanel', {})

// Veil the demo's poster (see .window-media in site.css) until it plays.
const media = document.getElementById('demo-media')
const video = document.getElementById('demo-video') as HTMLVideoElement | null
if (media && video) {
  const sync = () => media.classList.toggle('is-idle', video.paused)
  for (const type of ['play', 'playing', 'pause', 'ended']) video.addEventListener(type, sync)
  sync()
}
