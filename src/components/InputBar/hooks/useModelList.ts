import { useState, useCallback, useEffect } from 'react'
import { useStore } from '../../../store'
import { listModels } from '../../../lib/api/listModels'
import { isOpenAIProfile } from '../../../types'
import type { ApiProfile } from '../../../types'

export type ModelListState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; models: string[] }
  | { kind: 'error'; message: string }

const IDLE_MODEL_LIST_STATE: ModelListState = { kind: 'idle' }

/**
 * 模块级缓存(按连接参数 key):ModelMenu 关闭即卸载,若缓存放在 hook 实例里,每次打开菜单都要重新请求
 * /models 并转圈。key 含 id/baseUrl/apiKey/proxy,连接参数一变自然失效;in-flight 去重避免菜单在请求
 * 未返回时关闭再打开触发第二次请求。
 */
const modelListCache = new Map<string, string[]>()
const inFlightByKey = new Map<string, Promise<string[]>>()
let requestSeq = 0
const latestRequestByKey = new Map<string, number>()

/** 仅测试用 */
export function __resetModelListCacheForTests(): void {
  modelListCache.clear()
  inFlightByKey.clear()
  latestRequestByKey.clear()
}

export function useModelList(activeProfile: ApiProfile): {
  state: ModelListState
  fetchModels: () => Promise<void>
} {
  const profileKey =
    activeProfile && isOpenAIProfile(activeProfile) && activeProfile.apiKey.trim()
      ? `${activeProfile.id}:${activeProfile.baseUrl}:${activeProfile.apiKey}:${activeProfile.apiProxy ? 'proxy' : 'direct'}`
      : ''
  const [stateByKey, setStateByKey] = useState<Record<string, ModelListState>>({})

  const setKeyState = useCallback((key: string, state: ModelListState) => {
    setStateByKey((prev) => ({ ...prev, [key]: state }))
  }, [])

  const fetchModels = useCallback(
    async (force: boolean = false) => {
      if (!activeProfile || !isOpenAIProfile(activeProfile) || !activeProfile.apiKey.trim()) return
      const profileId = activeProfile.id
      if (!force) {
        const cached = modelListCache.get(profileKey)
        if (cached) {
          setKeyState(profileKey, { kind: 'success', models: cached })
          return
        }
      }
      setKeyState(profileKey, { kind: 'loading' })
      const requestId = ++requestSeq
      latestRequestByKey.set(profileKey, requestId)
      try {
        // 非强制刷新时复用同 key 的在途请求;强制刷新总是发新请求
        let inFlight = force ? undefined : inFlightByKey.get(profileKey)
        if (!inFlight) {
          inFlight = listModels(activeProfile).finally(() => {
            if (inFlightByKey.get(profileKey) === inFlight) inFlightByKey.delete(profileKey)
          })
          inFlightByKey.set(profileKey, inFlight)
        }
        const ids = await inFlight
        if (latestRequestByKey.get(profileKey) !== requestId) return
        // 状态按连接参数 key 隔离；同 key 并发时只允许最后一次请求写入。
        const stillActive = useStore.getState().settings.activeProfileId === profileId
        modelListCache.set(profileKey, ids)
        if (stillActive) setKeyState(profileKey, { kind: 'success', models: ids })
      } catch (err) {
        if (latestRequestByKey.get(profileKey) !== requestId) return
        const stillActive = useStore.getState().settings.activeProfileId === profileId
        if (stillActive) {
          setKeyState(profileKey, {
            kind: 'error',
            message: err instanceof Error ? err.message : String(err),
          })
        }
      }
    },
    [activeProfile, profileKey, setKeyState],
  )

  // 菜单打开 / active profile 切换时：检查缓存，未命中且条件满足则拉取
  useEffect(() => {
    if (!activeProfile) return
    if (!isOpenAIProfile(activeProfile)) return
    if (!activeProfile.apiKey.trim()) return
    // 命中模块缓存时不在 effect 里 setState(渲染阶段已直接从缓存派生成功态),只在未命中时发请求。
    // 经微任务再发起:fetchModels 起手会同步写 loading 态,effect 体内同步 setState 触发级联渲染(lint 亦禁止)
    if (modelListCache.has(profileKey)) return
    let cancelled = false
    void Promise.resolve().then(() => {
      if (!cancelled) void fetchModels(false)
    })
    return () => {
      cancelled = true
    }
  }, [activeProfile, fetchModels, profileKey])

  const cached = profileKey ? modelListCache.get(profileKey) : undefined
  const cachedState: ModelListState | undefined = cached
    ? { kind: 'success', models: cached }
    : undefined
  return {
    state: stateByKey[profileKey] ?? cachedState ?? IDLE_MODEL_LIST_STATE,
    fetchModels: () => fetchModels(true),
  }
}
