import { useStore } from '../store'

const STARTING_POINTS = [
  {
    title: '产品摄影',
    label: '自然光与细腻质感',
    prompt: '极简香氛产品摄影，浅暖色背景，自然柔光，细腻的玻璃质感，干净留白。',
    icon: 'M9 7V3h6v4M7 7h10v14H7zM10 13h4M10 16h4',
  },
  {
    title: '建筑概念',
    label: '光影中的空间叙事',
    prompt: '一座安静的现代美术馆，温暖的混凝土与拱形走廊，午后阳光投下清晰光影，建筑摄影。',
    icon: 'M4 21V7l8-4 8 4v14M2 21h20M9 21v-8a3 3 0 0 1 6 0v8',
  },
  {
    title: '角色探索',
    label: '从想象到鲜明形象',
    prompt: '一位穿着苔绿色斗篷的森林旅人，柔和自然配色，富有细节的角色设定，完整人物，浅色背景。',
    icon: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 7l2 3 3 2-3 2-2 3-2-3-3-2 3-2z',
  },
]

export default function EmptyState({
  mode = 'conversation',
}: {
  mode?: 'conversation' | 'gallery'
}) {
  const setPrompt = useStore((state) => state.setPrompt)
  const setGalleryView = useStore((state) => state.setGalleryView)
  const createOrReuseEmptyConversation = useStore((state) => state.createOrReuseEmptyConversation)
  const isGallery = mode === 'gallery'
  const start = () => {
    setGalleryView(false)
    createOrReuseEmptyConversation()
    document.querySelector<HTMLTextAreaElement>('[data-input-bar] textarea')?.focus()
  }

  return (
    <section
      data-no-drag-select
      className="mx-auto flex min-h-[300px] max-w-3xl flex-col items-center justify-center py-8 text-center md:min-h-[360px] md:py-12"
    >
      <div
        className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-soft text-brand-ink"
        aria-hidden="true"
      >
        <svg
          className="h-9 w-9"
          viewBox="0 0 32 32"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="4" y="5" width="24" height="22" rx="5" />
          <circle cx="12" cy="12" r="2.5" />
          <path
            d="m5 23 7-7 6 6 4-4 5 5M24 3v6M21 6h6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h2 className="text-2xl font-semibold tracking-tight text-content">
        {isGallery ? '作品，从这里汇集' : '让你的想法，成为画面'}
      </h2>
      <p className="mt-3 max-w-md text-sm leading-6 text-content-muted">
        {isGallery
          ? '生成的图片会自动汇总到这里，随时浏览、收藏与继续创作。'
          : '描述想要的画面，或添加一张参考图。你的下一件作品，从一个想法开始。'}
      </p>
      {isGallery ? (
        <button
          type="button"
          className="mt-6 rounded-lg bg-brand px-5 py-3 text-sm font-semibold text-on-brand hover:bg-brand-hover"
          onClick={start}
        >
          新建创作
        </button>
      ) : (
        <div className="mt-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
          {STARTING_POINTS.map((example) => (
            <button
              type="button"
              key={example.title}
              className="group flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-left shadow-card transition-colors hover:border-brand/40 hover:bg-brand-soft/40 sm:flex-col sm:items-start"
              aria-label={`使用${example.title}示例提示词`}
              onClick={() => {
                setPrompt(example.prompt)
                document.querySelector<HTMLTextAreaElement>('[data-input-bar] textarea')?.focus()
              }}
            >
              <svg
                className="h-6 w-6 shrink-0 text-brand-ink"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d={example.icon} />
              </svg>
              <span>
                <span className="block text-sm font-medium text-content">{example.title}</span>
                <span className="mt-1 block text-xs text-content-muted">{example.label}</span>
              </span>
              <span className="ml-auto text-content-subtle sm:hidden" aria-hidden="true">
                ↗
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
