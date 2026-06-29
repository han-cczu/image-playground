// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Sidebar from './index'
import { useLockBodyScroll } from '../../hooks/useLockBodyScroll'
import { useStore } from '../../store'

function ExtraBodyLock({ active }: { active: boolean }) {
  useLockBodyScroll(active)
  return null
}

describe('Sidebar', () => {
  afterEach(() => {
    cleanup()
    document.body.style.overflow = ''
    vi.restoreAllMocks()
    useStore.setState(useStore.getInitialState(), true)
  })

  it('keeps body scrolling locked when the mobile drawer closes under another active overlay', () => {
    const onMobileClose = vi.fn()

    function Harness({ mobileOpen, overlayOpen }: { mobileOpen: boolean; overlayOpen: boolean }) {
      return (
        <>
          <Sidebar mobileOpen={mobileOpen} onMobileClose={onMobileClose} />
          <ExtraBodyLock active={overlayOpen} />
        </>
      )
    }

    const { rerender } = render(<Harness mobileOpen overlayOpen />)
    expect(document.body.style.overflow).toBe('hidden')

    rerender(<Harness mobileOpen={false} overlayOpen />)

    expect(document.body.style.overflow).toBe('hidden')
  })
})
