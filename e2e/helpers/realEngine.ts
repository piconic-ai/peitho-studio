import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

/** Built by `cargo build --example e2e_engine` (in `src-tauri/`). */
export const REAL_ENGINE_BIN = join(import.meta.dirname, '../../src-tauri/target/debug/examples/e2e_engine')

export const realEngineAvailable = (): boolean => existsSync(REAL_ENGINE_BIN)

/** One long-lived engine process answering `invoke_for_e2e`'s commands
 * (src-tauri/src/peitho.rs) in request order, as a real session's reach
 * peitho-core. `newDeck` scaffolds a deck as New Deck does. */
export function startRealEngine(): { invoke: (deckPath: string, cmd: string, args: Record<string, unknown>) => Promise<unknown>; newDeck: (parentDir: string) => Promise<string>; stop: () => void } {
  const child = spawn(REAL_ENGINE_BIN, [], { stdio: ['pipe', 'pipe', 'inherit'] })
  const waiting: { resolve: (value: unknown) => void; reject: (err: Error) => void }[] = []
  createInterface({ input: child.stdout }).on('line', line => {
    const reply = JSON.parse(line) as { ok?: unknown; err?: string }
    const next = waiting.shift()
    if (reply.err === undefined) next?.resolve(reply.ok)
    else next?.reject(new Error(reply.err))
  })
  const invoke = (deckPath: string, cmd: string, args: Record<string, unknown>) => new Promise<unknown>((resolve, reject) => {
    waiting.push({ resolve, reject })
    child.stdin.write(JSON.stringify({ deckPath, cmd, args }) + '\n')
  })
  return {
    invoke,
    newDeck: async parentDir => await invoke('', 'create_deck', { parentDir, name: 'deck' }) as string,
    stop: () => { child.kill() },
  }
}
