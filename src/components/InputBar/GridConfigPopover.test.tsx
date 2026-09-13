// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
  conversations: [{ id: 'conversation-a', title: '产品摄影' }],
  activeConversationId: 'conversation-a',
}))

vi.mock('../../store', () => ({
  submitGridTask: mocks.submitGridTask,
  useStore: (selector: (s: typeof state) => unknown) => selector(state),
}))

describe('GridConfigPopover', () => {
  afterEach(() => {
    cleanup()
    mocks.submitGridTask.mockReset()
    state.settings.codexCli = false
  })

  it('attaches a rejection handler to async grid submissions', () => {
    const submitPromise = {
      catch: vi.fn(() => Promise.resolve()),
    } as unknown as Promise<void>
    mocks.submitGridTask.mockReturnValue(submitPromise)
    const anchorRef = { current: document.createElement('button') }

    render(<GridConfigPopover anchorRef={anchorRef} onClose={vi.fn()} />)
    expect(screen.getByText('生成到：产品摄影')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'X 轴维度（必选）' }), {
      target: { value: 'quality' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'low' }))
    fireEvent.click(screen.getByRole('button', { name: 'high' }))
    fireEvent.click(screen.getByRole('button', { name: '生成网格' }))

    expect(mocks.submitGridTask).toHaveBeenCalledOnce()
    expect(submitPromise.catch).toHaveBeenCalled()
  })

  it('原生轴选择器保留双轴取值，并在 X 轴改为原 Y 轴时清除旧配置', () => {
    mocks.submitGridTask.mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(
      <GridConfigPopover
        anchorRef={{ current: document.createElement('button') }}
        onClose={onClose}
      />,
    )
    const xSelect = screen.getByRole('combobox', { name: 'X 轴维度（必选）' }) as HTMLSelectElement
    const ySelect = screen.getByRole('combobox', { name: 'Y 轴维度（可选）' }) as HTMLSelectElement
    const generate = screen.getByRole('button', { name: '生成网格' }) as HTMLButtonElement
    fireEvent.change(xSelect, { target: { value: 'quality' } })
    fireEvent.click(screen.getByRole('button', { name: 'low' }))
    fireEvent.click(screen.getByRole('button', { name: 'high' }))
    fireEvent.change(ySelect, { target: { value: 'output_format' } })
    fireEvent.click(screen.getByRole('button', { name: 'PNG' }))
    fireEvent.click(screen.getByRole('button', { name: 'JPEG' }))
    expect(screen.getByText('2×2 共 4 张图片')).toBeTruthy()
    expect(within(ySelect).queryByRole('option', { name: '质量' })).toBeNull()

    fireEvent.change(xSelect, { target: { value: 'output_format' } })
    expect(ySelect.value).toBe('')
    expect(generate.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'PNG' }))
    fireEvent.click(screen.getByRole('button', { name: 'WEBP' }))
    fireEvent.click(generate)
    expect(mocks.submitGridTask).toHaveBeenCalledWith({
      x: {
        kind: 'output_format',
        values: [
          { key: 'png', label: 'PNG' },
          { key: 'webp', label: 'WEBP' },
        ],
      },
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('原生轴选项继续排除 Codex CLI 不支持的质量维度', () => {
    state.settings.codexCli = true
    render(
      <GridConfigPopover
        anchorRef={{ current: document.createElement('button') }}
        onClose={vi.fn()}
      />,
    )
    for (const select of screen.getAllByRole('combobox')) {
      expect(within(select).queryByRole('option', { name: '质量' })).toBeNull()
    }
  })
})
