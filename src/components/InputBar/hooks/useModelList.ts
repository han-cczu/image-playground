import { useState, useRef, useCallback, useEffect } from 'react'
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

export function useModelList(activeProfile: ApiProfile): {
  state: ModelListState
  fetchModels: () => Promise<void>
} {
  /** profileId -> model id list */
  const cacheRef = useRef<Map<string, string[]>>(new Map())
  const requestSeqRef = useRef(0)
  const latestRequestByKeyRef = useRef<Map<string, number>>(new Map())
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
        const cached = cacheRef.current.get(profileKey)
        if (cached) {
          setKeyState(profileKey, { kind: 'success', models: cached })
          return
        }
      }
      setKeyState(profileKey, { kind: 'loading' })
      const requestId = ++requestSeqRef.current
      latestRequestByKeyRef.current.set(profileKey, requestId)
      try {
        const ids = await listModels(activeProfile)
        if (latestRequestByKeyRef.current.get(profileKey) !== requestId) return
        // 状态按连接参数 key 隔离；同 key 并发时只允许最后一次请求写入。
        const stillActive = useStore.getState().settings.activeProfileId === profileId
        cacheRef.current.set(profileKey, ids)
        if (stillActive) setKeyState(profileKey, { kind: 'success', models: ids })
      } catch (err) {
        if (latestRequestByKeyRef.current.get(profileKey) !== requestId) return
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
    const cached = cacheRef.current.get(profileKey)
    if (cached) {
      setKeyState(profileKey, { kind: 'success', models: cached })
      return
    }
    void fetchModels(false)
  }, [activeProfile, fetchModels, profileKey, setKeyState])

  return {
    state: stateByKey[profileKey] ?? IDLE_MODEL_LIST_STATE,
    fetchModels: () => fetchModels(true),
  }
}
