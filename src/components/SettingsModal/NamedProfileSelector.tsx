export interface NamedProfileSelectorProps {
  profiles: { id: string; name: string }[]
  activeProfileId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
}

export function NamedProfileSelector({
  profiles,
  activeProfileId,
  open,
  onOpenChange,
  onSelect,
  onCreate,
  onDelete,
}: NamedProfileSelectorProps) {
  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0]

  return (
    <div className="relative w-44 sm:w-48">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:hover:bg-white/[0.06]"
        title={activeProfile?.name}
      >
        <span className="min-w-0 truncate">{activeProfile?.name}</span>
        <svg className={`w-3.5 h-3.5 flex-shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => onOpenChange(false)} />
          <div className="absolute right-0 top-full z-50 mt-1.5 max-h-60 w-full overflow-hidden overflow-y-auto rounded-xl border border-gray-200/60 bg-white/95 py-1 shadow-[0_8px_30px_rgb(0,0,0,0.12)] ring-1 ring-black/5 backdrop-blur-xl animate-dropdown-down dark:border-white/[0.08] dark:bg-gray-900/95 dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] dark:ring-white/10 custom-scrollbar">
            <button
              type="button"
              onClick={onCreate}
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
              {profiles.map((profile) => (
                <div
                  key={profile.id}
                  title={profile.name}
                  className={`group flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-xs transition-colors ${profile.id === activeProfileId ? 'bg-blue-50 font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-400' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.06]'}`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(profile.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 pr-2"
                  >
                    <span className="min-w-0 truncate">{profile.name}</span>
                  </button>

                  {profiles.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(profile.id)
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
  )
}
