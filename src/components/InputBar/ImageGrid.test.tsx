// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { InputImage, MaskDraft } from '../../types'
import ImageGrid from './ImageGrid'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'

function image(id: string): InputImage {
  return { id, dataUrl: `data:image/png;base64,${id}` }
}

function ExtraBodyLock({ active }: { active: boolean }) {
  useLockBodyScroll(active)
  return null
}

function createImageGridProps() {
  const inputImages = [image('mask'), image('ref')]
  const maskDraft: MaskDraft = {
    targetImageId: 'mask',
    maskDataUrl: 'data:image/png;base64,maskdraft',
    updatedAt: 1,
  }
  return {
    inputImages,
    maskTargetImage: inputImages[0],
    maskDraft,
    maskPreviewUrl: '',
    referenceImages: [inputImages[1]],
    isMobile: false,
    imagesRef: { current: null },
    onMove: vi.fn(),
    onRemove: vi.fn(),
    onClearAll: vi.fn(),
    onClickImage: vi.fn(),
    onEditMask: vi.fn(),
    onConfirmClearAll: vi.fn(),
    onMaskConflictNotice: vi.fn(),
  }
}

function renderImageGrid() {
  const props = createImageGridProps()

  render(<ImageGrid {...props} />)

  return props
}

describe('ImageGrid', () => {
  afterEach(() => {
    cleanup()
    document.body.style.overflow = ''
    document.body.style.overscrollBehavior = ''
    vi.restoreAllMocks()
  })

  it('restores image clicks after a touch drag ends without a drop target', async () => {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => null),
    })
    const props = renderImageGrid()
    const viewButtons = screen.getAllByRole('button', { name: '查看大图' })
    const referenceThumb = viewButtons[0]

    fireEvent.touchStart(referenceThumb.parentElement!, {
      touches: [{ clientX: 10, clientY: 10 }],
    })
    fireEvent.touchMove(referenceThumb.parentElement!, {
      touches: [{ clientX: 500, clientY: 500 }],
    })
    fireEvent.touchEnd(referenceThumb.parentElement!, {
      changedTouches: [{ clientX: 500, clientY: 500 }],
    })

    await new Promise((resolve) => window.setTimeout(resolve, 0))

    fireEvent.click(referenceThumb)

    expect(props.onMove).not.toHaveBeenCalled()
    expect(props.onClickImage).toHaveBeenCalledWith('ref', ['mask', 'ref'])
  })

  it('keeps a later overlay body lock when a touch drag ends', () => {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => null),
    })
    const props = createImageGridProps()

    function Harness({ overlayOpen }: { overlayOpen: boolean }) {
      return (
        <>
          <ImageGrid {...props} isMobile />
          <ExtraBodyLock active={overlayOpen} />
        </>
      )
    }

    const { rerender } = render(<Harness overlayOpen={false} />)
    const referenceThumb = screen.getAllByRole('button', { name: '查看大图' })[0]
    const touchSurface = referenceThumb.parentElement!

    fireEvent.touchStart(touchSurface, {
      touches: [{ clientX: 10, clientY: 10 }],
    })
    fireEvent.touchMove(touchSurface, {
      touches: [{ clientX: 500, clientY: 500 }],
    })
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.body.style.overscrollBehavior).toBe('none')

    rerender(<Harness overlayOpen />)
    fireEvent.touchEnd(touchSurface, {
      changedTouches: [{ clientX: 500, clientY: 500 }],
    })

    expect(document.body.style.overflow).toBe('hidden')
    expect(document.body.style.overscrollBehavior).toBe('')
  })
})
