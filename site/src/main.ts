// Entry for the page's one BarefootJS island. The CSR adapter's generate()
// emits nothing on its own, so registering the component (the side-effect
// import) and mounting it happens here, into the placeholder the static
// `index.html` already contains.
import { render } from '@barefootjs/client/runtime'
import './components/DownloadPanel'

const download = document.getElementById('download-root')
if (download) render(download, 'DownloadPanel', {})
