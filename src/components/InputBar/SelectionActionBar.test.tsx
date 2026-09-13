// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import SelectionActionBar from './SelectionActionBar'
import { buildTaskPresentation } from '../../lib/taskPresentation'
import { DEFAULT_PARAMS, type TaskRecord } from '../../types'
import { clearTaskFavorite, setTaskFavoriteCategory, useStore } from '../../store'
import { deleteTask } from '../../lib/db'

vi.mock('../../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store')>()
  return {
    ...actual,
    setTaskFavoriteCategory: vi.fn(async () => undefined),
    clearTaskFavorite: vi.fn(async () => undefined),
  }
})

vi.mock('../../lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/db')>()
  return {
    ...actual,
    deleteTask: vi.fn(async () => undefined),
    deleteImage: vi.fn(async () => undefined),
  }
})

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
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  useStore.setState(useStore.getInitialState(), true)
})

describe('SelectionActionBar', () => {
  const axes: NonNullable<TaskRecord['gridAxes']> = {
    x: {
      kind: 'quality',
      values: [
        { key: 'low', label: '低' },
        { key: 'high', label: '高' },
      ],
    },
  }
  const cell = (id: string, x: string, createdAt = 1) =>
    task({
      id,
      batchId: 'batch-a',
      gridAxes: axes,
      gridCoord: { x },
      createdAt,
    })

  it('普通全选与删除排除上限处未显示的整个矩阵', async () => {
    const first = task({ id: 'first' })
    const second = task({ id: 'second' })
    const low = cell('low', 'low')
    const high = cell('high', 'high')
    const records = [first, second, low, high]
    useStore.setState({ tasks: records, selectedTaskIds: [first.id, low.id], showToast: vi.fn() })

    render(<SelectionActionBar presentation={buildTaskPresentation(records, 3)} />)
    fireEvent.click(screen.getByRole('button', { name: '选择当前显示的任务' }))
    expect(useStore.getState().selectedTaskIds).toEqual([first.id, second.id])
    fireEvent.click(screen.getByRole('button', { name: '删除选中' }))
    await act(async () => {
      await useStore.getState().confirmDialog?.action()
    })
    expect(deleteTask).toHaveBeenCalledWith(first.id)
    expect(deleteTask).toHaveBeenCalledWith(second.id)
    expect(deleteTask).not.toHaveBeenCalledWith(low.id)
    expect(deleteTask).not.toHaveBeenCalledWith(high.id)
  })

  it('普通全选只加入格子代表，整批选中的历史成员保留并在删除确认中说明', async () => {
    const outside = task({ id: 'outside' })
    const old = cell('old-low', 'low', 1)
    const latest = cell('new-low', 'low', 3)
    const high = cell('high', 'high', 2)
    const records = [outside, latest, high, old]
    useStore.setState({ tasks: records, selectedTaskIds: [outside.id], showToast: vi.fn() })
    render(<SelectionActionBar presentation={buildTaskPresentation(records)} />)

    fireEvent.click(screen.getByRole('button', { name: '选择当前显示的任务' }))
    expect(useStore.getState().selectedTaskIds).toEqual([outside.id, latest.id, high.id])
    act(() => useStore.getState().setSelectedTaskIds([outside.id, latest.id, high.id, old.id]))
    expect(screen.getByText('已选择 4 条任务')).toBeTruthy()
    expect(screen.getByText(/涉及 1 个矩阵批次，包含 1 条同格历史记录/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '删除选中' }))
    const dialog = useStore.getState().confirmDialog
    expect(dialog?.message).toContain('4 条记录')
    expect(dialog?.message).toContain('1 条同格历史记录')
    await act(async () => {
      await dialog?.action()
    })
    expect(deleteTask).toHaveBeenCalledWith(old.id)
  })

  it('returns the bulk favorite promise from the confirmation action', () => {
    const selected = task({ id: 'selected-task' })
    const setConfirmDialog = vi.fn()
    let resolveFavorite!: () => void
    vi.mocked(setTaskFavoriteCategory).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFavorite = () => resolve(undefined)
      }),
    )
    useStore.setState({
      tasks: [selected],
      selectedTaskIds: [selected.id],
      setConfirmDialog,
      clearSelection: vi.fn(),
    })

    render(<SelectionActionBar presentation={buildTaskPresentation([selected])} />)
    fireEvent.click(screen.getByTitle('收藏'))
    fireEvent.click(screen.getByRole('button', { name: '默认分类' }))

    const dialog = vi.mocked(setConfirmDialog).mock.calls[0][0] as {
      action: () => unknown
    }
    const result = dialog.action()

    expect(result).toHaveProperty('then')
    resolveFavorite()
  })

  it('returns the bulk clear-favorite promise from the confirmation action', () => {
    const selected = task({
      id: 'selected-task',
      isFavorite: true,
      favoriteCategoryId: 'default-favorite-category',
    })
    const setConfirmDialog = vi.fn()
    let resolveClear!: () => void
    vi.mocked(clearTaskFavorite).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveClear = () => resolve(undefined)
      }),
    )
    useStore.setState({
      tasks: [selected],
      selectedTaskIds: [selected.id],
      setConfirmDialog,
      clearSelection: vi.fn(),
    })

    render(<SelectionActionBar presentation={buildTaskPresentation([selected])} />)
    fireEvent.click(screen.getByTitle('收藏分类 / 取消收藏'))
    fireEvent.click(screen.getByRole('button', { name: '取消收藏' }))

    const dialog = vi.mocked(setConfirmDialog).mock.calls[0][0] as {
      action: () => unknown
    }
    const result = dialog.action()

    expect(result).toHaveProperty('then')
    resolveClear()
  })

  it('reports failed bulk favorite writes through the latest toast handler', async () => {
    const selected = task({ id: 'selected-task' })
    const showToast = vi.fn()
    const setConfirmDialog = vi.fn()
    vi.mocked(setTaskFavoriteCategory).mockRejectedValueOnce(new Error('write failed'))
    useStore.setState({
      tasks: [selected],
      selectedTaskIds: [selected.id],
      setConfirmDialog,
      clearSelection: vi.fn(),
      showToast,
    })

    render(<SelectionActionBar presentation={buildTaskPresentation([selected])} />)
    fireEvent.click(screen.getByTitle('收藏'))
    fireEvent.click(screen.getByRole('button', { name: '默认分类' }))

    const dialog = vi.mocked(setConfirmDialog).mock.calls[0][0] as {
      action: () => Promise<unknown>
    }
    await dialog.action()

    expect(showToast).toHaveBeenCalledWith('批量收藏失败：1 条未保存', 'error')
  })

  it('returns the bulk delete promise from the confirmation action', () => {
    const selected = task({ id: 'selected-task' })
    const setConfirmDialog = vi.fn()
    let resolveDelete!: () => void
    vi.mocked(deleteTask).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDelete = () => resolve(undefined)
      }),
    )
    useStore.setState({
      tasks: [selected],
      selectedTaskIds: [selected.id],
      setConfirmDialog,
      showToast: vi.fn(),
    })

    render(<SelectionActionBar presentation={buildTaskPresentation([selected])} />)
    fireEvent.click(screen.getByRole('button', { name: '删除选中' }))

    const dialog = vi.mocked(setConfirmDialog).mock.calls[0][0] as {
      action: () => unknown
    }
    const result = dialog.action()

    expect(result).toHaveProperty('then')
    resolveDelete()
  })

  it('bulk delete only acts on selected tasks that are still visible', () => {
    const visible = task({ id: 'visible-task' })
    const hidden = task({ id: 'hidden-task' })
    const setConfirmDialog = vi.fn()
    useStore.setState({
      tasks: [visible, hidden],
      selectedTaskIds: [visible.id, hidden.id],
      setConfirmDialog,
      showToast: vi.fn(),
    })

    render(<SelectionActionBar presentation={buildTaskPresentation([visible])} />)
    fireEvent.click(screen.getByRole('button', { name: '删除选中' }))

    const dialog = vi.mocked(setConfirmDialog).mock.calls[0][0] as {
      message: string
      action: () => Promise<unknown>
    }

    expect(dialog.message).toContain('1 条')
    void dialog.action()
    expect(deleteTask).toHaveBeenCalledWith('visible-task')
    expect(deleteTask).not.toHaveBeenCalledWith('hidden-task')
  })
})
