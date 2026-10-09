import { describe, expect, test } from 'bun:test'
import { errorBarAction } from './errorBar'

describe('errorBarAction', () => {
  test('spec: Given typing that does not build, Then the bar offers to send it, whatever was reported before', () => {
    expect(errorBarAction('transient-build', 'idle', 'none')).toBe('send')
    expect(errorBarAction('transient-build', 'sent', 'working')).toBe('send')
    expect(errorBarAction('transient-build', 'waiting-for-agent', 'waiting')).toBe('send')
  })

  test('spec: Given the deck on disk does not build and nothing was sent, Then the bar offers to send it', () => {
    expect(errorBarAction('deck-build', 'idle', 'waiting')).toBe('send')
    expect(errorBarAction('deck-build', 'waiting-for-agent', 'none')).toBe('send')
    expect(errorBarAction('deck-build', 'send-failed', 'working')).toBe('send')
  })

  test('spec: Given the disk\'s errors were sent and the AI is at work, Then the bar says the AI is fixing', () => {
    expect(errorBarAction('deck-build', 'sent', 'working')).toBe('fixing')
  })

  test('spec: Given the disk\'s errors were sent and the AI is back waiting with the error still there, Then the bar offers to send again', () => {
    expect(errorBarAction('deck-build', 'sent', 'waiting')).toBe('send')
  })

  test('adversarial: Given the errors were sent but the AI\'s crit is gone, Then nobody is fixing — the bar offers to send', () => {
    expect(errorBarAction('deck-build', 'sent', 'none')).toBe('send')
  })

  test('spec: Given an error that is not a build error, Then it is copied, whatever the AI is doing', () => {
    expect(errorBarAction('transient-other', 'idle', 'none')).toBe('copy')
    expect(errorBarAction('transient-other', 'sent', 'working')).toBe('copy')
  })
})
