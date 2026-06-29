// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import GridConfigPopover from './GridConfigPopover'

const mocks = vi.hoisted(() => ({
  submitGridTask: vi.fn(),
}))

const state = vi.hoisted(() => ({
  settings: {
    baseUrl: '',
    apiKey: 'test-key',
    model: '',
    timeout: 60,
    apiMode: 'images',
    codexCli: false,
    apiProxy: false,
    clearInputAfterSubmit: false,
    batchConcurrency: 3,
    theme: 'light',
    profiles: [],
    activeProfileId: '',
    promptOptimizer: {},
    optimizerProfiles: [],
    activeOptimizerProfileId: '',
    captioner: {},
    captionerProfiles: [],
    activeCaptionerProfileId: '',
  },
  params: {
    size: 'auto',
    quality: 'auto',
    output_format: 'png',
    output_compression: null,
    moderation: 'auto',
    n: 1,
  },
  prompt: 'prompt {cat|dog}',
}))

vi.mock('../../store', () => ({
  submitGridTask: mocks.submitGridTask,
  useStore: (selector: (s: typeof state) => unknown) => selector(state),
}))

describe('GridConfigPopover', () => {
  afterEach(() => {
    cleanup()
    mocks.submitGridTask.mockReset()
  })

  it('attaches a rejection handler to async grid submissions', () => {
    const submitPromise = {
      catch: vi.fn(() => Promise.resolve()),
    } as unknown as Promise<void>
    mocks.submitGridTask.mockReturnValue(submitPromise)
    const anchorRef = { current: document.createElement('button') }

    render(<GridConfigPopover anchorRef={anchorRef} onClose={vi.fn()} />)
    fireEvent.click(screen.getAllByRole('combobox')[0])
    fireEvent.click(screen.getByRole('option', { name: '质量' }))
    fireEvent.click(screen.getByRole('button', { name: 'low' }))
    fireEvent.click(screen.getByRole('button', { name: 'high' }))
    fireEvent.click(screen.getByRole('button', { name: '生成网格' }))

    expect(mocks.submitGridTask).toHaveBeenCalledOnce()
    expect(submitPromise.catch).toHaveBeenCalled()
  })
})
