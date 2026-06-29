import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../../types'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { callImageApi } from '.'
import { dataUrlToBlob, imageDataUrlToPngBlob, maskDataUrlToPngBlob } from '../image/canvasImage'

vi.mock('../image/canvasImage', () => ({
  dataUrlToBlob: vi.fn(async () => {
    throw new Error('blob conversion should not run')
  }),
  imageDataUrlToPngBlob: vi.fn(async () => {
    throw new Error('image conversion should not run')
  }),
  maskDataUrlToPngBlob: vi.fn(async () => {
    throw new Error('mask conversion should not run')
  }),
}))

describe('OpenAI Images edit abort handling', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('does not decode edit input images when the caller signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('user cancelled'))
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: ['data:image/png;base64,AQ=='],
      signal: controller.signal,
    })).rejects.toMatchObject({ message: '已取消' })

    expect(dataUrlToBlob).not.toHaveBeenCalled()
    expect(imageDataUrlToPngBlob).not.toHaveBeenCalled()
    expect(maskDataUrlToPngBlob).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects non-image edit input data URLs before Blob conversion or fetch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: ['data:text/plain;base64,SGk='],
    })).rejects.toThrow('输入图片不是图片内容')

    expect(dataUrlToBlob).not.toHaveBeenCalled()
    expect(imageDataUrlToPngBlob).not.toHaveBeenCalled()
    expect(maskDataUrlToPngBlob).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects non-image edit masks before Blob conversion or fetch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: ['data:image/png;base64,AQ=='],
      maskDataUrl: 'data:text/plain;base64,SGk=',
    })).rejects.toThrow('输入图片不是图片内容')

    expect(dataUrlToBlob).not.toHaveBeenCalled()
    expect(imageDataUrlToPngBlob).not.toHaveBeenCalled()
    expect(maskDataUrlToPngBlob).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
