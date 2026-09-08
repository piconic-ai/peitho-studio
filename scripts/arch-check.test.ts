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
      { pattern: /from\s+['"].*\/ipc\//, reason: "imports from ipc/ (domain/ has zero dependencies; ipc/ imports FROM domain/, never the reverse)" },
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
  {
    dir: 'components',
    description: 'JSX composition — Tauri IPC only through ipc/, never inline',
    forbidden: [
      { pattern: /from\s+['"]@tauri-apps\/api\/core['"]/, reason: "imports '@tauri-apps/api/core' directly (invoke calls belong in ipc/)" },
      { pattern: /from\s+['"]@tauri-apps\/api\/event['"]/, reason: "imports '@tauri-apps/api/event' directly (listen calls belong in ipc/)" },
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

/** A file can opt out of a specific forbidden pattern with a top-of-file
 * `// arch-check-allow: <pattern source>` comment plus a reason on the
 * next line — for the rare case where the match is a false positive, not
 * an actual layer violation. E.g. previewDoc.ts (domain/) builds an HTML
 * document whose *embedded <script>* references `document`/`window` —
 * those run inside an iframe, never in this file's own execution
 * context, so the pattern matching the literal text isn't a real
 * violation. A bare exclusion list would silently stop protecting a file
 * the moment unrelated code was added to it; requiring the exact pattern
 * source keeps the allowance scoped to what was actually reviewed. */
export function allowedPatterns(content: string): Set<string> {
  const allowed = new Set<string>()
  const re = /^\/\/ arch-check-allow: (.+)$/gm
  for (const match of content.matchAll(re)) allowed.add(match[1])
  return allowed
}

describe('architecture layering (docs/architecture.md)', () => {
  for (const rule of RULES) {
    test(`spec: ${rule.dir}/ stays "${rule.description}"`, () => {
      const violations: string[] = []
      for (const file of listSourceFiles(rule.dir)) {
        const content = readFileSync(file, 'utf-8')
        const relPath = file.slice(ROOT.length + 1)
        const allowed = allowedPatterns(content)
        for (const { pattern, reason } of rule.forbidden) {
          if (pattern.test(content) && !allowed.has(pattern.source)) violations.push(`${relPath}: ${reason}`)
        }
      }
      expect(violations).toEqual([])
    })
  }

  test('adversarial: a layer directory that does not exist yet reports no violations (not a crash)', () => {
    expect(listSourceFiles('this-directory-does-not-exist')).toEqual([])
  })
})

describe('allowedPatterns', () => {
  test('spec: extracts the pattern source from an arch-check-allow comment', () => {
    expect(allowedPatterns('// arch-check-allow: \\bwindow\\.\n// reason here\ncode')).toEqual(new Set(['\\bwindow\\.']))
  })

  test('spec: extracts multiple allowances from the same file', () => {
    const content = '// arch-check-allow: \\bwindow\\.\n// arch-check-allow: \\bdocument\\.\ncode'
    expect(allowedPatterns(content)).toEqual(new Set(['\\bwindow\\.', '\\bdocument\\.']))
  })

  test('adversarial: a file with no allow comments yields an empty set', () => {
    expect(allowedPatterns('just some code\n// a regular comment')).toEqual(new Set())
  })

  test('adversarial: an allowance only silences the exact pattern it names, not other forbidden patterns in the same file', () => {
    const content = '// arch-check-allow: \\bwindow\\.\nwindow.foo(); document.bar()'
    const allowed = allowedPatterns(content)
    expect(allowed.has(/\bwindow\./.source)).toBe(true)
    expect(allowed.has(/\bdocument\./.source)).toBe(false)
  })
})
