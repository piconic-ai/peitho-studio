// Enforces docs/architecture.md's layer dependency direction
// (components -> state -> domain, components -> ipc, components -> dom ->
// domain) by scanning each layer's source for imports/globals the layer
// isn't allowed to use. Deliberately pattern-based rather than a real
// module-graph analysis — cheap, dependency-free, and precise enough to
// catch the mistake this guards against (an AI agent, or a human in a
// hurry, reaching for `invoke`/`document`/`@tauri-apps` from the wrong
// layer). Patterns match actual usage (`window.`, `from '@tauri-apps...'`)
// rather than bare words, so prose mentioning "window" in a comment
// doesn't trip it.
import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')

interface LayerRule {
  dir: string
  description: string
  forbidden: readonly { pattern: RegExp; reason: string }[]
}

const RULES: readonly LayerRule[] = [
  {
    dir: 'domain',
    description: 'pure logic — no framework, no Tauri, no DOM',
    forbidden: [
      { pattern: /from\s+['"]@barefootjs\/client/, reason: "imports '@barefootjs/client' (signals belong in state/)" },
      { pattern: /from\s+['"]@tauri-apps/, reason: "imports '@tauri-apps/*' (belongs in ipc/)" },
      { pattern: /\bdocument\./, reason: 'touches `document.` (belongs in dom/)' },
      { pattern: /\bwindow\./, reason: 'touches `window.` (belongs in dom/)' },
    ],
  },
  {
    dir: 'state',
    description: 'signals/stores — no Tauri, no DOM',
    forbidden: [
      { pattern: /from\s+['"]@tauri-apps/, reason: "imports '@tauri-apps/*' (belongs in ipc/)" },
      { pattern: /\bdocument\./, reason: 'touches `document.` (belongs in dom/)' },
      { pattern: /\bwindow\./, reason: 'touches `window.` (belongs in dom/)' },
    ],
  },
  {
    dir: 'ipc',
    description: 'typed IPC wrappers — no signals',
    forbidden: [
      { pattern: /\bcreateSignal\s*\(/, reason: 'calls `createSignal(` (belongs in state/)' },
      { pattern: /\bcreateEffect\s*\(/, reason: 'calls `createEffect(` (belongs in state/)' },
    ],
  },
]

function listSourceFiles(dir: string): string[] {
  const abs = join(ROOT, dir)
  if (!existsSync(abs)) return []
  return readdirSync(abs, { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx'))
    .map(entry => join(entry.parentPath, entry.name))
}

describe('architecture layering (docs/architecture.md)', () => {
  for (const rule of RULES) {
    test(`spec: ${rule.dir}/ stays "${rule.description}"`, () => {
      const violations: string[] = []
      for (const file of listSourceFiles(rule.dir)) {
        const content = readFileSync(file, 'utf-8')
        const relPath = file.slice(ROOT.length + 1)
        for (const { pattern, reason } of rule.forbidden) {
          if (pattern.test(content)) violations.push(`${relPath}: ${reason}`)
        }
      }
      expect(violations).toEqual([])
    })
  }

  test('adversarial: a layer directory that does not exist yet reports no violations (not a crash)', () => {
    expect(listSourceFiles('this-directory-does-not-exist')).toEqual([])
  })
})
