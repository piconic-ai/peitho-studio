import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export const MAX_COGNITIVE = 15
export const CCCC_VERSION = 'cccc 1.8.5'
const MAX_CYCLOMATIC = 10

function* functions(nodes, path, parent = '') {
  for (const node of nodes) {
    const name = parent ? `${parent} / ${node.name}` : node.name
    yield { ...node, path, name }
    yield* functions(node.children ?? [], path, name)
  }
}

export function measuredFunctions(report) {
  const { summary, files } = report
  if (summary.parse_error_count !== 0) {
    throw new Error(`cccc parse errors: ${JSON.stringify(summary.parse_error_files ?? [])}`)
  }
  if (![summary.file_count, summary.function_count].every(count => Number.isInteger(count) && count > 0)) {
    throw new Error('cccc did not measure any files or functions')
  }
  if (files.length !== summary.file_count) throw new Error('cccc file count does not match its full report')
  const measured = files.flatMap(file => [...functions(file.functions, file.path.replace(/^\.\//, ''))])
  if (measured.length !== summary.function_count) throw new Error('cccc function count does not match its full report')
  for (const node of measured) {
    if (![node.cognitive, node.cyclomatic].every(score => Number.isInteger(score) && score >= 0)) {
      throw new Error(`Invalid complexity scores: ${node.path} ${node.name}`)
    }
  }
  return measured
}

export function summarize(report) {
  const measured = measuredFunctions(report)
  const exceeding = measured.filter(node => node.cognitive > MAX_COGNITIVE)
  exceeding.sort((a, b) => b.cognitive - a.cognitive || b.cyclomatic - a.cyclomatic
    || a.path.localeCompare(b.path) || a.line - b.line)
  const cyclomaticCount = measured.filter(node => node.cyclomatic > MAX_CYCLOMATIC).length
  const fileCount = new Set(exceeding.map(node => node.path)).size
  const lines = ['# Code complexity', '',
    `Measured ${report.summary.file_count} files and ${measured.length} functions. Parse errors: 0.`, '',
    `Cognitive > ${MAX_COGNITIVE}: ${exceeding.length} functions in ${fileCount} files. `
      + `Cyclomatic > ${MAX_CYCLOMATIC} (informational): ${cyclomaticCount} functions.`, '',
    `Any function with cognitive complexity above ${MAX_COGNITIVE} fails CI. No baseline exemptions.`, '',
    '| File | Function | Cognitive | Cyclomatic |',
    '| --- | --- | ---: | ---: |']
  for (const node of exceeding) {
    const name = node.name.replaceAll('|', '\\|')
    lines.push(`| ${node.path}:${node.line} | \`${name}\` | ${node.cognitive} | ${node.cyclomatic} |`)
  }
  return { markdown: lines.join('\n') + '\n', violations: exceeding.length }
}

function measure(root) {
  const options = { cwd: root, encoding: 'utf8' }
  const version = execFileSync('cccc', ['--version'], options).trim()
  if (version !== CCCC_VERSION) throw new Error(`Install ${CCCC_VERSION}; found ${version}`)
  return JSON.parse(execFileSync('cccc', ['--config', resolve(root, 'cccc.toml'), '.'], options))
}

function main() {
  const { values } = parseArgs({ options: {
    'output-dir': { type: 'string', default: 'complexity-results' },
    help: { type: 'boolean', short: 'h' },
  } })
  if (values.help) {
    console.log('Usage: bun run complexity [--output-dir <directory>]')
    return
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const report = measure(root)
  const output = resolve(values['output-dir'])
  mkdirSync(output, { recursive: true })
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report) + '\n')
  let result
  try {
    result = summarize(report)
  } catch (error) {
    result = { markdown: `# Code complexity\n\nMeasurement failed: ${error.message}\n`, violations: 1 }
  }
  writeFileSync(resolve(output, 'summary.md'), result.markdown)
  process.stdout.write(result.markdown)
  process.exitCode = result.violations > 0 ? 1 : 0
}

if (import.meta.main) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
