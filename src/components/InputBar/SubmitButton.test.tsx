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
})
