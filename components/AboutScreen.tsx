'use client'

import { createSignal, onMount, onCleanup } from '@barefootjs/client'
import { createTauriAboutIpc } from '../ipc/aboutIpc'
import { createTauriSettingsIpc } from '../ipc/settingsIpc'
import { createSettingsStore } from '../state/settingsStore'
import { EMPTY_ABOUT_INFO, shortCommit, type AboutInfo, type AboutLink } from '../domain/about'

/** The About window's page (`pages/about.html`), opened from the app menu's
 * "About Peitho Studio" by `src-tauri/src/about.rs`. Every link out goes
 * through `open_about_link`, which opens a URL fixed on the Rust side. */
export function AboutScreen() {
  const aboutIpc = createTauriAboutIpc()
  const settingsIpc = createTauriSettingsIpc()
  // Same language as the Studio windows: the saved choice, or the OS's.
  const settings = createSettingsStore(typeof navigator === 'undefined' ? [] : navigator.languages)
  const [info, setInfo] = createSignal<AboutInfo>(EMPTY_ABOUT_INFO)

  function open(link: AboutLink): void {
    aboutIpc.openAboutLink(link).catch((err: unknown) => { console.error(`failed to open the ${link} link`, err) })
  }

  onMount(() => {
    // Best-effort, like Studio's: on failure the defaults stay in place.
    aboutIpc.getAboutInfo().then(setInfo, () => {})
    settingsIpc.getSettings().then(settings.applyLoaded, () => {})
    settingsIpc.getSystemLocales().then(settings.applySystemLocales, () => {})
    const unlistenSettingsChanged = settingsIpc.onSettingsChanged(settings.applyChanged)
    onCleanup(() => { unlistenSettingsChanged() })
  })

  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 px-8 py-6 text-center select-none">
      <img src="/static/app-icon.svg" alt="" className="block w-24 h-24" />
      <div className="flex flex-col items-center gap-1">
        <h1 data-about="name" className="text-xl font-semibold">{info().name}</h1>
        <p className="text-sm text-muted-foreground">{settings.messages().aboutDescription}</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-right text-muted-foreground">{settings.messages().aboutVersion}</dt>
        <dd data-about="version" className="m-0 text-left font-mono">{info().version}</dd>
        <dt className="text-right text-muted-foreground">{settings.messages().aboutBuild}</dt>
        <dd data-about="build" className="m-0 text-left font-mono">{info().build}</dd>
        {/* Always mounted and hidden when there's no commit (a build
            outside a git checkout) — see CLAUDE.md's BarefootJS pitfalls
            on conditional branches. */}
        <dt hidden={info().commit === ''} className="text-right text-muted-foreground">{settings.messages().aboutCommit}</dt>
        <dd hidden={info().commit === ''} className="m-0 text-left">
          <button
            type="button"
            data-about="commit"
            title={settings.messages().aboutOpenCommit}
            onClick={() => open('commit')}
            className="p-0 bg-transparent border-0 font-mono text-sm text-foreground underline cursor-pointer"
          >
            {shortCommit(info().commit)}
          </button>
        </dd>
      </dl>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-about="website"
          onClick={() => open('website')}
          className="px-4 py-1.5 rounded-md border border-border bg-background text-sm cursor-pointer"
        >
          {settings.messages().aboutWebsite}
        </button>
        <button
          type="button"
          data-about="github"
          onClick={() => open('github')}
          className="px-4 py-1.5 rounded-md border border-border bg-background text-sm cursor-pointer"
        >
          GitHub
        </button>
      </div>
      <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
        <span data-about="copyright">{info().copyright}</span>
        <button
          type="button"
          data-about="license"
          onClick={() => open('license')}
          className="p-0 bg-transparent border-0 text-xs text-muted-foreground underline cursor-pointer"
        >
          {settings.messages().aboutLicense}
        </button>
      </div>
    </div>
  )
}
