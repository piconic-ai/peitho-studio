import { makeUpdateManifest, type SecurityAdvisory } from './updateManifest'
const [version, archive, notesFile, destination] = process.argv.slice(2)
if (!version || !archive || !notesFile || !destination) throw new Error('Usage: create-update-manifest.ts VERSION ARCHIVE NOTES_FILE DESTINATION')
const security = await Bun.file('meta/update-security.json').json() as SecurityAdvisory[]
const name = archive.split('/').at(-1)!
const url = `https://github.com/piconic-ai/peitho-studio/releases/download/v${version}/${encodeURIComponent(name)}`
const manifest = makeUpdateManifest(version, await Bun.file(`${archive}.sig`).text(), url, await Bun.file(notesFile).text(), security)
await Bun.write(destination, JSON.stringify(manifest, null, 2) + '\n')
