// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../../store'
import { listModels } from '../../../lib/api/listModels'
import type { OpenAIProfile } from '../../../types'
import { __resetModelListCacheForTests, useModelList } from './useModelList'

vi.mock('../../../lib/api/listModels', () => ({
  listModels: vi.fn(),
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeProfile(apiKey: string): OpenAIProfile {
  return {
    id: 'profile-a',
    name: 'Profile A',
    provider: 'openai',
    baseUrl: 'https://api.example.com/v1',
    apiKey,
    model: 'gpt-image-1',
    timeout: 60,
    apiMode: 'images',
    codexCli: false,
    apiProxy: false,
  }
}

/** effect 里的请求经微任务发起(见 useModelList 注释),断言 loading 前先让它跑一拍 */
const flushEffects = () =>
  act(async () => {
    await Promise.resolve()
  })

describe('useModelList', () => {
  afterEach(() => {
    vi.clearAllMocks()
    __resetModelListCacheForTests()
    useStore.setState(useStore.getInitialState(), true)
  })

  it('模块级缓存:菜单卸载再挂载不重新请求 /models;同 key 在途请求被复用', async () => {
    const deferred = createDeferred<string[]>()
    vi.mocked(listModels).mockReturnValueOnce(deferred.promise)
    const profile = makeProfile('sk-cache')
    useStore.setState({
      settings: { ...useStore.getState().settings, activeProfileId: profile.id },
    })

    const first = renderHook(() => useModelList(profile))
    await flushEffects()
    // 请求未返回时卸载再挂载:复用在途请求,不发第二次
    first.unmount()
    const second = renderHook(() => useModelList(profile))
    await flushEffects()
    expect(listModels).toHaveBeenCalledTimes(1)

    await act(async () => {
      deferred.resolve(['gpt-image-2'])
      await deferred.promise
    })
    await waitFor(() =>
      expect(second.result.current.state).toEqual({ kind: 'success', models: ['gpt-image-2'] }),
    )

    // 返回后再挂载:直接命中模块级缓存
    second.unmount()
    const third = renderHook(() => useModelList(profile))
    expect(third.result.current.state).toEqual({ kind: 'success', models: ['gpt-image-2'] })
    expect(listModels).toHaveBeenCalledTimes(1)
  })

  it('ignores model-list results for the same profile id after connection settings change', async () => {
    const first = createDeferred<string[]>()
    const second = createDeferred<string[]>()
    vi.mocked(listModels).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const profileA = makeProfile('key-a')
    const profileB = makeProfile('key-b')
    useStore.setState({
      settings: {
        ...useStore.getState().settings,
        activeProfileId: profileA.id,
      },
    })

    const { result, rerender } = renderHook(
      ({ profile }: { profile: OpenAIProfile }) => useModelList(profile),
      { initialProps: { profile: profileA } },
    )

    await flushEffects()

    expect(result.current.state.kind).toBe('loading')

    rerender({ profile: profileB })
    await flushEffects()
    expect(result.current.state.kind).toBe('loading')

    await act(async () => {
      first.resolve(['old-model'])
      await Promise.resolve()
    })
    await flushEffects()
    expect(result.current.state.kind).toBe('loading')

    await act(async () => {
      second.resolve(['new-model'])
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(result.current.state).toEqual({ kind: 'success', models: ['new-model'] })
    })
  })

  it('refetches model lists when the API proxy setting changes', async () => {
    const first = createDeferred<string[]>()
    const second = createDeferred<string[]>()
    vi.mocked(listModels).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const directProfile = makeProfile('key-a')
    const proxyProfile = { ...directProfile, apiProxy: true }
    useStore.setState({
      settings: {
        ...useStore.getState().settings,
        activeProfileId: directProfile.id,
      },
    })

    const { result, rerender } = renderHook(
      ({ profile }: { profile: OpenAIProfile }) => useModelList(profile),
      { initialProps: { profile: directProfile } },
    )

    await act(async () => {
      first.resolve(['direct-model'])
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(result.current.state).toEqual({ kind: 'success', models: ['direct-model'] })
    })

    rerender({ profile: proxyProfile })

    await flushEffects()

    expect(result.current.state.kind).toBe('loading')
    expect(listModels).toHaveBeenCalledTimes(2)

    await act(async () => {
      second.resolve(['proxy-model'])
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(result.current.state).toEqual({ kind: 'success', models: ['proxy-model'] })
    })
  })

  it('ignores stale model-list results when refreshing the same profile key twice', async () => {
    const first = createDeferred<string[]>()
    const second = createDeferred<string[]>()
    vi.mocked(listModels).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const profile = makeProfile('key-a')
    useStore.setState({
      settings: {
        ...useStore.getState().settings,
        activeProfileId: profile.id,
      },
    })

    const { result } = renderHook(() => useModelList(profile))

    await flushEffects()

    expect(result.current.state.kind).toBe('loading')

    act(() => {
      void result.current.fetchModels()
    })
    expect(listModels).toHaveBeenCalledTimes(2)

    await act(async () => {
      second.resolve(['new-model'])
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(result.current.state).toEqual({ kind: 'success', models: ['new-model'] })
    })

    await act(async () => {
      first.resolve(['old-model'])
      await Promise.resolve()
    })

    expect(result.current.state).toEqual({ kind: 'success', models: ['new-model'] })
  })
})
