// Typed boundary around the About window's commands in
// src-tauri/src/about.rs.
import { invoke } from '@tauri-apps/api/core'
import { parseAboutInfo, type AboutInfo, type AboutLink } from '../domain/about'

export interface AboutIpc {
  /** The app's name, version, build and commit. */
  getAboutInfo(): Promise<AboutInfo>
  /** Opens `link` in the default browser. Rust builds the URL. */
  openAboutLink(link: AboutLink): Promise<void>
}

export function createTauriAboutIpc(): AboutIpc {
  return {
    getAboutInfo: async () => parseAboutInfo(await invoke('get_about_info')),
    openAboutLink: async link => { await invoke('open_about_link', { link }) },
  }
}
