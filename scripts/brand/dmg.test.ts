import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DMG_APP, DMG_APPLICATIONS, DMG_ICON_SIZE, DMG_WINDOW, dmgArrow, dmgBackgroundSvg } from './dmg'

describe('dmgArrow', () => {
  test('Given the app left of Applications, When the arrow is laid out, Then it runs between the two icons without touching either', () => {
    const a = dmgArrow({ x: 180, y: 170 }, { x: 480, y: 170 }, 128)
    expect(a).toEqual({ x1: 268, x2: 392, y: 170 })
  })

  test('Given Applications left of the app, When the arrow is laid out, Then it refuses (the arrow would point away)', () => {
    expect(() => dmgArrow({ x: 480, y: 170 }, { x: 180, y: 170 }, 128)).toThrow()
    expect(() => dmgArrow({ x: 180, y: 170 }, { x: 180, y: 170 }, 128)).toThrow()
  })

  test('Given icons too close together, When the arrow is laid out, Then it refuses instead of drawing a backwards stub', () => {
    expect(() => dmgArrow({ x: 180, y: 170 }, { x: 330, y: 170 }, 128)).toThrow(/no room/)
  })
})

describe('dmgBackgroundSvg', () => {
  test('Given a caption path, When drawn, Then the picture is the window size and centres the caption', () => {
    const svg = dmgBackgroundSvg({ d: 'M0 0H100', width: 100 })
    expect(svg).toContain(`viewBox="0 0 ${DMG_WINDOW.width} ${DMG_WINDOW.height}"`)
    expect(svg).toContain(`translate(${(DMG_WINDOW.width - 100) / 2}.00 `)
    expect(svg).toContain('d="M0 0H100"')
  })

  test('Given an empty caption, When drawn, Then it still yields a picture with the arrow', () => {
    const svg = dmgBackgroundSvg({ d: '', width: 0 })
    expect(svg).toContain('<rect')
    expect(svg).toContain('M268 170H392')
  })
})

describe('tauri.conf.json', () => {
  test('Given the bundle config, When compared with the picture layout, Then Finder places the icons where the picture expects them', () => {
    const conf = JSON.parse(readFileSync(resolve(import.meta.dir, '../../src-tauri/tauri.conf.json'), 'utf8'))
    const dmg = conf.bundle.macOS.dmg
    expect(dmg.windowSize).toEqual(DMG_WINDOW)
    expect(dmg.appPosition).toEqual(DMG_APP)
    expect(dmg.applicationFolderPosition).toEqual(DMG_APPLICATIONS)
    expect(DMG_ICON_SIZE).toBe(128)
  })
})
