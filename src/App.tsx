import { useEffect } from 'react'
import { initStore } from './store'
import { useStore } from './store'
import { normalizeSettings, switchApiProfileProvider } from './lib/api/apiProfiles'
import { readUrlBootstrap } from './lib/urlBootstrap'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import InputBar from './components/InputBar'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import SettingsModal from './components/SettingsModal'
import PromptOptimizerModal from './components/PromptOptimizerModal'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import MaskEditorModal from './components/MaskEditorModal'
import ImageContextMenu from './components/ImageContextMenu'

export default function App() {
  const setSettings = useStore((s) => s.setSettings)

  useEffect(() => {
    const bootstrap = readUrlBootstrap(window.location.href)
    const nextSettings = { ...bootstrap.settings }

    const provider = bootstrap.provider
    if (provider) {
      const state = useStore.getState()
      const settings = normalizeSettings(state.settings)
      const current = settings.profiles.find((profile) => profile.id === settings.activeProfileId) ?? settings.profiles[0]
      if (current) {
        nextSettings.profiles = settings.profiles.map((profile) =>
          profile.id === current.id
            ? {
                ...switchApiProfileProvider(profile, provider),
                ...(nextSettings.baseUrl !== undefined ? { baseUrl: nextSettings.baseUrl } : {}),
                ...(nextSettings.apiKey !== undefined ? { apiKey: nextSettings.apiKey } : {}),
                ...(provider === 'openai' && nextSettings.apiMode !== undefined ? { apiMode: nextSettings.apiMode } : {}),
                ...(provider === 'openai' && nextSettings.codexCli !== undefined ? { codexCli: nextSettings.codexCli } : {}),
              }
            : profile,
        )
        nextSettings.activeProfileId = current.id
      }
    }

    if (Object.keys(nextSettings).length) setSettings(nextSettings)
    if (bootstrap.changed) window.history.replaceState(null, '', bootstrap.cleanUrl)

    initStore()
  }, [setSettings])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  const theme = useStore((s) => s.settings.theme ?? 'light')

  useEffect(() => {
    const applyDark = (isDark: boolean) => {
      document.documentElement.classList.toggle('dark', isDark)
      const themeMeta = document.querySelector('meta[name="theme-color"]')
      if (themeMeta) themeMeta.setAttribute('content', isDark ? '#09090b' : '#ffffff')
    }

    if (theme === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)')
      applyDark(mql.matches)
      const onChange = (e: MediaQueryListEvent) => applyDark(e.matches)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }

    applyDark(theme === 'dark')
  }, [theme])

  return (
    <>
      <Header />
      <main data-home-main data-drag-select-surface className="pb-48">
        <div className="safe-area-x max-w-7xl mx-auto">
          <SearchBar />
          <TaskGrid />
        </div>
      </main>
      <InputBar />
      <DetailModal />
      <Lightbox />
      <SettingsModal />
      <PromptOptimizerModal />
      <ConfirmDialog />
      <Toast />
      <MaskEditorModal />
      <ImageContextMenu />
    </>
  )
}
