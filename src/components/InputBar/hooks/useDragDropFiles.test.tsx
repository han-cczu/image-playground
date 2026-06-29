// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDragDropFiles } from './useDragDropFiles'

function dispatchDragEvent(type: string, options: { types?: string[]; files?: File[] } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      types: options.types ?? ['Files'],
      files: options.files ?? [],
    },
  })
  act(() => {
    document.dispatchEvent(event)
  })
  return event
}

describe('useDragDropFiles', () => {
  it('handles pasted image files whose clipboard item MIME type is missing', () => {
    const onFiles = vi.fn()
    renderHook(() => useDragDropFiles({ onFiles }))
    const file = new File(['x'], 'pasted.PNG', { type: '' })
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: [
          {
            type: '',
            getAsFile: () => file,
          },
        ],
      },
    })

    act(() => {
      document.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
    expect(onFiles).toHaveBeenCalledWith([file])
  })

  it('preserves pasted images when only the clipboard item exposes the image MIME type', () => {
    const onFiles = vi.fn()
    renderHook(() => useDragDropFiles({ onFiles }))
    const file = new File(['x'], '', { type: '' })
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: [
          {
            type: 'image/png',
            getAsFile: () => file,
          },
        ],
      },
    })

    act(() => {
      document.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
    expect(onFiles).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'pasted-image.png',
        type: 'image/png',
      }),
    ])
  })

  it('recovers from redundant dragleave events before the next file drag leaves', () => {
    const onFiles = vi.fn()
    const { result } = renderHook(() => useDragDropFiles({ onFiles }))

    dispatchDragEvent('dragenter')
    expect(result.current.isDragging).toBe(true)

    dispatchDragEvent('dragleave')
    expect(result.current.isDragging).toBe(false)

    dispatchDragEvent('dragleave')
    expect(result.current.isDragging).toBe(false)

    dispatchDragEvent('dragenter')
    expect(result.current.isDragging).toBe(true)

    dispatchDragEvent('dragleave')
    expect(result.current.isDragging).toBe(false)
  })

  it('does not hijack non-file drags or drops', () => {
    const onFiles = vi.fn()
    const { result } = renderHook(() => useDragDropFiles({ onFiles }))

    const dragEnter = dispatchDragEvent('dragenter', { types: ['text/plain'] })
    expect(result.current.isDragging).toBe(false)
    expect(dragEnter.defaultPrevented).toBe(false)

    const drop = dispatchDragEvent('drop', { types: ['text/plain'] })
    expect(drop.defaultPrevented).toBe(false)
    expect(onFiles).not.toHaveBeenCalled()
  })

  it('resets an active file drag even when a trailing leave omits transfer types', () => {
    const onFiles = vi.fn()
    const { result } = renderHook(() => useDragDropFiles({ onFiles }))

    dispatchDragEvent('dragenter', { types: ['Files'] })
    expect(result.current.isDragging).toBe(true)

    const dragLeave = dispatchDragEvent('dragleave', { types: [] })
    expect(dragLeave.defaultPrevented).toBe(true)
    expect(result.current.isDragging).toBe(false)
  })

  it('handles a dropped file even when drop types are omitted after a file drag', () => {
    const onFiles = vi.fn()
    const { result } = renderHook(() => useDragDropFiles({ onFiles }))
    const file = new File(['x'], 'image.png', { type: 'image/png' })

    dispatchDragEvent('dragenter', { types: ['Files'] })
    expect(result.current.isDragging).toBe(true)

    const drop = dispatchDragEvent('drop', { types: [], files: [file] })
    expect(drop.defaultPrevented).toBe(true)
    expect(result.current.isDragging).toBe(false)
    expect(onFiles).toHaveBeenCalledWith([file])
  })
})
