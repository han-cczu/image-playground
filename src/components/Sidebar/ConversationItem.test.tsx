// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ConversationItem from './ConversationItem'
import { useStore } from '../../store'

describe('ConversationItem', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    useStore.setState(useStore.getInitialState(), true)
  })

  it('attaches a rejection handler to fire-and-forget rename requests', () => {
    const renamePromise = {
      catch: vi.fn(() => Promise.resolve()),
    } as unknown as Promise<void>
    const renameConversation = vi.fn(() => renamePromise)
    useStore.setState({ renameConversation })

    render(
      <ConversationItem
        conversation={{ id: 'conv-a', title: '旧标题', createdAt: 1, updatedAt: 1 }}
        active={false}
        collapsed={false}
        taskCount={0}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    fireEvent.doubleClick(screen.getByTitle('旧标题（双击重命名）'))
    fireEvent.change(screen.getByLabelText('重命名对话'), { target: { value: '新标题' } })
    fireEvent.keyDown(screen.getByLabelText('重命名对话'), { key: 'Enter' })

    expect(renameConversation).toHaveBeenCalledWith('conv-a', '新标题')
    expect(renamePromise.catch).toHaveBeenCalled()
  })
})
