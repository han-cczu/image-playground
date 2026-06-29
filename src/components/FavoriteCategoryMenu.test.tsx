// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useStore } from '../store'
import FavoriteCategoryMenu from './FavoriteCategoryMenu'

describe('FavoriteCategoryMenu', () => {
  afterEach(() => {
    cleanup()
    useStore.setState(useStore.getInitialState(), true)
  })

  it('closes the open menu on Escape', () => {
    const onSelect = vi.fn()

    render(
      <FavoriteCategoryMenu
        includeAll
        onSelect={onSelect}
        renderTrigger={({ label, toggle }) => (
          <button type="button" onClick={toggle}>
            {label}
          </button>
        )}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '全部分类' }))
    expect(screen.getByText('新建分类')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByText('新建分类')).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('closes the open menu when clicking the trigger again', () => {
    const onSelect = vi.fn()

    render(
      <FavoriteCategoryMenu
        includeAll
        onSelect={onSelect}
        renderTrigger={({ label, toggle }) => (
          <button type="button" onClick={toggle}>
            {label}
          </button>
        )}
      />,
    )

    const trigger = screen.getByRole('button', { name: '全部分类' })
    fireEvent.click(trigger)
    expect(screen.getByText('新建分类')).toBeTruthy()

    fireEvent.click(trigger)

    expect(screen.queryByText('新建分类')).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
  })
})
