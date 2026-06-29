// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import ImageCaptionModal from './ImageCaptionModal'
import { useStore } from '../store'
import { DEFAULT_SETTINGS } from '../lib/api/apiProfiles'
import { captionImageStream, type CaptionImageOptions } from '../lib/api/captionImageApi'

vi.mock('../lib/api/captionImageApi', () => ({
  captionImageStream: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  useStore.setState(useStore.getInitialState(), true)
})

describe('ImageCaptionModal', () => {
  it('ignores late deltas from an aborted caption stream after switching source', async () => {
    const streamOptions: CaptionImageOptions[] = []
    vi.mocked(captionImageStream).mockImplementation((_config, _source, options = {}) => {
      streamOptions.push(options)
      return new Promise<string>(() => undefined)
    })

    useStore.setState({
      captionSource: 'data:image/png;base64,AAAA',
      settings: {
        ...DEFAULT_SETTINGS,
        captioner: { ...DEFAULT_SETTINGS.captioner, apiKey: 'caption-key' },
      },
    })

    render(<ImageCaptionModal />)

    await waitFor(() => {
      expect(captionImageStream).toHaveBeenCalledTimes(1)
    })

    act(() => {
      useStore.getState().setCaptionSource('data:image/png;base64,BBBB')
    })

    await waitFor(() => {
      expect(captionImageStream).toHaveBeenCalledTimes(2)
    })

    act(() => {
      streamOptions[0].onDelta?.('old caption')
      streamOptions[1].onDelta?.('new caption')
    })

    expect(screen.queryByText(/old caption/)).toBeNull()
    expect(screen.getByText(/new caption/)).toBeTruthy()
  })
})
