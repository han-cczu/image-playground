// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { useStore } from '../store'
import TaskGridMatrix from './TaskGridMatrix'

const mocks = vi.hoisted(() => ({
  exportGridSheet: vi.fn(),
}))

vi.mock('../lib/gridSheetRender', () => ({
  exportGridSheet: mocks.exportGridSheet,
}))

vi.mock('./TaskCard', () => ({
  default: ({
    task,
    onClick,
    isSelected,
  }: {
    task: TaskRecord
    onClick: (e: React.MouseEvent) => void
    isSelected?: boolean
  }) => (
    <button
      type="button"
      data-testid={`task-card-${task.id}`}
      data-selected={String(Boolean(isSelected))}
      onClick={onClick}
    >
      {task.id}
    </button>
  ),
}))

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages: ['image-a'],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    batchId: 'batch-a',
    gridAxes: {
      x: {
        kind: 'quality',
        values: [
          { key: 'low', label: 'low' },
          { key: 'high', label: 'high' },
        ],
      },
    },
    gridCoord: { x: 'low' },
    ...overrides,
  }
}

describe('TaskGridMatrix', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    useStore.setState(useStore.getInitialState(), true)
  })

  it('整批选择包含未展示的同格历史，取消整批仍保留批外选择', () => {
    const old = task({ id: 'old-low', createdAt: 1 })
    const latest = task({ id: 'new-low', createdAt: 3 })
    const high = task({ id: 'high', gridCoord: { x: 'high' }, createdAt: 2 })
    useStore.setState({ selectedTaskIds: ['outside'] })
    render(<TaskGridMatrix batchId="batch-a" tasks={[old, latest, high]} onDelete={vi.fn()} />)

    expect(screen.queryByTestId('task-card-old-low')).toBeNull()
    expect(screen.getByTestId('task-card-new-low')).toBeTruthy()
    expect(screen.getByText(/此批共 3 条任务，含 1 条同格历史记录/)).toBeTruthy()
    const checkbox = screen.getByRole('checkbox', { name: /选中整批/ })
    fireEvent.click(checkbox)
    expect(useStore.getState().selectedTaskIds).toEqual(['outside', old.id, latest.id, high.id])
    fireEvent.click(checkbox)
    expect(useStore.getState().selectedTaskIds).toEqual(['outside'])
  })

  it('reports delayed export success through the latest toast handler', async () => {
    const oldToast = vi.fn()
    const latestToast = vi.fn()
    const exportDone = deferred()
    mocks.exportGridSheet.mockReturnValueOnce(exportDone.promise)

    useStore.setState({ showToast: oldToast })

    render(<TaskGridMatrix batchId="batch-a" tasks={[task()]} onDelete={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '导出对照图' }))
    useStore.setState({ showToast: latestToast })

    await act(async () => {
      exportDone.resolve()
      await exportDone.promise
    })

    expect(latestToast).toHaveBeenCalledWith('对照图已导出', 'success')
    expect(oldToast).not.toHaveBeenCalled()
  })

  it('reports delayed export failure through the latest toast handler', async () => {
    const oldToast = vi.fn()
    const latestToast = vi.fn()
    const exportDone = deferred()
    mocks.exportGridSheet.mockReturnValueOnce(exportDone.promise)

    useStore.setState({ showToast: oldToast })

    render(<TaskGridMatrix batchId="batch-a" tasks={[task()]} onDelete={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '导出对照图' }))
    useStore.setState({ showToast: latestToast })

    await act(async () => {
      exportDone.reject(new Error('disk full'))
      await expect(exportDone.promise).rejects.toThrow('disk full')
    })

    expect(latestToast).toHaveBeenCalledWith('导出失败：disk full', 'error')
    expect(oldToast).not.toHaveBeenCalled()
  })

  it('reports confirmed batch cancellation through the latest toast handler', () => {
    const oldToast = vi.fn()
    const latestToast = vi.fn()
    const runningTask = task({ status: 'running', finishedAt: null, elapsed: null })

    useStore.setState({ showToast: oldToast, tasks: [runningTask] })

    render(<TaskGridMatrix batchId="batch-a" tasks={[runningTask]} onDelete={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '取消批次' }))
    const dialog = useStore.getState().confirmDialog
    expect(dialog).not.toBeNull()

    useStore.setState({ showToast: latestToast })
    act(() => {
      dialog?.action()
    })

    expect(latestToast).toHaveBeenCalledWith('已取消 1 条:中止 0 条在途、跳过 1 条排队', 'success')
    expect(oldToast).not.toHaveBeenCalled()
  })

  it('clears existing selection when a matrix cell is opened without a modifier key', () => {
    const selected = task({ id: 'selected-task', gridCoord: { x: 'low' } })
    const opened = task({ id: 'opened-task', gridCoord: { x: 'high' } })
    useStore.setState({
      selectedTaskIds: [selected.id],
    })

    render(<TaskGridMatrix batchId="batch-a" tasks={[selected, opened]} onDelete={vi.fn()} />)

    fireEvent.click(screen.getByTestId('task-card-opened-task'))

    expect(useStore.getState().detailTaskId).toBe(opened.id)
    expect(useStore.getState().selectedTaskIds).toEqual([])
  })
})
