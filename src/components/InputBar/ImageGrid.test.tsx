// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
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

/**
 * jsdom 没有 DragEvent / DataTransfer:fireEvent.dragOver 会退化成裸 Event,clientX 丢失。
 * 改用 MouseEvent 构造(带 clientX),dataTransfer 由 createEvent 以自有属性挂到事件上,
 * React 的 SyntheticDragEvent 会原样读取。
 */
function fireDragEvent(
  el: Element,
  type: 'dragstart' | 'dragover' | 'drop',
  init: { clientX?: number; dataTransfer: Record<string, unknown> },
) {
  const event = createEvent(type, el, init, {
    EventType: 'MouseEvent',
    defaultInit: { bubbles: true, cancelable: true },
  })
  fireEvent(el, event)
}

function createDataTransfer() {
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: vi.fn(),
    getData: vi.fn(() => ''),
    setDragImage: vi.fn(),
  }
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

  // 锁定 UI 侧语义:onMove 的 to 是「移除前数组的插入缝隙」下标,与指示线位置一致。
  // store 的 moveInputImage 按同一语义修正下标,两侧只能有一侧做换算,否则会双重修正
  it('鼠标拖到某张图左半区时,指示线画在该图左侧且 onMove 收到该图下标作为插入缝隙', () => {
    const inputImages = [image('a'), image('b'), image('c')]
    const props = {
      ...createImageGridProps(),
      inputImages,
      maskTargetImage: null,
      maskDraft: null,
      referenceImages: inputImages,
    }
    render(<ImageGrid {...props} />)
    const thumbs = document.querySelectorAll<HTMLElement>('[data-input-image-index]')
    const first = thumbs[0]
    const third = thumbs[2]
    vi.spyOn(third, 'getBoundingClientRect').mockReturnValue({
      left: 200,
      width: 52,
      top: 0,
      height: 52,
      right: 252,
      bottom: 52,
      x: 200,
      y: 0,
      toJSON: () => ({}),
    })
    const dataTransfer = createDataTransfer()

    fireDragEvent(first, 'dragstart', { dataTransfer })
    // clientX 落在第三张左半区 → 缝隙 2(B|C 之间),指示线画在 C 左侧
    fireDragEvent(third, 'dragover', { clientX: 205, dataTransfer })

    expect(third.querySelector('[class*="-left-[5px]"]')).not.toBeNull()

    fireDragEvent(third, 'drop', { clientX: 205, dataTransfer })

    expect(props.onMove).toHaveBeenCalledTimes(1)
    expect(props.onMove).toHaveBeenCalledWith(0, 2)
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
