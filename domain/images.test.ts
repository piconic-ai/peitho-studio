import { describe, expect, test } from 'bun:test'
import { fileNameOf, isImageMime, isImportableImagePath, partitionDroppedPaths, pastedImageExtension, pastedImageName } from './images'

describe('isImportableImagePath', () => {
  test('spec: Given each image type Peitho can show, when a file of it is dropped, then it is imported', () => {
    for (const path of ['/d/a.png', '/d/a.jpg', '/d/a.jpeg', '/d/a.gif', '/d/a.webp']) {
      expect(isImportableImagePath(path)).toBe(true)
    }
  })

  test('spec: Given an uppercase extension, when a file is dropped, then it still counts as an image', () => {
    expect(isImportableImagePath('/Users/me/Desktop/Photo.PNG')).toBe(true)
    expect(isImportableImagePath('C:\\pics\\SHOT.JpEg')).toBe(true)
  })

  test('adversarial: Given an SVG, a TIFF or a file that is not an image, when dropped, then it is not imported', () => {
    for (const path of ['/d/diagram.svg', '/d/scan.tiff', '/d/notes.txt', '/d/deck.md', '/d/photo.heic']) {
      expect(isImportableImagePath(path)).toBe(false)
    }
  })

  test('adversarial: Given a name whose only image-like part is not the last extension, when dropped, then only the last one counts', () => {
    expect(isImportableImagePath('/d/a.png.zip')).toBe(false)
    expect(isImportableImagePath('/d/a.tar.png')).toBe(true)
  })

  test('adversarial: Given a folder named like an image, a bare name, no extension or an empty path, when checked, then nothing crashes', () => {
    expect(isImportableImagePath('/d/png')).toBe(false)
    expect(isImportableImagePath('/d/pictures.png/')).toBe(false)
    expect(isImportableImagePath('/d.png/readme')).toBe(false)
    expect(isImportableImagePath('')).toBe(false)
    expect(isImportableImagePath('.')).toBe(false)
    expect(isImportableImagePath('photo.png')).toBe(true)
  })
})

describe('partitionDroppedPaths', () => {
  test('spec: Given images and other files dropped together, when split, then each keeps the order it was dropped in', () => {
    expect(partitionDroppedPaths(['/d/b.png', '/d/notes.txt', '/d/a.jpg', '/d/x.svg'])).toEqual({
      images: ['/d/b.png', '/d/a.jpg'],
      rejected: ['/d/notes.txt', '/d/x.svg'],
    })
  })

  test('adversarial: Given nothing dropped, when split, then both lists are empty', () => {
    expect(partitionDroppedPaths([])).toEqual({ images: [], rejected: [] })
  })

  test('adversarial: Given the same file dropped twice, when split, then it is kept twice (the import reuses it)', () => {
    expect(partitionDroppedPaths(['/d/a.png', '/d/a.png']).images).toEqual(['/d/a.png', '/d/a.png'])
  })
})

describe('fileNameOf', () => {
  test('spec: Given a full path, when named, then only the file name is left', () => {
    expect(fileNameOf('/Users/me/Desktop/notes.txt')).toBe('notes.txt')
    expect(fileNameOf('C:\\pics\\a.svg')).toBe('a.svg')
  })

  test('adversarial: Given a bare name, an empty path or a trailing slash, when named, then no error', () => {
    expect(fileNameOf('a.png')).toBe('a.png')
    expect(fileNameOf('')).toBe('')
    expect(fileNameOf('/d/')).toBe('')
  })
})

describe('pastedImageExtension', () => {
  test('spec: Given each image type Peitho can show, when pasted, then it keeps its own extension', () => {
    expect(pastedImageExtension('image/png')).toBe('png')
    expect(pastedImageExtension('image/jpeg')).toBe('jpg')
    expect(pastedImageExtension('image/gif')).toBe('gif')
    expect(pastedImageExtension('image/webp')).toBe('webp')
  })

  test('adversarial: Given a TIFF screenshot or an SVG, when pasted, then it needs converting first', () => {
    expect(pastedImageExtension('image/tiff')).toBeNull()
    expect(pastedImageExtension('image/svg+xml')).toBeNull()
    expect(pastedImageExtension('image/bmp')).toBeNull()
  })

  test('adversarial: Given odd casing, surrounding spaces, an empty type or text, when checked, then only real image types match', () => {
    expect(pastedImageExtension(' IMAGE/PNG ')).toBe('png')
    expect(pastedImageExtension('')).toBeNull()
    expect(pastedImageExtension('text/plain')).toBeNull()
    expect(pastedImageExtension('image/png; charset=binary')).toBeNull()
  })
})

describe('isImageMime', () => {
  test('spec: Given any image type, convertible or not, when checked, then it is an image', () => {
    for (const mime of ['image/png', 'image/tiff', 'image/svg+xml', 'IMAGE/JPEG']) expect(isImageMime(mime)).toBe(true)
  })

  test('adversarial: Given text, a file URL list, an empty type or a bare "image/", when checked, then it is not an image', () => {
    for (const mime of ['text/plain', 'text/uri-list', '', 'image/', 'image', 'application/pdf']) expect(isImageMime(mime)).toBe(false)
  })
})

describe('pastedImageName', () => {
  test('spec: Given a paste at a local time, when named, then the name carries that date and time', () => {
    expect(pastedImageName(new Date(2026, 8, 25, 14, 30, 12), 'png')).toBe('screenshot-20260925-143012.png')
  })

  test('spec: Given single-digit parts, when named, then each is zero-padded', () => {
    expect(pastedImageName(new Date(2026, 0, 2, 3, 4, 5), 'jpg')).toBe('screenshot-20260102-030405.jpg')
  })

  test('adversarial: Given an invalid date, when named, then it still gets a usable name', () => {
    expect(pastedImageName(new Date(Number.NaN), 'png')).toBe('screenshot.png')
  })

  test('adversarial: Given any time, when named, then the name is plain ASCII with no path separator', () => {
    const name = pastedImageName(new Date(), 'webp')
    expect(name).toMatch(/^[A-Za-z0-9-]+\.webp$/)
  })
})
