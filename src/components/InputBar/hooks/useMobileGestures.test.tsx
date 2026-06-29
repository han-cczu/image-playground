// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../../../store'
import { useMobileGestures } from './useMobileGestures'

function createTouchEvent(type: string, touches: Array<{ clientY: number }>) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'touches', {
    value: touches,
  })
  return event
}

function HandleHarness() {
  const { setMobileCollapsed, dragHandleRef } = useMobileGestures()
  return (
    <div
      data-testid="handle"
      ref={dragHandleRef}
      onClick={() => setMobileCollapsed((value) => !value)}
    />
  )
}

describe('useMobileGestures', () => {
  beforeEach(() => {
    useStore.setState({ mobileInputCollapsed: false })
  })

  afterEach(() => {
    cleanup()
  })

  it('prevents the synthetic click after a tap toggles the mobile handle', () => {
    const { getByTestId } = render(<HandleHarness />)
    const el = getByTestId('handle')

    const touchEnd = createTouchEvent('touchend', [])

    act(() => {
      el.dispatchEvent(createTouchEvent('touchstart', [{ clientY: 10 }]))
      el.dispatchEvent(touchEnd)
    })

    if (!touchEnd.defaultPrevented) {
      fireEvent.click(el)
    }

    expect(touchEnd.defaultPrevented).toBe(true)
    expect(useStore.getState().mobileInputCollapsed).toBe(true)
  })
})
