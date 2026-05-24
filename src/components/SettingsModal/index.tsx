import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { ModelListDropdown } from './ModelListDropdown'
import { normalizeTimeout } from './useTimeoutInput'
import { normalizeBaseUrl } from '../../lib/api'
import { isApiProxyAvailable, readClientDevProxyConfig } from '../../lib/api/devProxy'
import { listModels } from '../../lib/api/listModels'
import { useStore, exportData, importData, clearAllData } from '../../store'
import type { ImportMode } from '../../lib/exportImport'
import {
  createDefaultOpenAIProfile,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_IMAGES_MODEL,
  DEFAULT_OPENAI_PROFILE_ID,
  DEFAULT_OPTIMIZER_SYSTEM_PROMPT,
  DEFAULT_RESPONSES_MODEL,
  DEFAULT_SETTINGS,
  getActiveApiProfile,
  normalizePromptOptimizer,
  normalizeSettings,
  switchApiProfileProvider,
} from '../../lib/api/apiProfiles'
import type { ApiProfile, AppSettings, OpenAIProfile } from '../../types'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import { FAVORITE_CATEGORY_COLORS } from '../../lib/favoriteCategories'
import Select from '../Select'

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function providerLabel(provider: string) {
  if (provider === 'gemini') return 'Gemini'
  return 'OpenAI'
}

export default function SettingsModal() {
  const showSettings = useStore((s) => s.showSettings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)
  const favoriteCategories = useStore((s) => s.favoriteCategories)
  const updateFavoriteCategory = useStore((s) => s.updateFavoriteCategory)
  const deleteFavoriteCategory = useStore((s) => s.deleteFavoriteCategory)
  const moveFavoriteCategory = useStore((s) => s.moveFavoriteCategory)
  const importInputRef = useRef<HTMLInputElement>(null)

  const [draft, setDraft] = useState<AppSettings>(normalizeSettings(settings))
  const [timeoutInput, setTimeoutInput] = useState(String(getActiveApiProfile(settings).timeout))
  const [showApiKey, setShowApiKey] = useState(false)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [modelListOpen, setModelListOpen] = useState(false)
  const [modelListLoading, setModelListLoading] = useState(false)
  const [modelList, setModelList] = useState<string[] | null>(null)
  const [modelListError, setModelListError] = useState<string | null>(null)
  const [pendingImportMode, setPendingImportMode] = useState<ImportMode>('merge')

  // 提示词优化 API 相关 state
  const [showOptimizerApiKey, setShowOptimizerApiKey] = useState(false)
  const [optimizerTimeoutInput, setOptimizerTimeoutInput] = useState(
    String(normalizeSettings(settings).promptOptimizer.timeout),
  )
  const [optimizerModelListOpen, setOptimizerModelListOpen] = useState(false)
  const [optimizerModelListLoading, setOptimizerModelListLoading] = useState(false)
  const [optimizerModelList, setOptimizerModelList] = useState<string[] | null>(null)
  const [optimizerModelListError, setOptimizerModelListError] = useState<string | null>(null)

  const apiProxyAvailable = isApiProxyAvailable(readClientDevProxyConfig())
  const activeProfile = draft.profiles.find((profile) => profile.id === draft.activeProfileId) ?? draft.profiles[0] ?? getActiveApiProfile(draft)
  const apiProxyEnabled = apiProxyAvailable && activeProfile.provider === 'openai' && activeProfile.apiProxy

  const getDefaultModelForMode = (apiMode: AppSettings['apiMode']) =>
    apiMode === 'responses' ? DEFAULT_RESPONSES_MODEL : DEFAULT_IMAGES_MODEL

  const wasSettingsOpenRef = useRef(false)

  // 把 timeoutInput 折叠回 draft：在保存与 dirty 检测时用,确保 timeoutInput 中的改动也算数
  const buildFlushedDraft = useCallback((): AppSettings => {
    let next = draft

    const nextTimeout = Number(timeoutInput)
    const normalizedTimeout =
      timeoutInput.trim() === '' || Number.isNaN(nextTimeout) ? activeProfile.timeout : nextTimeout
    if (normalizedTimeout !== activeProfile.timeout) {
      next = {
        ...next,
        profiles: next.profiles.map((profile) =>
          profile.id === activeProfile.id
            ? ({ ...profile, timeout: normalizedTimeout } as ApiProfile)
            : profile,
        ),
      }
    }

    const optimizerTimeoutRaw = Number(optimizerTimeoutInput)
    const normalizedOptimizerTimeout =
      optimizerTimeoutInput.trim() === '' || Number.isNaN(optimizerTimeoutRaw) || optimizerTimeoutRaw <= 0
        ? next.promptOptimizer.timeout
        : optimizerTimeoutRaw
    if (normalizedOptimizerTimeout !== next.promptOptimizer.timeout) {
      next = {
        ...next,
        promptOptimizer: { ...next.promptOptimizer, timeout: normalizedOptimizerTimeout },
      }
    }

    return next
  }, [draft, activeProfile.id, activeProfile.timeout, timeoutInput, optimizerTimeoutInput])

  const isDirty = useMemo(
    () => JSON.stringify(buildFlushedDraft()) !== JSON.stringify(settings),
    [buildFlushedDraft, settings],
  )

  useEffect(() => {
    if (!showSettings) {
      wasSettingsOpenRef.current = false
      return
    }
    if (wasSettingsOpenRef.current) return

    wasSettingsOpenRef.current = true
    const nextDraft = normalizeSettings(apiProxyAvailable ? settings : {
      ...settings,
      profiles: settings.profiles.map((profile) => ({ ...profile, apiProxy: false })),
    })
    setDraft(nextDraft)
    setTimeoutInput(String(getActiveApiProfile(nextDraft).timeout))
    setOptimizerTimeoutInput(String(nextDraft.promptOptimizer.timeout))
  }, [apiProxyAvailable, showSettings, settings])

  useEffect(() => {
    setTimeoutInput(String(activeProfile.timeout))
  }, [activeProfile.id, activeProfile.timeout])

  const commitSettings = (nextDraft: AppSettings) => {
    const normalizedProfiles: ApiProfile[] = nextDraft.profiles.map((profile) => {
      const trimmedName = profile.name.trim() || (profile.id === DEFAULT_OPENAI_PROFILE_ID ? '默认' : '新配置')
      const trimmedTimeout = Number(profile.timeout) || DEFAULT_SETTINGS.timeout
      if (profile.provider === 'gemini') {
        return {
          ...profile,
          name: trimmedName,
          baseUrl: profile.baseUrl.trim().replace(/\/+$/, '') || DEFAULT_GEMINI_BASE_URL,
          model: profile.model.trim() || DEFAULT_GEMINI_MODEL,
          timeout: trimmedTimeout,
        }
      }
      return {
        ...profile,
        name: trimmedName,
        baseUrl: normalizeBaseUrl(profile.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl),
        model: profile.model.trim() || getDefaultModelForMode(profile.apiMode),
        timeout: trimmedTimeout,
        apiProxy: apiProxyAvailable ? profile.apiProxy : false,
      }
    })
    const fallbackProfile = createDefaultOpenAIProfile({ id: newId('openai') })
    const normalizedOptimizer = normalizePromptOptimizer({
      ...nextDraft.promptOptimizer,
      baseUrl: nextDraft.promptOptimizer.baseUrl.trim(),
      apiKey: nextDraft.promptOptimizer.apiKey.trim(),
      model: nextDraft.promptOptimizer.model.trim(),
    })
    const normalizedDraft = normalizeSettings({
      ...nextDraft,
      profiles: normalizedProfiles.length ? normalizedProfiles : [fallbackProfile],
      activeProfileId: normalizedProfiles.some((profile) => profile.id === nextDraft.activeProfileId)
        ? nextDraft.activeProfileId
        : (normalizedProfiles[0]?.id ?? fallbackProfile.id),
      promptOptimizer: normalizedOptimizer,
    })
    setDraft(normalizedDraft)
    setOptimizerTimeoutInput(String(normalizedDraft.promptOptimizer.timeout))
    setSettings(normalizedDraft)
  }

  const updateActiveProfile = (patch: Partial<ApiProfile>) => {
    setDraft((prev) => ({
      ...prev,
      profiles: prev.profiles.map((profile) =>
        profile.id === activeProfile.id ? ({ ...profile, ...patch } as ApiProfile) : profile,
      ),
    }))
  }

  const resetDraft = useCallback(() => {
    const fresh = normalizeSettings(settings)
    setDraft(fresh)
    setTimeoutInput(String(getActiveApiProfile(fresh).timeout))
    setOptimizerTimeoutInput(String(fresh.promptOptimizer.timeout))
  }, [settings])

  const handleClose = () => {
    if (!isDirty) {
      setShowSettings(false)
      return
    }
    setConfirmDialog({
      title: '放弃未保存的改动?',
      message: '设置面板有未保存的改动，关闭将丢失这些改动。是否继续?',
      confirmText: '放弃改动',
      tone: 'warning',
      action: () => {
        resetDraft()
        setShowSettings(false)
      },
    })
  }

  const handleSave = () => {
    commitSettings(buildFlushedDraft())
    showToast('设置已保存', 'success')
    setShowSettings(false)
  }

  const commitTimeout = useCallback(() => {
    const nextTimeout = Number(timeoutInput)
    const normalizedTimeout =
      timeoutInput.trim() === '' ? DEFAULT_SETTINGS.timeout : Number.isNaN(nextTimeout) ? activeProfile.timeout : nextTimeout
    setTimeoutInput(String(normalizedTimeout))
    if (normalizedTimeout !== activeProfile.timeout) {
      updateActiveProfile({ timeout: normalizedTimeout })
    }
  }, [activeProfile.id, activeProfile.timeout, timeoutInput])

  useCloseOnEscape(showSettings, handleClose)

  useEffect(() => {
    setModelListOpen(false)
    setModelList(null)
    setModelListError(null)
  }, [activeProfile.id, activeProfile.baseUrl, activeProfile.apiKey])

  const fetchModelList = useCallback(async () => {
    if (activeProfile.provider !== 'openai') return
    setModelListOpen(true)
    setModelListLoading(true)
    setModelListError(null)
    try {
      const ids = await listModels(activeProfile)
      setModelList(ids)
      if (ids.length === 0) setModelListError('接口返回为空')
    } catch (err) {
      setModelList(null)
      setModelListError(err instanceof Error ? err.message : String(err))
    } finally {
      setModelListLoading(false)
    }
  }, [activeProfile])

  // 提示词优化 API 模型列表副作用：配置变化时关闭并清空缓存
  useEffect(() => {
    setOptimizerModelListOpen(false)
    setOptimizerModelList(null)
    setOptimizerModelListError(null)
  }, [draft.promptOptimizer.baseUrl, draft.promptOptimizer.apiKey])

  const fetchOptimizerModelList = useCallback(async () => {
    setOptimizerModelListOpen(true)
    setOptimizerModelListLoading(true)
    setOptimizerModelListError(null)
    try {
      const tempProfile: OpenAIProfile = {
        id: 'optimizer-temp',
        name: 'optimizer',
        provider: 'openai',
        baseUrl: draft.promptOptimizer.baseUrl,
        apiKey: draft.promptOptimizer.apiKey,
        model: draft.promptOptimizer.model,
        timeout: draft.promptOptimizer.timeout,
        apiMode: 'images',
        codexCli: false,
        apiProxy: false,
      }
      const ids = await listModels(tempProfile)
      setOptimizerModelList(ids)
      if (ids.length === 0) setOptimizerModelListError('接口返回为空')
    } catch (err) {
      setOptimizerModelList(null)
      setOptimizerModelListError(err instanceof Error ? err.message : String(err))
    } finally {
      setOptimizerModelListLoading(false)
    }
  }, [draft.promptOptimizer.baseUrl, draft.promptOptimizer.apiKey, draft.promptOptimizer.model, draft.promptOptimizer.timeout])

  const updatePromptOptimizer = (patch: Partial<AppSettings['promptOptimizer']>) => {
    setDraft((prev) => ({
      ...prev,
      promptOptimizer: { ...prev.promptOptimizer, ...patch },
    }))
  }

  if (!showSettings) return null

  const runImport = async (file: File, mode: ImportMode) => {
    const imported = await importData(file, { mode })
    if (imported) {
      const nextDraft = normalizeSettings(useStore.getState().settings)
      setDraft(nextDraft)
      setTimeoutInput(String(getActiveApiProfile(nextDraft).timeout))
      setOptimizerTimeoutInput(String(nextDraft.promptOptimizer.timeout))
      setShowProfileMenu(false)
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      await runImport(file, pendingImportMode)
    }
    e.target.value = ''
    setPendingImportMode('merge')
  }

  const selectImportFile = (mode: ImportMode) => {
    setPendingImportMode(mode)
    importInputRef.current?.click()
  }

  const handleClearAllData = async () => {
    await clearAllData()
    const nextDraft = normalizeSettings(useStore.getState().settings)
    setDraft(nextDraft)
    setTimeoutInput(String(getActiveApiProfile(nextDraft).timeout))
    setOptimizerTimeoutInput(String(nextDraft.promptOptimizer.timeout))
    setShowProfileMenu(false)
  }

  const createNewProfile = () => {
    const profile = createDefaultOpenAIProfile({ id: newId('openai'), name: '新配置' })
    setDraft(normalizeSettings({
      ...draft,
      profiles: [...draft.profiles, profile],
      activeProfileId: profile.id,
    }))
    setShowProfileMenu(false)
  }

  const switchProfile = (id: string) => {
    setDraft(normalizeSettings({ ...draft, activeProfileId: id }))
    setShowProfileMenu(false)
  }

  const deleteProfile = (id: string) => {
    if (draft.profiles.length <= 1) return
    const nextProfiles = draft.profiles.filter((item) => item.id !== id)
    setDraft(normalizeSettings({
      ...draft,
      profiles: nextProfiles,
      activeProfileId: draft.activeProfileId === id ? nextProfiles[0].id : draft.activeProfileId,
    }))
  }

  const handleDeleteCategory = (categoryId: string, categoryName: string) => {
    setConfirmDialog({
      title: '删除收藏分类',
      message: `确定要删除分类「${categoryName.trim() || '未命名分类'}」吗？使用此分类的记录会变为未分组收藏。`,
      confirmText: '删除分类',
      tone: 'warning',
      action: () => {
        void deleteFavoriteCategory(categoryId).catch((err) => {
          showToast(`删除分类失败：${err instanceof Error ? err.message : String(err)}`, 'error')
        })
      },
    })
  }

  return (
    <div data-no-drag-select className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in"
        onClick={handleClose}
      />
      <div
        className="relative z-10 w-full max-w-md sm:max-w-lg md:max-w-2xl rounded-3xl border border-white/50 bg-white/95 p-5 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 overflow-y-auto max-h-[85vh] custom-scrollbar"
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            设置
          </h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 dark:text-gray-500 font-mono select-none">v{__APP_VERSION__}</span>
            <button
              onClick={handleClose}
              className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
              aria-label="关闭"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="space-y-5">
          <section className="rounded-2xl bg-gray-50/40 dark:bg-white/[0.02] p-5">
            <div className="mb-4 flex items-center justify-between gap-3 relative">
              <h4 className="text-base font-semibold text-gray-800 dark:text-gray-200">
                习惯配置
              </h4>
            </div>
            <div className="space-y-4">
              <div className="block">
                <div className="mb-1 flex items-center justify-between">
                  <span className="block text-xs text-gray-500 dark:text-gray-400">提交任务后清空输入框</span>
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, clearInputAfterSubmit: !draft.clearInputAfterSubmit })}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${draft.clearInputAfterSubmit ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                    role="switch"
                    aria-checked={draft.clearInputAfterSubmit}
                    aria-label="提交任务后清空输入框"
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-200 ${draft.clearInputAfterSubmit ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                  </button>
                </div>
                <div data-selectable-text className="text-xs text-gray-400 dark:text-gray-500">
                  开启后，提交成功创建任务时会清空提示词和参考图。
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-gray-50/40 dark:bg-white/[0.02] p-5">
            <div className="mb-4 flex items-center justify-between gap-3 relative">
              <h4 className="text-base font-semibold text-gray-800 dark:text-gray-200">
                API 配置
              </h4>

              <div className="relative w-44 sm:w-48">
                <button
                  type="button"
                  onClick={() => setShowProfileMenu(!showProfileMenu)}
                  className="flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:hover:bg-white/[0.06]"
                  title={activeProfile.name}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate">{activeProfile.name}</span>
                    <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                      {providerLabel(activeProfile.provider)}
                    </span>
                  </span>
                  <svg className={`w-3.5 h-3.5 flex-shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${showProfileMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showProfileMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowProfileMenu(false)} />
                    <div className="absolute right-0 top-full z-50 mt-1.5 max-h-60 w-full overflow-hidden overflow-y-auto rounded-xl border border-gray-200/60 bg-white/95 py-1 shadow-[0_8px_30px_rgb(0,0,0,0.12)] ring-1 ring-black/5 backdrop-blur-xl animate-dropdown-down dark:border-white/[0.08] dark:bg-gray-900/95 dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] dark:ring-white/10 custom-scrollbar">
                      <button
                        type="button"
                        onClick={createNewProfile}
                        className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10"
                      >
                        <span className="truncate">创建新配置</span>
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        </span>
                      </button>
                      <div>
                        {draft.profiles.map(profile => (
                          <div
                            key={profile.id}
                            title={profile.name}
                            className={`group flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-xs transition-colors ${profile.id === activeProfile.id ? 'bg-blue-50 font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-400' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.06]'}`}
                          >
                            <button
                              type="button"
                              onClick={() => switchProfile(profile.id)}
                              className="flex min-w-0 flex-1 items-center gap-2 pr-2"
                            >
                              <span className="min-w-0 truncate">{profile.name}</span>
                              <span className={`rounded px-1.5 py-0.5 text-xs shrink-0 ${profile.id === activeProfile.id ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' : 'bg-gray-100 text-gray-500 dark:bg-white/[0.08] dark:text-gray-400'}`}>
                                {providerLabel(profile.provider)}
                              </span>
                            </button>

                            {draft.profiles.length > 1 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setConfirmDialog({
                                    title: '删除配置',
                                    message: `确定要删除配置「${profile.name}」吗？`,
                                    action: () => deleteProfile(profile.id)
                                  })
                                }}
                                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 opacity-60 transition-all hover:bg-red-50 hover:text-red-500 hover:opacity-100 dark:hover:bg-red-500/10"
                                aria-label="删除配置"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">配置名称</span>
                <input
                  value={activeProfile.name}
                  onChange={(e) => updateActiveProfile({ name: e.target.value })}
                  type="text"
                  className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">服务商类型</span>
                <Select
                  value={activeProfile.provider}
                  onChange={(value) => updateActiveProfile(switchApiProfileProvider(activeProfile, value as ApiProfile['provider']))}
                  options={[{ label: 'OpenAI 兼容接口', value: 'openai' }, { label: 'Google Gemini', value: 'gemini' }]}
                  className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                />
              </label>

              {activeProfile.provider === 'openai' && (
                <label className="block">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="block text-xs text-gray-500 dark:text-gray-400">API URL</span>
                    <div
                      onClick={(e) => {
                        e.preventDefault()
                        updateActiveProfile({ codexCli: !activeProfile.codexCli })
                      }}
                      className="flex cursor-pointer items-center gap-1.5"
                      role="switch"
                      aria-checked={activeProfile.codexCli}
                      aria-label="Codex CLI"
                    >
                      <span className={`text-xs transition-colors ${activeProfile.codexCli ? 'text-blue-500 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}>Codex CLI</span>
                      <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${activeProfile.codexCli ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-200 ${activeProfile.codexCli ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                      </span>
                    </div>
                  </div>
                  <input
                    value={activeProfile.baseUrl}
                    onChange={(e) => updateActiveProfile({ baseUrl: e.target.value })}
                    type="text"
                    disabled={apiProxyEnabled}
                    placeholder={DEFAULT_SETTINGS.baseUrl}
                    className={`w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50 ${apiProxyEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                  />
                  <div data-selectable-text className="mt-1 min-h-[22px] flex items-center text-xs text-gray-400 dark:text-gray-500">
                    {apiProxyEnabled ? (
                      <span className="text-yellow-600 dark:text-yellow-500">已开启代理，实际请求目标由部署端决定，此处设置被忽略。</span>
                    ) : (
                      <span>支持通过查询参数覆盖：<code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">?apiUrl=</code>，<code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">codexCli=true</code></span>
                    )}
                  </div>
                </label>
              )}

              {activeProfile.provider === 'gemini' && (
                <label className="block">
                  <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">API URL</span>
                  <input
                    value={activeProfile.baseUrl}
                    onChange={(e) => updateActiveProfile({ baseUrl: e.target.value })}
                    type="text"
                    placeholder={DEFAULT_GEMINI_BASE_URL}
                    className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                  />
                  <div data-selectable-text className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    默认走 Google AI Studio。如使用代理或第三方兼容服务，可在此处覆盖。
                  </div>
                </label>
              )}

              {apiProxyAvailable && activeProfile.provider === 'openai' && (
                <div className="block">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="block text-xs text-gray-500 dark:text-gray-400">API 代理</span>
                    <button
                      type="button"
                      onClick={() => updateActiveProfile({ apiProxy: !activeProfile.apiProxy })}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${activeProfile.apiProxy ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                      role="switch"
                      aria-checked={activeProfile.apiProxy}
                      aria-label="API 代理"
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-200 ${activeProfile.apiProxy ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                  <div data-selectable-text className="text-xs text-gray-400 dark:text-gray-500">
                    由当前部署提供同源代理，用于解决浏览器跨域限制；开启后 API URL 设置会被忽略。
                  </div>
                </div>
              )}

              <div className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">API Key</span>
                <div className="relative">
                  <input
                    value={activeProfile.apiKey}
                    onChange={(e) => updateActiveProfile({ apiKey: e.target.value })}
                    type={showApiKey ? 'text' : 'password'}
                    placeholder={activeProfile.provider === 'gemini' ? 'AIza...' : 'sk-...'}
                    className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 pr-10 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
                    tabIndex={-1}
                  >
                    {showApiKey ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    )}
                  </button>
                </div>
                <div data-selectable-text className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  URL 临时传入密钥请使用 hash：<code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">#apiKey=</code>，读取后会自动清除。
                </div>
              </div>

              {activeProfile.provider === 'openai' && (
                <label className="block">
                  <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">API 接口</span>
                  <Select
                    value={activeProfile.apiMode ?? DEFAULT_SETTINGS.apiMode}
                    onChange={(value) => {
                      const apiMode = value as AppSettings['apiMode']
                      const nextModel =
                        activeProfile.model === DEFAULT_IMAGES_MODEL || activeProfile.model === DEFAULT_RESPONSES_MODEL
                          ? getDefaultModelForMode(apiMode)
                          : activeProfile.model
                      updateActiveProfile({ apiMode, model: nextModel })
                    }}
                    options={[
                      { label: 'Images API (/v1/images)', value: 'images' },
                      { label: 'Responses API (/v1/responses)', value: 'responses' },
                    ]}
                    className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                  />
                  <div data-selectable-text className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    支持通过查询参数覆盖：<code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">apiMode=images</code> 或 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">apiMode=responses</code>。
                  </div>
                </label>
              )}

              <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  模型 ID
                </span>
                <ModelListDropdown
                  value={activeProfile.model}
                  onChange={(model) => updateActiveProfile({ model })}
                  onFetch={fetchModelList}
                  isLoading={modelListLoading}
                  isOpen={modelListOpen}
                  onOpenChange={setModelListOpen}
                  modelList={modelList}
                  error={modelListError}
                  placeholder={activeProfile.provider === 'gemini' ? DEFAULT_GEMINI_MODEL : getDefaultModelForMode(activeProfile.apiMode ?? DEFAULT_SETTINGS.apiMode)}
                  showFetchButton={activeProfile.provider === 'openai'}
                />
                <div data-selectable-text className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  {activeProfile.provider === 'gemini' ? (
                    <>使用 Google 多模态图像模型，例如 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">{DEFAULT_GEMINI_MODEL}</code>。不支持遮罩与 quality 参数；多图生成会并发拆单。</>
                  ) : (activeProfile.apiMode ?? DEFAULT_SETTINGS.apiMode) === 'responses' ? (
                    <>Responses API 需要使用支持 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">image_generation</code> 工具的文本模型，例如 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">{DEFAULT_RESPONSES_MODEL}</code>。</>
                  ) : (
                    <>Images API 需要使用 GPT Image 模型，例如 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">{DEFAULT_IMAGES_MODEL}</code>。</>
                  )}
                </div>
              </label>

              <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">请求超时 (秒)</span>
                <input
                  value={timeoutInput}
                  onChange={(e) => setTimeoutInput(e.target.value)}
                  onBlur={commitTimeout}
                  type="number"
                  min={10}
                  max={600}
                  className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                />
              </label>
            </div>
          </section>

          <section className="rounded-2xl bg-gray-50/40 dark:bg-white/[0.02] p-5">
            <h4 className="mb-4 text-base font-semibold text-gray-800 dark:text-gray-200">
              提示词优化 API
            </h4>
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">API URL</span>
                <input
                  value={draft.promptOptimizer.baseUrl}
                  onChange={(e) => updatePromptOptimizer({ baseUrl: e.target.value })}
                  type="text"
                  placeholder={DEFAULT_SETTINGS.baseUrl}
                  className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                />
                <div data-selectable-text className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  独立配置，与图像生成 Provider 解耦。需是 OpenAI 兼容的 chat completions 接口。
                </div>
              </label>

              <div className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">API Key</span>
                <div className="relative">
                  <input
                    value={draft.promptOptimizer.apiKey}
                    onChange={(e) => updatePromptOptimizer({ apiKey: e.target.value })}
                    type={showOptimizerApiKey ? 'text' : 'password'}
                    placeholder="sk-..."
                    className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 pr-10 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowOptimizerApiKey((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
                    tabIndex={-1}
                  >
                    {showOptimizerApiKey ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">模型 ID</span>
                <ModelListDropdown
                  value={draft.promptOptimizer.model}
                  onChange={(model) => updatePromptOptimizer({ model })}
                  onFetch={fetchOptimizerModelList}
                  isLoading={optimizerModelListLoading}
                  isOpen={optimizerModelListOpen}
                  onOpenChange={setOptimizerModelListOpen}
                  modelList={optimizerModelList}
                  error={optimizerModelListError}
                  placeholder="gpt-4o-mini"
                />
              </label>

              <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">请求超时 (秒)</span>
                <input
                  value={optimizerTimeoutInput}
                  onChange={(e) => setOptimizerTimeoutInput(e.target.value)}
                  onBlur={() => {
                    const normalized = normalizeTimeout(optimizerTimeoutInput, draft.promptOptimizer.timeout)
                    setOptimizerTimeoutInput(String(normalized))
                    if (normalized !== draft.promptOptimizer.timeout) {
                      updatePromptOptimizer({ timeout: normalized })
                    }
                  }}
                  type="number"
                  min={1}
                  max={600}
                  className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                />
              </label>

              <div className="block">
                <div className="mb-1 flex items-center justify-between">
                  <span className="block text-xs text-gray-500 dark:text-gray-400">系统提示词</span>
                  <button
                    type="button"
                    onClick={() => updatePromptOptimizer({ systemPrompt: DEFAULT_OPTIMIZER_SYSTEM_PROMPT })}
                    className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                  >
                    重置为默认
                  </button>
                </div>
                <textarea
                  value={draft.promptOptimizer.systemPrompt}
                  onChange={(e) => updatePromptOptimizer({ systemPrompt: e.target.value })}
                  rows={6}
                  className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50 resize-y font-mono leading-relaxed"
                />
                <div data-selectable-text className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  控制改写风格。默认值会要求模型输出单段结构化英文图像提示词。
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-gray-50/40 dark:bg-white/[0.02] p-5">
            <h4 className="mb-4 text-base font-semibold text-gray-800 dark:text-gray-200">
              收藏分类
            </h4>
            <div className="space-y-3">
              {favoriteCategories.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200/70 px-3 py-3 text-xs text-gray-400 dark:border-white/[0.08] dark:text-gray-500">
                  暂无分类。可从顶部分类入口或收藏记录时新建。
                </div>
              ) : (
                <div className="space-y-2">
                  {favoriteCategories.map((category, index) => (
                    <div
                      key={category.id}
                      className="rounded-xl border border-gray-200/70 bg-white/50 p-3 dark:border-white/[0.08] dark:bg-white/[0.03]"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={category.color}
                          onChange={(e) => updateFavoriteCategory(category.id, { color: e.target.value })}
                          className="h-8 w-8 shrink-0 cursor-pointer rounded-lg border border-gray-200/70 bg-transparent p-0.5 dark:border-white/[0.08]"
                          aria-label="分类颜色"
                          title="分类颜色"
                        />
                        <input
                          value={category.name}
                          onChange={(e) => updateFavoriteCategory(category.id, { name: e.target.value })}
                          className="min-w-0 flex-1 rounded-lg border border-gray-200/70 bg-white/70 px-2.5 py-1.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:focus:border-blue-500/50"
                          aria-label="分类名称"
                        />
                        <button
                          type="button"
                          onClick={() => moveFavoriteCategory(category.id, -1)}
                          disabled={index === 0}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
                          aria-label="上移分类"
                          title="上移分类"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => moveFavoriteCategory(category.id, 1)}
                          disabled={index === favoriteCategories.length - 1}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
                          aria-label="下移分类"
                          title="下移分类"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCategory(category.id, category.name)}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                          aria-label="删除分类"
                          title="删除分类"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {FAVORITE_CATEGORY_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => updateFavoriteCategory(category.id, { color })}
                            className={`h-5 w-5 rounded-full border transition ${
                              category.color.toLowerCase() === color.toLowerCase()
                                ? 'border-gray-800 ring-2 ring-gray-300 dark:border-white dark:ring-white/20'
                                : 'border-white/80 hover:scale-110 dark:border-white/20'
                            }`}
                            style={{ backgroundColor: color }}
                            aria-label={`选择颜色 ${color}`}
                            title={color}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl bg-gray-50/40 dark:bg-white/[0.02] p-5">
            <h4 className="mb-4 text-base font-semibold text-gray-800 dark:text-gray-200">
              数据管理
            </h4>
            <div className="space-y-3">
              <div className="flex gap-2">
                <button
                  onClick={() => exportData()}
                  className="flex-1 rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] flex items-center justify-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  导出
                </button>
                <button
                  onClick={() => selectImportFile('merge')}
                  className="flex-1 rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] flex items-center justify-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  合并导入
                </button>
                <button
                  onClick={() =>
                    setConfirmDialog({
                      title: '替换导入',
                      message: '替换导入会先清空本地任务记录和图片，再导入备份。设置会按安全规则合并，已有密钥不会被空密钥覆盖。',
                      confirmText: '选择备份',
                      tone: 'warning',
                      action: () => selectImportFile('replace'),
                    })
                  }
                  className="flex-1 rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] flex items-center justify-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v6h6M20 20v-6h-6M20 9A8 8 0 006.34 4.34L4 6.68M4 15a8 8 0 0013.66 4.66L20 17.32" />
                  </svg>
                  替换导入
                </button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={handleImport}
                />
              </div>
              <button
                onClick={() =>
                  setConfirmDialog({
                    title: '清空所有数据',
                    message: '确定要清空所有任务记录、图片数据和供应商配置吗？此操作不可恢复。',
                    action: () => handleClearAllData(),
                  })
                }
                className="w-full rounded-xl border border-red-200/80 bg-red-50/50 px-4 py-2.5 text-sm text-red-500 transition hover:bg-red-100/80 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
              >
                清空所有数据
              </button>
            </div>
          </section>

          <div className="pt-5 border-t border-gray-100 dark:border-white/[0.08] flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-xl px-4 py-2.5 text-sm text-gray-600 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!isDirty}
              className="rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
