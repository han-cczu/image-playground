// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Select from './Select'

const options = [
  { label: 'Alpha', value: 'alpha' },
  { label: 'Beta', value: 'beta' },
] as const

describe('Select', () => {
  afterEach(() => {
    cleanup()
  })

  it('closes an open listbox when disabled and ignores stale option clicks', () => {
    const onChange = vi.fn()
    const { rerender } = render(<Select value="alpha" onChange={onChange} options={[...options]} />)

    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByRole('listbox')).toBeTruthy()

    rerender(<Select value="alpha" onChange={onChange} options={[...options]} disabled />)

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not reopen a stale listbox when re-enabled', () => {
    const onChange = vi.fn()
    const { rerender } = render(<Select value="alpha" onChange={onChange} options={[...options]} />)

    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByRole('listbox')).toBeTruthy()

    rerender(<Select value="alpha" onChange={onChange} options={[...options]} disabled />)
    rerender(<Select value="alpha" onChange={onChange} options={[...options]} />)

    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
