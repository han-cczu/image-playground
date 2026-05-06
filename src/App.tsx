import { useEffect } from 'react'
import { initStore } from './store'
import { useStore } from './store'
import { normalizeBaseUrl } from './lib/api'
import { normalizeSettings, switchApiProfileProvider } from './lib/apiProfiles'
import { useDockerApiUrlMigrationNotice } from './hooks/useDockerApiUrlMigrationNotice'
import type { ApiMode, ApiProvider, AppSettings } from './types'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import InputBar from './components/InputBar'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import SettingsModal from './components/SettingsModal'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import MaskEditorModal from './components/MaskEditorModal'
import ImageContextMenu from './components/ImageContextMenu'

export default function App() {
  const setSettings = useStore((s) => s.setSettings)
  useDockerApiUrlMigrationNotice()

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const nextSettings: Partial<AppSettings> = {}

    const apiUrlParam = searchParams.get('apiUrl')
    if (apiUrlParam !== null) {
      nextSettings.baseUrl = normalizeBaseUrl(apiUrlParam.trim())
    }

    const apiKeyParam = searchParams.get('apiKey')
    if (apiKeyParam !== null) {
      nextSettings.apiKey = apiKeyParam.trim()
    }

    const codexCliParam = searchParams.get('codexCli')
    if (codexCliParam !== null) {
      nextSettings.codexCli = codexCliParam.trim().toLowerCase() === 'true'
    }

    const apiModeParam = searchParams.get('apiMode')
    if (apiModeParam === 'images' || apiModeParam === 'responses') {
      nextSettings.apiMode = apiModeParam
    }

    const providerParam = searchParams.get('provider')?.trim().toLowerCase()
    if (providerParam) {
      const provider: ApiProvider | null = providerParam === 'fal'
        ? 'fal'
        : ['openai', 'openai-compatible'].includes(providerParam)
          ? 'openai'
          : null
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
    }

    setSettings(nextSettings)

    if (searchParams.has('apiUrl') || searchParams.has('apiKey') || searchParams.has('codexCli') || searchParams.has('apiMode') || searchParams.has('provider')) {
      searchParams.delete('apiUrl')
      searchParams.delete('apiKey')
      searchParams.delete('codexCli')
      searchParams.delete('apiMode')
      searchParams.delete('provider')

      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

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
      <ConfirmDialog />
      <Toast />
      <MaskEditorModal />
      <ImageContextMenu />
    </>
  )
}
