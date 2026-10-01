import { updateHomebrewCask } from './homebrewCask'

const [path, tag, dmg] = process.argv.slice(2)
if (!path || !tag || !dmg) throw new Error('Usage: update-homebrew-cask.ts CASK TAG DMG')
const sha256 = new Bun.CryptoHasher('sha256').update(await Bun.file(dmg).arrayBuffer()).digest('hex')
const current = await Bun.file(path).text()
await Bun.write(path, updateHomebrewCask(current, tag, sha256))
