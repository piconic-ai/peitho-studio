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
