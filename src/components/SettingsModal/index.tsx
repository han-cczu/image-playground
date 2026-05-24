import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { normalizeBaseUrl } from '../../lib/api'
import { isApiProxyAvailable, readClientDevProxyConfig } from '../../lib/api/devProxy'
import { useStore, exportData, importData, clearAllData } from '../../store'
import type { ImportMode } from '../../lib/exportImport'
import {
  createDefaultOpenAIProfile,
  DEFAULT_OPENAI_PROFILE_ID,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_IMAGES_MODEL,
  DEFAULT_RESPONSES_MODEL,
  DEFAULT_SETTINGS,
  getActiveApiProfile,
  normalizePromptOptimizer,
  normalizeSettings,
} from '../../lib/api/apiProfiles'
import type { ApiProfile, AppSettings } from '../../types'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import { FAVORITE_CATEGORY_COLORS } from '../../lib/favoriteCategories'
import { ProfileSelector } from './ProfileSelector'
import { ApiProfileSection } from './ApiProfileSection'
import { OptimizerSection } from './OptimizerSection'

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
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
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [pendingImportMode, setPendingImportMode] = useState<ImportMode>('merge')
  const [optimizerTimeoutInput, setOptimizerTimeoutInput] = useState(
    String(normalizeSettings(settings).promptOptimizer.timeout),
  )

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
              <ProfileSelector
                profiles={draft.profiles}
                activeProfileId={draft.activeProfileId}
                open={showProfileMenu}
                onOpenChange={setShowProfileMenu}
                onSelect={switchProfile}
                onCreate={createNewProfile}
                onDelete={(id) => setConfirmDialog({
                  title: '删除配置',
                  message: `确定要删除配置「${draft.profiles.find((p) => p.id === id)?.name ?? id}」吗？`,
                  action: () => deleteProfile(id),
                })}
              />
            </div>
            <ApiProfileSection
              activeProfile={activeProfile}
              apiProxyAvailable={apiProxyAvailable}
              apiProxyEnabled={apiProxyEnabled}
              onUpdate={updateActiveProfile}
              timeoutInput={timeoutInput}
              onTimeoutChange={setTimeoutInput}
              onTimeoutBlur={commitTimeout}
            />
          </section>

          <section className="rounded-2xl bg-gray-50/40 dark:bg-white/[0.02] p-5">
            <h4 className="mb-4 text-base font-semibold text-gray-800 dark:text-gray-200">
              提示词优化 API
            </h4>
            <OptimizerSection
              optimizer={draft.promptOptimizer}
              onUpdate={updatePromptOptimizer}
              timeoutInput={optimizerTimeoutInput}
              onTimeoutChange={setOptimizerTimeoutInput}
            />
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
