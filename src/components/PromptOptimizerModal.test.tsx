// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import PromptOptimizerModal from './PromptOptimizerModal'
import { useStore } from '../store'
import { DEFAULT_SETTINGS } from '../lib/api/apiProfiles'
import {
  optimizePromptStream,
  type OptimizePromptOptions,
} from '../lib/api/optimizePromptApi'

vi.mock('../lib/api/optimizePromptApi', () => ({
  optimizePromptStream: vi.fn(),
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  useStore.setState(useStore.getInitialState(), true)
})

describe('PromptOptimizerModal', () => {
  it('ignores late deltas from an aborted optimizer stream after retrying', async () => {
    const streamOptions: OptimizePromptOptions[] = []
    const first = createDeferred<string>()
    vi.mocked(optimizePromptStream).mockImplementation((_config, _prompt, options = {}) => {
      streamOptions.push(options)
      return streamOptions.length === 1 ? first.promise : new Promise<string>(() => undefined)
    })

    useStore.setState({
      prompt: 'draft prompt',
      showPromptOptimizer: true,
      settings: {
        ...DEFAULT_SETTINGS,
        promptOptimizer: {
          ...DEFAULT_SETTINGS.promptOptimizer,
          apiKey: 'optimizer-key',
        },
      },
    })

    render(<PromptOptimizerModal />)

    await waitFor(() => {
      expect(optimizePromptStream).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      first.reject(new Error('boom'))
      await first.promise.catch(() => undefined)
    })

    expect(await screen.findByText('boom')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    await waitFor(() => {
      expect(optimizePromptStream).toHaveBeenCalledTimes(2)
    })

    act(() => {
      streamOptions[0].onDelta?.('old optimized')
      streamOptions[1].onDelta?.('new optimized')
    })

    expect(screen.queryByText(/old optimized/)).toBeNull()
    expect(screen.getByText(/new optimized/)).toBeTruthy()
  })
})
