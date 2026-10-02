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

// The standalone HTML introduction also works as a responsive inline embed.
const intro = document.getElementById('studio-introduction') as HTMLIFrameElement | null
window.addEventListener('message', event => {
  if (!intro || event.origin !== location.origin || event.source !== intro.contentWindow) return
  if (event.data?.type !== 'peitho-tour-height') return
  const height = event.data.height
  if (typeof height === 'number' && Number.isFinite(height) && height >= 200 && height <= 2000) {
    intro.style.height = `${Math.ceil(height)}px`
  }
})
