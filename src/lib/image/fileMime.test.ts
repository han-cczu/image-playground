// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { fileToImageDataUrl, getImageFileMime, isImageFile } from './fileMime'

describe('image file MIME helpers', () => {
  it('accepts browser-provided image MIME types', () => {
    const file = new File(['x'], 'upload.custom', { type: 'IMAGE/PNG' })

    expect(getImageFileMime(file)).toBe('image/png')
    expect(isImageFile(file)).toBe(true)
  })

  it('infers image MIME from extension when the browser only supplies a generic type', () => {
    expect(getImageFileMime(new File(['x'], 'pasted.PNG', { type: '' }))).toBe('image/png')
    expect(getImageFileMime(new File(['x'], 'dragged.jpg', { type: 'application/octet-stream' })))
      .toBe('image/jpeg')
  })

  it('rejects non-images even when they have a generic MIME type', () => {
    expect(getImageFileMime(new File(['x'], 'notes.txt', { type: '' }))).toBeNull()
    expect(isImageFile(new File(['x'], 'archive.zip', { type: 'application/octet-stream' })))
      .toBe(false)
  })

  it('emits an image data URL when reading a file with inferred MIME', async () => {
    await expect(fileToImageDataUrl(new File(['image'], 'pasted.PNG', { type: '' })))
      .resolves.toBe('data:image/png;base64,aW1hZ2U=')
  })
})
