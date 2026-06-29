// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { useStore } from '../store'
import TaskGrid from './TaskGrid'

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    conversationId: 'conv-a',
    ...overrides,
  }
}

describe('TaskGrid', () => {
  afterEach(() => {
    cleanup()
    document.body.classList.remove('select-none', 'drag-selecting')
    useStore.setState(useStore.getInitialState(), true)
  })

  it('clears drag-select body state when the window loses focus', () => {
    useStore.setState({
      activeConversationId: 'conv-a',
      tasks: [task()],
    })

    render(
      <div data-drag-select-surface>
        <TaskGrid />
      </div>,
    )

    fireEvent.mouseDown(screen.getByLabelText(/任务：prompt/), {
      button: 0,
      clientX: 10,
      clientY: 10,
    })
    expect(document.body.classList.contains('drag-selecting')).toBe(true)

    fireEvent.blur(window)

    expect(document.body.classList.contains('drag-selecting')).toBe(false)
    expect(document.body.classList.contains('select-none')).toBe(false)
  })

  it('replaces the previous selection when drag-select starts without a modifier key', () => {
    const previouslySelected = task({ id: 'old-task', createdAt: 1 })
    const newlySelected = task({ id: 'new-task', createdAt: 2 })
    useStore.setState({
      activeConversationId: 'conv-a',
      tasks: [previouslySelected, newlySelected],
      selectedTaskIds: [previouslySelected.id],
    })

    const { container } = render(
      <div data-drag-select-surface>
        <TaskGrid />
      </div>,
    )

    const oldCard = container.querySelector<HTMLElement>('[data-task-id="old-task"]')
    const newCard = container.querySelector<HTMLElement>('[data-task-id="new-task"]')
    expect(oldCard).not.toBeNull()
    expect(newCard).not.toBeNull()
    oldCard!.getBoundingClientRect = () =>
      ({
        left: 200,
        top: 200,
        right: 260,
        bottom: 260,
        width: 60,
        height: 60,
      }) as DOMRect
    newCard!.getBoundingClientRect = () =>
      ({
        left: 20,
        top: 20,
        right: 80,
        bottom: 80,
        width: 60,
        height: 60,
      }) as DOMRect

    fireEvent.mouseDown(container.querySelector<HTMLElement>('[data-drag-select-surface]')!, {
      button: 0,
      clientX: 0,
      clientY: 0,
    })
    fireEvent.mouseMove(document, { clientX: 100, clientY: 100 })
    fireEvent.mouseUp(document)

    expect(useStore.getState().selectedTaskIds).toEqual([newlySelected.id])
  })

  it('keeps the previous selection when drag-select starts with the platform modifier key', () => {
    const previouslySelected = task({ id: 'old-task', createdAt: 1 })
    const newlySelected = task({ id: 'new-task', createdAt: 2 })
    useStore.setState({
      activeConversationId: 'conv-a',
      tasks: [previouslySelected, newlySelected],
      selectedTaskIds: [previouslySelected.id],
    })

    const { container } = render(
      <div data-drag-select-surface>
        <TaskGrid />
      </div>,
    )

    const oldCard = container.querySelector<HTMLElement>('[data-task-id="old-task"]')
    const newCard = container.querySelector<HTMLElement>('[data-task-id="new-task"]')
    expect(oldCard).not.toBeNull()
    expect(newCard).not.toBeNull()
    oldCard!.getBoundingClientRect = () =>
      ({
        left: 200,
        top: 200,
        right: 260,
        bottom: 260,
        width: 60,
        height: 60,
      }) as DOMRect
    newCard!.getBoundingClientRect = () =>
      ({
        left: 20,
        top: 20,
        right: 80,
        bottom: 80,
        width: 60,
        height: 60,
      }) as DOMRect

    fireEvent.mouseDown(container.querySelector<HTMLElement>('[data-drag-select-surface]')!, {
      button: 0,
      clientX: 0,
      clientY: 0,
      ctrlKey: true,
    })
    fireEvent.mouseMove(document, { clientX: 100, clientY: 100 })
    fireEvent.mouseUp(document)

    expect(useStore.getState().selectedTaskIds).toEqual([
      previouslySelected.id,
      newlySelected.id,
    ])
  })
})
