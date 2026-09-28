import { describe, expect, test } from 'bun:test'
import { EMPTY_ABOUT_INFO, parseAboutInfo, shortCommit } from './about'

const SHA = '5995c42a1b2c3d4e5f60718293a4b5c6d7e8f901'

describe('parseAboutInfo', () => {
  test('spec: Given the answer get_about_info sends, when read, then every field comes through as sent', () => {
    const raw = { name: 'Peitho Studio', version: '0.1.0', build: '42', commit: SHA, copyright: 'Copyright (c) 2026 kfly8' }
    expect(parseAboutInfo(raw)).toEqual(raw)
  })

  test('spec: Given a local build with no commit, when read, then build and commit come through as sent', () => {
    const info = parseAboutInfo({ name: 'Peitho Studio', version: '0.1.0', build: 'dev', commit: '', copyright: '' })
    expect(info.build).toBe('dev')
    expect(info.commit).toBe('')
  })

  test('adversarial: Given an answer that is not an object, when read, then the window shows its empty defaults', () => {
    for (const raw of [null, undefined, 'Peitho Studio', 42, true, []]) {
      expect(parseAboutInfo(raw)).toEqual(EMPTY_ABOUT_INFO)
    }
  })

  test('adversarial: Given fields of the wrong type, when read, then only those fields fall back and the rest are kept', () => {
    const info = parseAboutInfo({ name: 7, version: '0.1.0', build: null, commit: { sha: SHA }, copyright: ['x'], extra: 'ignored' })
    expect(info).toEqual({ name: EMPTY_ABOUT_INFO.name, version: '0.1.0', build: '', commit: '', copyright: '' })
  })
})

describe('shortCommit', () => {
  test('spec: Given a full SHA, when shortened, then its first seven characters are shown', () => {
    expect(shortCommit(SHA)).toBe('5995c42')
  })

  test('adversarial: Given no commit, when shortened, then nothing is shown', () => {
    expect(shortCommit('')).toBe('')
    expect(shortCommit('  \n')).toBe('')
  })

  test('adversarial: Given a SHA shorter than seven characters, when shortened, then all of it is shown', () => {
    expect(shortCommit('abc')).toBe('abc')
    expect(shortCommit('5995c42')).toBe('5995c42')
  })

  test('adversarial: Given a SHA with surrounding whitespace, when shortened, then the whitespace is dropped first', () => {
    expect(shortCommit(`\n ${SHA}\n`)).toBe('5995c42')
  })
})
