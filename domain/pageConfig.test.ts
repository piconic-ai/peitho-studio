import { describe, expect, test } from 'bun:test'
import { parsePageComment, configOf, serializePageConfig, type PageConfig } from './pageConfig'

describe('parsePageComment', () => {
  test('spec: null body means no comment was found at all', () => {
    expect(parsePageComment(null)).toEqual({ kind: 'absent' })
  })

  test('spec: valid JSON parses into an `ok` config', () => {
    expect(parsePageComment('{"key":"cover","layout":"cover"}')).toEqual({
      kind: 'ok',
      config: { key: 'cover', layout: 'cover' },
    })
  })

  test('spec: section/time are independent optional string fields, not a nested pair', () => {
    const result = parsePageComment('{"section":"Intro","time":"1m"}')
    expect(result).toEqual({ kind: 'ok', config: { section: 'Intro', time: '1m' } })
  })

  test('adversarial: malformed JSON is preserved as `malformed`, not silently swallowed', () => {
    expect(parsePageComment('{not json}')).toEqual({ kind: 'malformed', raw: '{not json}' })
  })

  test('adversarial: an empty string is malformed, not absent', () => {
    expect(parsePageComment('')).toEqual({ kind: 'malformed', raw: '' })
  })

  test('adversarial: a JSON array (valid JSON, not an object) round-trips as `ok` with an array "config" — parsePageComment does not validate shape', () => {
    // Documents current behavior rather than prescribing it: JSON.parse
    // succeeds on `[1,2,3]`, and this function doesn't runtime-check the
    // result against PageConfig's shape (that's a static type, not a
    // validator). extractPageComment's own regex already guarantees the
    // body starts with `{` before this is ever called in practice.
    expect(parsePageComment('[1,2,3]')).toEqual({ kind: 'ok', config: [1, 2, 3] as unknown as PageConfig })
  })
})

describe('configOf', () => {
  test('spec: unwraps an `ok` result to its config', () => {
    expect(configOf({ kind: 'ok', config: { key: 'a' } })).toEqual({ key: 'a' })
  })

  test('adversarial: `absent` and `malformed` both fall back to an empty config', () => {
    expect(configOf({ kind: 'absent' })).toEqual({})
    expect(configOf({ kind: 'malformed', raw: '{oops}' })).toEqual({})
  })
})

describe('serializePageConfig', () => {
  test('spec: serializes to compact JSON', () => {
    expect(serializePageConfig({ key: 'a', draft: true })).toBe('{"key":"a","draft":true}')
  })

  test('adversarial: an empty config serializes to `{}`, not an empty string', () => {
    expect(serializePageConfig({})).toBe('{}')
  })

  test('adversarial: round-trips through parsePageComment', () => {
    const config: PageConfig = { key: 'a', section: 'Intro', time: '1m', draft: true, skip: false, page_number: true, layout: 'cover' }
    expect(configOf(parsePageComment(serializePageConfig(config)))).toEqual(config)
  })
})
