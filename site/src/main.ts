// Entry for the page's two BarefootJS islands. The CSR adapter's generate()
// emits nothing on its own, so registering the components (the side-effect
// imports) and mounting them happens here, into placeholders the static
// `index.html` already contains — everything else on the page is plain HTML.
import { render } from '@barefootjs/client/runtime'
import './components/DownloadPanel'
import './components/FeatureTour'

const download = document.getElementById('download-root')
if (download) render(download, 'DownloadPanel', {})

const tour = document.getElementById('tour-root')
if (tour) render(tour, 'FeatureTour', {})

// The download panel's "Build from source" fallback button links to
// `#build`, a <details>; jumping to a collapsed one shows only its summary,
// so open it whenever the hash points at it.
const openBuild = () => {
  if (location.hash !== '#build') return
  const details = document.getElementById('build') as HTMLDetailsElement | null
  if (details) details.open = true
}
openBuild()
window.addEventListener('hashchange', openBuild)
