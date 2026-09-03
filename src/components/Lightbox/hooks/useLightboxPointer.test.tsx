// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TAP_CLOSE_DELAY_MS } from '../constants'
import { useLightboxPointer } from './useLightboxPointer'

function createTouchEvent(type: string, touches: Array<{ clientX: number; clientY: number }>) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'touches', {
    value: touches,
  })
  return event
}

describe('useLightboxPointer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears dragging state when a touch gesture is cancelled', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const scaleRef = { current: 1 }
    const txRef = { current: 0 }
    const tyRef = { current: 0 }
    const apply = vi.fn((scale: number, tx: number, ty: number) => {
      scaleRef.current = scale
      txRef.current = tx
      tyRef.current = ty
    })

    const { result, unmount } = renderHook(() =>
      useLightboxPointer({
        containerRef: { current: el },
        scaleRef,
        txRef,
        tyRef,
        apply,
        onClose: vi.fn(),
      }),
    )

    act(() => {
      el.dispatchEvent(
        createTouchEvent('touchstart', [
          { clientX: 0, clientY: 0 },
          { clientX: 10, clientY: 0 },
        ]),
      )
    })
    expect(result.current.isDragging).toBe(true)

    act(() => {
      el.dispatchEvent(createTouchEvent('touchcancel', []))
    })

    expect(result.current.isDragging).toBe(false)
    unmount()
    el.remove()
  })

  it('clears mouse dragging state when the window loses focus', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const scaleRef = { current: 2 }
    const txRef = { current: 0 }
    const tyRef = { current: 0 }

    const { result, unmount } = renderHook(() =>
      useLightboxPointer({
        containerRef: { current: el },
        scaleRef,
        txRef,
        tyRef,
        apply: vi.fn(),
        onClose: vi.fn(),
      }),
    )

    act(() => {
      el.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 10, clientY: 10 }))
    })
    expect(result.current.isDragging).toBe(true)

    act(() => {
      window.dispatchEvent(new Event('blur'))
    })

    expect(result.current.isDragging).toBe(false)
    unmount()
    el.remove()
  })

  it('cancels a pending touch-close timer when the lightbox unmounts', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    const el = document.createElement('div')
    document.body.appendChild(el)
    const onClose = vi.fn()

    const { unmount } = renderHook(() =>
      useLightboxPointer({
        containerRef: { current: el },
        scaleRef: { current: 1 },
        txRef: { current: 0 },
        tyRef: { current: 0 },
        apply: vi.fn(),
        onClose,
      }),
    )

    act(() => {
      el.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 10 }]))
      el.dispatchEvent(createTouchEvent('touchend', []))
    })

    unmount()

    act(() => {
      vi.advanceTimersByTime(TAP_CLOSE_DELAY_MS)
    })

    expect(onClose).not.toHaveBeenCalled()
    el.remove()
  })

  function mountTapHarness() {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const el = document.createElement('div')
    document.body.appendChild(el)
    const onClose = vi.fn()
    const apply = vi.fn()
    const hook = renderHook(() =>
      useLightboxPointer({
        containerRef: { current: el },
        scaleRef: { current: 1 },
        txRef: { current: 0 },
        tyRef: { current: 0 },
        apply,
        onClose,
      }),
    )
    const compatClick = () =>
      act(() => {
        hook.result.current.onClick({
          stopPropagation: () => {},
          target: el,
        } as unknown as React.MouseEvent)
      })
    return { el, onClose, apply, hook, compatClick }
  }

  it('触屏单指轻点:浏览器补发的兼容 click 被吞掉,关闭只在延迟窗口结束后发生一次', () => {
    const { el, onClose, hook, compatClick } = mountTapHarness()

    act(() => {
      el.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 10 }]))
      el.dispatchEvent(createTouchEvent('touchend', []))
    })
    compatClick()
    expect(onClose).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(TAP_CLOSE_DELAY_MS)
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    // 延迟窗口过后真实鼠标点击照常关闭(抑制标志已复位,不能吞掉下一次点击)
    compatClick()
    expect(onClose).toHaveBeenCalledTimes(2)
    hook.unmount()
    el.remove()
  })

  it('触屏双击:第二次轻点触发放大而不是关闭', () => {
    const { el, onClose, apply, hook, compatClick } = mountTapHarness()

    act(() => {
      el.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 10, clientY: 10 }]))
      el.dispatchEvent(createTouchEvent('touchend', []))
    })
    compatClick()
    act(() => {
      vi.advanceTimersByTime(100)
      el.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 12, clientY: 11 }]))
      el.dispatchEvent(createTouchEvent('touchend', []))
    })
    act(() => {
      vi.advanceTimersByTime(TAP_CLOSE_DELAY_MS * 2)
    })

    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply.mock.calls[0][0]).toBeGreaterThan(1)
    expect(onClose).not.toHaveBeenCalled()
    hook.unmount()
    el.remove()
  })
})
