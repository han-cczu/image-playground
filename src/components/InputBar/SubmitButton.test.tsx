// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SubmitButton from './SubmitButton'

describe('SubmitButton', () => {
  afterEach(() => {
    cleanup()
  })

  it('attaches a rejection handler to async submit callbacks', () => {
    const submitPromise = {
      catch: vi.fn(() => Promise.resolve()),
    } as unknown as Promise<void>
    const onSubmit = vi.fn(() => submitPromise)

    render(
      <SubmitButton
        canSubmit={true}
        hasMask={false}
        onSubmit={onSubmit}
        onOpenSettings={vi.fn()}
        needsConfig={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '提交生成' }))

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(submitPromise.catch).toHaveBeenCalled()
  })

  it('未配置时明确显示配置 API 并只打开设置', () => {
    const onSubmit = vi.fn()
    const onOpenSettings = vi.fn()
    render(
      <SubmitButton
        canSubmit={false}
        hasMask={false}
        onSubmit={onSubmit}
        onOpenSettings={onOpenSettings}
        needsConfig={true}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '配置 API' }))
    expect(onOpenSettings).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('遮罩动作有明确文字且提交禁用时不能重复触发', () => {
    const onSubmit = vi.fn()
    render(
      <SubmitButton
        canSubmit={false}
        hasMask={true}
        onSubmit={onSubmit}
        onOpenSettings={vi.fn()}
        needsConfig={false}
      />,
    )
    const button = screen.getByRole('button', { name: '提交遮罩编辑' }) as HTMLButtonElement
    expect(button.textContent).toContain('应用遮罩')
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
