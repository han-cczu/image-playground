function providerLabel(provider: string | undefined) {
  if (provider === 'gemini') return 'Gemini'
  return 'OpenAI'
}

// 三套配置组(API / 优化器 / 图说器)共用的下拉选择器;仅 API 组传 showProviderBadge 展示服务商徽标
export interface ProfileSelectorProps {
  profiles: { id: string; name: string; provider?: string }[]
  activeProfileId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  showProviderBadge?: boolean
}

export function ProfileSelector({
  profiles,
  activeProfileId,
  open,
  onOpenChange,
  onSelect,
  onCreate,
  onDelete,
  showProviderBadge = false,
}: ProfileSelectorProps) {
  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0]

  return (
    <div className="relative w-44 max-w-[65%] sm:w-48">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full min-w-0 items-center justify-between gap-2 min-h-11 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-content outline-none transition focus-visible:border-brand hover:bg-surface-muted dark:border-line dark:bg-surface-raised dark:text-content dark:focus-visible:border-brand dark:hover:bg-surface-raised"
        title={activeProfile?.name}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate">{activeProfile?.name}</span>
          {showProviderBadge && (
            <span className="shrink-0 rounded bg-brand-soft px-1.5 py-0.5 text-xs font-medium text-brand-ink dark:bg-brand-soft dark:text-brand-ink">
              {providerLabel(activeProfile?.provider)}
            </span>
          )}
        </span>
        <svg
          className={`w-3.5 h-3.5 flex-shrink-0 text-content-subtle dark:text-content-subtle transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => onOpenChange(false)} />
          <div className="absolute right-0 top-full z-50 mt-1.5 max-h-60 w-full overflow-hidden overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-[0_8px_30px_rgb(0,0,0,0.12)] ring-1 ring-black/5 backdrop-blur-xl animate-dropdown-down dark:border-line dark:bg-surface-muted dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] dark:ring-line custom-scrollbar">
            <button
              type="button"
              onClick={onCreate}
              className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-brand-ink transition-colors hover:bg-brand-soft dark:text-brand-ink dark:hover:bg-brand-soft"
            >
              <span className="truncate">创建新配置</span>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
              </span>
            </button>
            <div>
              {profiles.map((profile) => (
                <div
                  key={profile.id}
                  title={profile.name}
                  className={`group flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-xs transition-colors ${profile.id === activeProfileId ? 'bg-brand-soft font-medium text-brand-ink dark:bg-brand-soft dark:text-brand-ink' : 'text-content hover:bg-surface-muted dark:text-content dark:hover:bg-surface-raised'}`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(profile.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 pr-2"
                  >
                    <span className="min-w-0 truncate">{profile.name}</span>
                    {showProviderBadge && (
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs shrink-0 ${profile.id === activeProfileId ? 'bg-brand-soft text-brand-ink dark:bg-brand-soft dark:text-brand-ink' : 'bg-surface-muted text-content-muted dark:bg-surface-raised dark:text-content-muted'}`}
                      >
                        {providerLabel(profile.provider)}
                      </span>
                    )}
                  </button>

                  {profiles.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(profile.id)
                      }}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-content-subtle opacity-60 transition-all hover:bg-red-50 hover:text-red-500 hover:opacity-100 dark:hover:bg-red-500/10"
                      aria-label="删除配置"
                    >
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
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
  )
}
