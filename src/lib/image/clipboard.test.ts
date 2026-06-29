// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyTextToClipboard } from './clipboard'

describe('copyTextToClipboard fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('restores focus and text selection after execCommand fallback', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => true),
    })

    const textarea = document.createElement('textarea')
    textarea.value = 'prompt text'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.setSelectionRange(2, 8)
    vi.spyOn(HTMLTextAreaElement.prototype, 'select').mockImplementation(function (
      this: HTMLTextAreaElement,
    ) {
      this.focus()
      this.setSelectionRange(0, this.value.length)
    })

    await copyTextToClipboard('copied text')

    expect(document.activeElement).toBe(textarea)
    expect(textarea.selectionStart).toBe(2)
    expect(textarea.selectionEnd).toBe(8)
  })

  it('does not fail a successful copy when restoring the previous selection throws', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => true),
    })

    const textarea = document.createElement('textarea')
    textarea.value = 'prompt text'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.setSelectionRange(2, 8)

    let selectCallCount = 0
    vi.spyOn(HTMLTextAreaElement.prototype, 'select').mockImplementation(function (
      this: HTMLTextAreaElement,
    ) {
      selectCallCount += 1
      this.focus()
      this.setSelectionRange(0, this.value.length)
    })
    const originalSetSelectionRange = HTMLTextAreaElement.prototype.setSelectionRange
    vi.spyOn(HTMLTextAreaElement.prototype, 'setSelectionRange').mockImplementation(function (
      this: HTMLTextAreaElement,
      start: number | null,
      end: number | null,
      direction?: 'forward' | 'backward' | 'none',
    ) {
      if (selectCallCount > 0 && this === textarea && start === 2 && end === 8) {
        throw new Error('restore failed')
      }
      if (start === null || end === null) return
      originalSetSelectionRange.call(this, start, end, direction)
    })

    await expect(copyTextToClipboard('copied text')).resolves.toBeUndefined()
  })

  it('does not fail when the focused input does not expose text selection', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => true),
    })

    const input = document.createElement('input')
    input.type = 'number'
    input.value = '42'
    document.body.appendChild(input)
    input.focus()

    await expect(copyTextToClipboard('copied text')).resolves.toBeUndefined()
  })
})
