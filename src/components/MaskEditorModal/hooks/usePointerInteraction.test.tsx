// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CanvasViewport } from './useCanvasViewport'
import type { MaskHistory } from './useMaskHistory'
import { usePointerInteraction } from './usePointerInteraction'

function makeViewport(zoomAtPoint = vi.fn()): CanvasViewport {
  return {
    viewTransform: { scale: 1, x: 0, y: 0 },
    viewTransformRef: { current: { scale: 1, x: 0, y: 0 } },
    commitViewTransform: vi.fn(),
    resetViewportToDefault: vi.fn(),
    resetViewTransform: vi.fn(),
    zoomAtPoint,
    isZoomed: false,
  }
}

function makeHistory(): MaskHistory {
  return {
    canUndo: false,
    canRedo: false,
    pushSnapshot: vi.fn(),
    restoreMask: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    clear: vi.fn(),
    cancelActiveStroke: vi.fn(),
  }
}

describe('usePointerInteraction wheel zoom', () => {
  it('registers Alt+wheel zoom as a native non-passive listener', () => {
    const frame = document.createElement('div')
    const addSpy = vi.spyOn(frame, 'addEventListener')
    const removeSpy = vi.spyOn(frame, 'removeEventListener')
    const zoomAtPoint = vi.fn()

    const { unmount } = renderHook(() =>
      usePointerInteraction({
        maskCanvasRef: { current: null },
        baseFrameRef: { current: frame },
        viewport: makeViewport(zoomAtPoint),
        history: makeHistory(),
        tool: 'brush',
        brushSize: 64,
        size: { width: 100, height: 100 },
        renderPreview: vi.fn(),
        imageId: 'image-a',
        isReady: true,
        isSaving: false,
        updateCursor: vi.fn(),
        getViewportCenterCanvasPoint: vi.fn(() => null),
        setShowBrushControls: vi.fn(),
        setSliderAnchor: vi.fn(),
      }),
    )

    const wheelRegistration = addSpy.mock.calls.find(([type]) => type === 'wheel')
    expect(wheelRegistration).toEqual(['wheel', expect.any(Function), { passive: false }])

    const listener = wheelRegistration?.[1] as EventListener
    const event = new WheelEvent('wheel', {
      altKey: true,
      clientX: 20,
      clientY: 30,
      deltaY: 10,
      cancelable: true,
    })
    const preventDefault = vi.spyOn(event, 'preventDefault')

    act(() => {
      listener.call(frame, event)
    })

    expect(preventDefault).toHaveBeenCalled()
    expect(zoomAtPoint).toHaveBeenCalledWith({ x: 20, y: 30 }, Math.exp(-10 * 0.002))

    unmount()
    expect(removeSpy).toHaveBeenCalledWith('wheel', listener)
  })
})
