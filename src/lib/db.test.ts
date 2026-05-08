import { describe, expect, it } from 'vitest'
import {
  dataUrlToImageBlob,
  storedImageToBytes,
  storedImageToDataUrl,
} from './db'

describe('stored image conversions', () => {
  it('converts base64 data URLs to image blobs', async () => {
    const result = dataUrlToImageBlob('data:image/png;base64,AQID')

    expect(result.mime).toBe('image/png')
    expect(result.blob.type).toBe('image/png')
    expect(Array.from(new Uint8Array(await result.blob.arrayBuffer()))).toEqual([1, 2, 3])
  })

  it('keeps legacy data URL records readable', async () => {
    const dataUrl = 'data:image/png;base64,AQID'

    await expect(storedImageToDataUrl({ id: 'legacy', dataUrl })).resolves.toBe(dataUrl)
    await expect(storedImageToBytes({ id: 'legacy', dataUrl })).resolves.toMatchObject({
      bytes: new Uint8Array([1, 2, 3]),
      mime: 'image/png',
    })
  })

  it('converts blob records back to data URLs and bytes', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' })

    await expect(storedImageToDataUrl({ id: 'blob', blob, mime: 'image/webp' })).resolves.toBe(
      'data:image/webp;base64,AQID',
    )
    await expect(storedImageToBytes({ id: 'blob', blob, mime: 'image/webp' })).resolves.toMatchObject({
      bytes: new Uint8Array([1, 2, 3]),
      mime: 'image/webp',
    })
  })
})
