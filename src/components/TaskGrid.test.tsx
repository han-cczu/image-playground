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

    expect(useStore.getState().selectedTaskIds).toEqual([previouslySelected.id, newlySelected.id])
  })

  /**
   * 矩阵「选中整批」是 <label><input type=checkbox/>文字</label>:label 会把 click 转发给内部 checkbox,
   * 但 mousedown 若被 document 捕获层当作框选起点,mouseup 就会先 clearSelection,随后转发的 click
   * 读到 allSelected=false 反向把整批重新选上——点文字永远无法取消勾选,且批外已选任务被静默清掉。
   * 该路径只有真实 TaskGrid 的 document 监听才能复现,故放这里而非 TaskGridMatrix.test.tsx。
   */
  describe('矩阵「选中整批」label', () => {
    const gridAxes: NonNullable<TaskRecord['gridAxes']> = {
      x: {
        kind: 'quality',
        values: [
          { key: 'low', label: 'low' },
          { key: 'high', label: 'high' },
        ],
      },
    }

    function renderMatrixWithOutsideCard() {
      const cellLow = task({
        id: 'cell-low',
        createdAt: 1,
        batchId: 'batch-a',
        gridAxes,
        gridCoord: { x: 'low' },
      })
      const cellHigh = task({
        id: 'cell-high',
        createdAt: 2,
        batchId: 'batch-a',
        gridAxes,
        gridCoord: { x: 'high' },
      })
      const outside = task({ id: 'outside', createdAt: 3 })
      useStore.setState({
        activeConversationId: 'conv-a',
        tasks: [cellLow, cellHigh, outside],
        selectedTaskIds: [cellLow.id, cellHigh.id, outside.id],
      })

      render(
        <div data-drag-select-surface>
          <TaskGrid />
        </div>,
      )

      const label = screen.getByText('选中整批').closest('label')
      expect(label).not.toBeNull()
      const checkbox = label!.querySelector<HTMLInputElement>('input[type="checkbox"]')
      expect(checkbox).not.toBeNull()
      expect(checkbox!.checked).toBe(true)
      return { label: label!, checkbox: checkbox!, cellLow, cellHigh, outside }
    }

    it('在 label 文字上按下鼠标不会启动框选', () => {
      const { label } = renderMatrixWithOutsideCard()

      fireEvent.mouseDown(label, { button: 0, clientX: 10, clientY: 10 })

      expect(document.body.classList.contains('drag-selecting')).toBe(false)
      expect(document.body.classList.contains('select-none')).toBe(false)
    })

    it('点 label 文字能取消整批勾选,且保留批外已选任务', () => {
      const { label, checkbox, cellLow, cellHigh, outside } = renderMatrixWithOutsideCard()

      // 模拟真实浏览器的事件序列:mousedown → mouseup → label 转发的 click
      fireEvent.mouseDown(label, { button: 0, clientX: 10, clientY: 10 })
      fireEvent.mouseUp(document)
      expect(useStore.getState().selectedTaskIds).toEqual([cellLow.id, cellHigh.id, outside.id])

      fireEvent.click(label)

      expect(useStore.getState().selectedTaskIds).toEqual([outside.id])
      expect(checkbox.checked).toBe(false)
    })
  })
})
