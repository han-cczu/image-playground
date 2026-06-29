// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import InputBar from './InputBar'
import { useStore } from '../store'
import { MAX_INPUT_IMAGE_BYTES, MAX_INPUT_IMAGE_PIXELS } from '../lib/taskRuntime'
import { MAX_INPUT_IMAGES_PER_SUBMISSION } from '../lib/tasks'
import { storeImage } from '../lib/db'

const canvasImageMocks = vi.hoisted(() => ({
  createMaskPreviewDataUrl: vi.fn(),
  getImageDimensions: vi.fn(async () => ({ width: 16, height: 16 })),
  validateMaskMatchesImage: vi.fn(),
}))

vi.mock('../lib/image/canvasImage', () => canvasImageMocks)

vi.mock('../lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/db')>()
  return {
    ...actual,
    storeImage: vi.fn(actual.storeImage),
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
  useStore.setState(useStore.getInitialState(), true)
})

describe('InputBar', () => {
  it('reports delayed caption source validation failures through the latest toast handler', async () => {
    const oldToast = vi.fn()
    const latestToast = vi.fn()
    const initial = useStore.getInitialState()
    canvasImageMocks.getImageDimensions.mockRejectedValueOnce(new Error('decode failed'))
    useStore.setState({
      settings: {
        ...initial.settings,
        captioner: {
          ...initial.settings.captioner,
          apiKey: 'caption-key',
        },
      },
      showToast: oldToast,
    })

    const { container } = render(<InputBar />)
    const captionFileInput = container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1]
    const file = new File(['small'], 'broken.png', { type: 'image/png' })

    fireEvent.change(captionFileInput, { target: { files: [file] } })
    useStore.setState({ showToast: latestToast })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(latestToast).toHaveBeenCalledWith('读取图片失败：decode failed', 'error')
    })
    expect(oldToast).not.toHaveBeenCalled()
  })

  it('rejects oversized caption source files before reading them', async () => {
    const setCaptionSource = vi.fn()
    const showToast = vi.fn()
    const initial = useStore.getInitialState()
    useStore.setState({
      settings: {
        ...initial.settings,
        captioner: {
          ...initial.settings.captioner,
          apiKey: 'caption-key',
        },
      },
      setCaptionSource,
      showToast,
    })

    const { container } = render(<InputBar />)
    expect(
      (screen.getByRole('button', { name: '图生文 / 反推提示词' }) as HTMLButtonElement).disabled,
    ).toBe(false)

    const captionFileInput = container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1]
    const file = new File([], 'large.png', { type: 'image/png' })
    Object.defineProperty(file, 'size', {
      value: MAX_INPUT_IMAGE_BYTES + 1,
    })

    fireEvent.change(captionFileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('图片过大:超过 50MB 上限', 'error')
    })
    expect(setCaptionSource).not.toHaveBeenCalled()
  })

  it('rejects caption source files whose decoded dimensions exceed the pixel limit', async () => {
    const setCaptionSource = vi.fn()
    const showToast = vi.fn()
    const initial = useStore.getInitialState()
    canvasImageMocks.getImageDimensions.mockResolvedValueOnce({
      width: MAX_INPUT_IMAGE_PIXELS + 1,
      height: 1,
    })
    useStore.setState({
      settings: {
        ...initial.settings,
        captioner: {
          ...initial.settings.captioner,
          apiKey: 'caption-key',
        },
      },
      setCaptionSource,
      showToast,
    })

    const { container } = render(<InputBar />)
    const captionFileInput = container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1]
    const file = new File(['small'], 'wide.png', { type: 'image/png' })

    fireEvent.change(captionFileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('图片分辨率过大'), 'error')
    })
    expect(setCaptionSource).not.toHaveBeenCalled()
  })

  it('accepts caption source files whose MIME type is missing but extension is known', async () => {
    const setCaptionSource = vi.fn()
    const showToast = vi.fn()
    const initial = useStore.getInitialState()
    useStore.setState({
      settings: {
        ...initial.settings,
        captioner: {
          ...initial.settings.captioner,
          apiKey: 'caption-key',
        },
      },
      setCaptionSource,
      showToast,
    })

    const { container } = render(<InputBar />)
    const captionFileInput = container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1]

    fireEvent.change(captionFileInput, {
      target: { files: [new File(['image'], 'pasted.PNG', { type: '' })] },
    })

    await waitFor(() => {
      expect(setCaptionSource).toHaveBeenCalledWith('data:image/png;base64,aW1hZ2U=')
    })
    expect(showToast).not.toHaveBeenCalled()
  })

  it('keeps the latest caption source when an earlier file validation finishes later', async () => {
    const initial = useStore.getInitialState()
    let resolveFirstDimensions!: (value: { width: number; height: number }) => void
    const firstDimensions = new Promise<{ width: number; height: number }>((resolve) => {
      resolveFirstDimensions = resolve
    })
    canvasImageMocks.getImageDimensions
      .mockReturnValueOnce(firstDimensions)
      .mockResolvedValueOnce({ width: 16, height: 16 })
    useStore.setState({
      settings: {
        ...initial.settings,
        captioner: {
          ...initial.settings.captioner,
          apiKey: 'caption-key',
        },
      },
    })

    const { container } = render(<InputBar />)
    const captionFileInput = container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1]
    const firstFile = new File(['first'], 'first.png', { type: 'image/png' })
    const secondFile = new File(['second'], 'second.png', { type: 'image/png' })

    fireEvent.change(captionFileInput, { target: { files: [firstFile] } })
    await waitFor(() => expect(canvasImageMocks.getImageDimensions).toHaveBeenCalledTimes(1))

    fireEvent.change(captionFileInput, { target: { files: [secondFile] } })
    await waitFor(() => expect(canvasImageMocks.getImageDimensions).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      expect(useStore.getState().captionSource).toBe('data:image/png;base64,c2Vjb25k')
    })

    await act(async () => {
      resolveFirstDimensions({ width: 16, height: 16 })
      await Promise.resolve()
    })

    expect(useStore.getState().captionSource).toBe('data:image/png;base64,c2Vjb25k')
  })

  it('does not let duplicate uploaded files consume the remaining image slot', async () => {
    const showToast = vi.fn()
    const existingImages = Array.from(
      { length: MAX_INPUT_IMAGES_PER_SUBMISSION - 1 },
      (_, index) => ({
        id: `existing-${index}`,
        dataUrl: `data:image/png;base64,existing-${index}`,
      }),
    )
    useStore.setState({
      inputImages: existingImages,
      showToast,
    })
    vi.mocked(storeImage)
      .mockResolvedValueOnce(existingImages[0].id)
      .mockResolvedValueOnce('new-image')

    const { container } = render(<InputBar />)
    const uploadInput = container.querySelectorAll<HTMLInputElement>('input[type="file"]')[0]
    const duplicate = new File(['duplicate'], 'duplicate.png', { type: 'image/png' })
    const unique = new File(['unique'], 'unique.png', { type: 'image/png' })

    fireEvent.change(uploadInput, { target: { files: [duplicate, unique] } })

    await waitFor(() => {
      expect(useStore.getState().inputImages.map((image) => image.id)).toContain('new-image')
    })
    expect(storeImage).toHaveBeenCalledTimes(2)
    expect(useStore.getState().inputImages).toHaveLength(MAX_INPUT_IMAGES_PER_SUBMISSION)
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining('被丢弃'), 'error')
  })

  it('accepts image uploads whose MIME type is missing but extension is known', async () => {
    const showToast = vi.fn()
    useStore.setState({ showToast })
    vi.mocked(storeImage).mockResolvedValueOnce('stored-image-id')
    const { container } = render(<InputBar />)
    const uploadInput = container.querySelectorAll<HTMLInputElement>('input[type="file"]')[0]

    fireEvent.change(uploadInput, {
      target: { files: [new File(['image'], 'pasted.PNG', { type: '' })] },
    })

    await waitFor(() => {
      expect(storeImage).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(showToast).not.toHaveBeenCalled()
      expect(useStore.getState().inputImages).toEqual([
        {
          id: 'stored-image-id',
          dataUrl: expect.stringContaining('data:image/png;base64,'),
        },
      ])
    })
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining('图片添加失败'), 'error')
  })

  it('clears the mask preview state when the mask draft is removed', async () => {
    let resolveSecondPreview!: (url: string) => void
    canvasImageMocks.createMaskPreviewDataUrl
      .mockResolvedValueOnce('data:image/png;base64,FIRST_PREVIEW')
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveSecondPreview = resolve
          }),
      )
    const maskDraft = {
      targetImageId: 'img-mask',
      maskDataUrl: 'data:image/png;base64,MASK',
      updatedAt: 1,
    }
    useStore.setState({
      inputImages: [{ id: 'img-mask', dataUrl: 'data:image/png;base64,ORIGINAL' }],
      maskDraft,
    })

    const { container } = render(<InputBar />)

    await waitFor(() => {
      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        'data:image/png;base64,FIRST_PREVIEW',
      )
    })

    act(() => {
      useStore.getState().clearMaskDraft()
    })
    await waitFor(() => {
      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        'data:image/png;base64,ORIGINAL',
      )
    })

    act(() => {
      useStore.getState().setMaskDraft(maskDraft)
    })

    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'data:image/png;base64,ORIGINAL',
    )

    await act(async () => {
      resolveSecondPreview('data:image/png;base64,SECOND_PREVIEW')
    })
    await waitFor(() => {
      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        'data:image/png;base64,SECOND_PREVIEW',
      )
    })
  })
})
