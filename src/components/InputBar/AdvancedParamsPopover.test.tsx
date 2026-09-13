// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useStore } from '../../store'
import AdvancedParamsPopover from './AdvancedParamsPopover'

afterEach(() => {
  cleanup()
  useStore.setState(useStore.getInitialState(), true)
})

describe('AdvancedParamsPopover', () => {
  it('原生选项写入生成参数，格式切换继续控制压缩率编辑', () => {
    const initial = useStore.getInitialState()
    useStore.setState({ settings: { ...initial.settings, codexCli: false, apiMode: 'images' } })
    render(
      <AdvancedParamsPopover
        anchorRef={{ current: document.createElement('button') }}
        onClose={vi.fn()}
      />,
    )
    const compression = screen.getByRole('spinbutton', { name: /^压缩率/ }) as HTMLInputElement
    expect(compression.disabled).toBe(true)
    fireEvent.change(screen.getByRole('combobox', { name: '质量' }), { target: { value: 'high' } })
    fireEvent.change(screen.getByRole('combobox', { name: '格式' }), { target: { value: 'jpeg' } })
    fireEvent.change(screen.getByRole('combobox', { name: '审核' }), { target: { value: 'low' } })
    expect(useStore.getState().params).toMatchObject({
      quality: 'high',
      output_format: 'jpeg',
      moderation: 'low',
    })
    expect(compression.disabled).toBe(false)
    fireEvent.change(compression, { target: { value: '75' } })
    fireEvent.blur(compression)
    expect(useStore.getState().params.output_compression).toBe(75)
  })

  it('Codex CLI 质量和 Responses 审核保持禁用，并显示兼容的自动选项', () => {
    const initial = useStore.getInitialState()
    useStore.setState({
      settings: { ...initial.settings, codexCli: true, apiMode: 'responses' },
      params: { ...initial.params, quality: 'high', moderation: 'low' },
    })
    render(
      <AdvancedParamsPopover
        anchorRef={{ current: document.createElement('button') }}
        onClose={vi.fn()}
      />,
    )
    const quality = screen.getByRole('combobox', { name: /^质量/ }) as HTMLSelectElement
    const moderation = screen.getByRole('combobox', { name: /^审核/ }) as HTMLSelectElement
    expect(quality.disabled).toBe(true)
    expect(moderation.disabled).toBe(true)
    expect(quality.value).toBe('auto')
    expect(moderation.value).toBe('auto')
  })
})
