// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SelectionActionBar from './SelectionActionBar'
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

    render(<SelectionActionBar filteredTasks={[selected]} />)
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

    render(<SelectionActionBar filteredTasks={[selected]} />)
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

    render(<SelectionActionBar filteredTasks={[selected]} />)
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

    render(<SelectionActionBar filteredTasks={[selected]} />)
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

    render(<SelectionActionBar filteredTasks={[visible]} />)
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
