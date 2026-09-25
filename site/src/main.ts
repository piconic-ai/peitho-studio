// Entry for the page's BarefootJS islands. The CSR adapter's generate()
// emits nothing on its own, so registering the component (the side-effect
// import) and mounting it happens here, into placeholders the static
// `index.html` already contains. DownloadPanel is mounted twice — the hero
// button and the Download section's list — and shares one release request.
import { render } from '@barefootjs/client/runtime'
import './components/DownloadPanel'

const button = document.getElementById('download-button')
if (button) render(button, 'DownloadPanel', { part: 'button' })

const list = document.getElementById('download-list')
if (list) render(list, 'DownloadPanel', { part: 'list' })
