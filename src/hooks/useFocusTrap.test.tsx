// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { useRef, type RefObject } from 'react'
import { useFocusTrap } from './useFocusTrap'

function Trap({
  active,
  label,
  extraContainerRefs,
}: {
  active: boolean
  label: string
  extraContainerRefs?: Array<RefObject<HTMLElement | null>>
}) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(active, ref, { extraContainerRefs })

  if (!active) return null

  return (
    <div ref={ref} tabIndex={-1}>
      <button type="button">{label}</button>
    </div>
  )
}

afterEach(() => {
  cleanup()
})

describe('useFocusTrap', () => {
  it('does not restore focus for a non-top trap while a higher trap is still active', () => {
    const { rerender } = render(
      <>
        <button type="button">background</button>
        <Trap active label="lower" />
      </>,
    )

    expect(document.activeElement?.textContent).toBe('lower')

    rerender(
      <>
        <button type="button">background</button>
        <Trap active label="lower" />
        <Trap active label="upper" />
      </>,
    )

    expect(document.activeElement?.textContent).toBe('upper')

    rerender(
      <>
        <button type="button">background</button>
        <Trap active={false} label="lower" />
        <Trap active label="upper" />
      </>,
    )

    expect(document.activeElement?.textContent).toBe('upper')
  })
})
