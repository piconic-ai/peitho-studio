import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { CCCC_VERSION, measuredFunctions, summarize } from './complexity.js'

function node(name, cognitive, cyclomatic, extra = {}) {
  return { name, line: 1, cognitive, cyclomatic, ...extra }
}

function report(nodes, summary = {}) {
  return {
    files: [{ path: './example.js', functions: nodes }],
    summary: { file_count: 1, function_count: nodes.length, parse_error_count: 0, ...summary },
  }
}

function run(data, { version = CCCC_VERSION, args = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'complexity-js-'))
  try {
    mkdirSync(join(root, 'scripts'))
    copyFileSync(new URL('./complexity.js', import.meta.url), join(root, 'scripts/complexity.js'))
    writeFileSync(join(root, 'cccc.toml'), '')
    writeFileSync(join(root, 'cccc'), '#!/bin/sh\nif [ "$1" = "--version" ]; then\n'
      + '  printf "%s\\n" "$CCCC_VERSION"\nelse\n  printf "%s\\n" "$CCCC_REPORT"\nfi\n', { mode: 0o755 })
    const result = spawnSync(process.execPath, ['run', 'scripts/complexity.js', '--output-dir', 'results', ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: root + delimiter + dirname(process.execPath) + delimiter + process.env.PATH,
        CCCC_VERSION: version, CCCC_REPORT: JSON.stringify(data) },
    })
    expect(result.error).toBeUndefined()
    if (version !== CCCC_VERSION || args.length > 0) return result
    return { ...result,
      report: JSON.parse(readFileSync(join(root, 'results/report.json'), 'utf8')),
      summary: readFileSync(join(root, 'results/summary.md'), 'utf8'),
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('cognitive gate', () => {
  test('counts each nested function once, qualifies names and normalizes paths', () => {
    const data = report([
      node('parent', 0, 11, { children: [node('child|name', 16, 1)] }),
      node('other', 17, 11),
    ], { function_count: 3 })
    expect(measuredFunctions(data).map(value => value.name)).toEqual(['parent', 'parent / child|name', 'other'])
    const result = summarize(data)
    expect(result.violations).toBe(2)
    expect(result.markdown).toContain('Measured 1 files and 3 functions. Parse errors: 0.')
    expect(result.markdown).toContain('Cognitive > 15: 2 functions in 1 files.')
    expect(result.markdown).toContain('Cyclomatic > 10 (informational): 2 functions.')
    expect(result.markdown).toContain('| example.js:1 | `parent / child\\|name` | 16 | 1 |')
    expect(result.markdown).not.toContain('| `parent` |')
  })

  test('accepts cognitive 15 regardless of cyclomatic and rejects 16', () => {
    expect(summarize(report([node('boundary', 15, 999)])).violations).toBe(0)
    expect(summarize(report([node('over', 16, 0)])).violations).toBe(1)
  })

  test.each([
    report([], { file_count: 0 }),
    report([]),
    report([node('partial', 0, 1)], { file_count: 2 }),
    report([node('partial', 0, 1)], { function_count: 2 }),
    report([], { parse_error_count: 1 }),
    report([node('bad', undefined, 1)]),
    report([node('bad', -1, 1)]),
    report([node('bad', 0, 'high')]),
    { files: [] },
  ])('rejects an invalid or incomplete report %#', data => {
    expect(() => summarize(data)).toThrow()
  })
})

describe('command', () => {
  test('passes without any baseline file and still writes both metrics', () => {
    const data = report([node('boundary', 15, 999)])
    const result = run(data)
    expect(result.status).toBe(0)
    expect(result.report).toEqual(data)
    expect(result.summary).toContain('Cognitive > 15: 0 functions in 0 files.')
    expect(result.summary).toContain('Cyclomatic > 10 (informational): 1 functions.')
    expect(result.stdout).toBe(result.summary)
  })

  test('fails on any cognitive exceedance and retains reports', () => {
    const data = report([node('over', 16, 0)])
    const result = run(data)
    expect(result.status).toBe(1)
    expect(result.report).toEqual(data)
    expect(result.summary).toContain('| example.js:1 | `over` | 16 | 0 |')
    expect(result.summary).toContain('No baseline exemptions.')
  })

  test('fails on parse errors and retains a diagnostic summary and raw report', () => {
    const data = report([], { parse_error_count: 1, parse_error_files: ['broken.js'] })
    const result = run(data)
    expect(result.status).toBe(1)
    expect(result.report).toEqual(data)
    expect(result.summary).toContain('Measurement failed: cccc parse errors: ["broken.js"]')
  })

  test('fails on partial reports instead of treating missing functions as success', () => {
    const result = run(report([node('partial', 0, 1)], { function_count: 2 }))
    expect(result.status).toBe(1)
    expect(result.summary).toContain('function count does not match')
  })

  test('rejects another cccc version', () => {
    const result = run(report([node('plain', 0, 1)]), { version: 'cccc 0.0.0' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`Install ${CCCC_VERSION}; found cccc 0.0.0`)
  })

  test('rejects the removed baseline refresh option', () => {
    const result = run(report([node('plain', 0, 1)]), { args: ['--update-baseline'] })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('--update-baseline')
  })
})
