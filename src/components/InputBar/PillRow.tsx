import { useRef, useState } from 'react'
import { useStore } from '../../store'
import { getActiveApiProfile } from '../../lib/api/apiProfiles'
import { STYLE_PRESETS, isStylePresetKey } from '../../lib/stylePresets'
import ModelMenu from './ModelMenu'
import ResolutionMenu from './ResolutionMenu'
import StylePickerPopover from './StylePickerPopover'
import AdvancedParamsPopover from './AdvancedParamsPopover'
import GridConfigPopover from './GridConfigPopover'
import ButtonTooltip from './ButtonTooltip'

/** 底栏 pill 通用样式 */
const PILL_BASE =
  'inline-flex items-center gap-1 rounded-full border border-gray-200/70 bg-white/60 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors shadow-sm hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:bg-white/[0.08]'
const PILL_DISABLED =
  'inline-flex items-center gap-1 rounded-full border border-gray-200/70 bg-gray-100/60 px-3 py-1.5 text-xs font-medium text-gray-400 shadow-sm cursor-not-allowed dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-gray-500'

/** 简易 chevron 图标 */
function Chevron({ disabled = false }: { disabled?: boolean }) {
  return (
    <svg
      className={`h-3 w-3 ${disabled ? 'opacity-40' : 'opacity-70'}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export interface PillRowProps {
  ratioLabel: string
  tierLabel: string
  canOptimize: boolean
  optimizeTooltipText: string
  atImageLimit: boolean
  apiMaxImages: number
  onOpenSizePicker: () => void
  onOptimize: () => void
  canCaption: boolean
  captionTooltipText: string
  onCaption: () => void
  onAttach: () => void
}

/** 顶部 pill 行（模型 / 风格 / 比例 / 分辨率 / 优化 + 上传 + 高级） */
export default function PillRow({
  ratioLabel,
  tierLabel,
  canOptimize,
  optimizeTooltipText,
  atImageLimit,
  apiMaxImages,
  onOpenSizePicker,
  onOptimize,
  canCaption,
  captionTooltipText,
  onCaption,
  onAttach,
}: PillRowProps) {
  const prompt = useStore((s) => s.prompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const params = useStore((s) => s.params)
  const settings = useStore((s) => s.settings)
  const inputImages = useStore((s) => s.inputImages)
  const maskDraft = useStore((s) => s.maskDraft)
  const clearInputImages = useStore((s) => s.clearInputImages)
  const clearMaskDraft = useStore((s) => s.clearMaskDraft)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)

  const [optimizeHover, setOptimizeHover] = useState(false)
  const [captionHover, setCaptionHover] = useState(false)
  const [attachHover, setAttachHover] = useState(false)

  /** 顶部 pill 弹出层互斥 */
  type OpenMenu = 'model' | 'style' | 'resolution' | 'advanced' | 'grid' | null
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)

  const modelPillRef = useRef<HTMLButtonElement>(null)
  const stylePillRef = useRef<HTMLButtonElement>(null)
  const resolutionPillRef = useRef<HTMLButtonElement>(null)
  const gridPillRef = useRef<HTMLButtonElement>(null)
  const advancedButtonRef = useRef<HTMLButtonElement>(null)

  const activeProfile = getActiveApiProfile(settings)
  const modelText = activeProfile.model || activeProfile.name || '未配置'

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* 模型 pill */}
      <div className="relative">
        <button
          ref={modelPillRef}
          type="button"
          onClick={() => setOpenMenu((v) => (v === 'model' ? null : 'model'))}
          className={PILL_BASE}
          aria-haspopup="dialog"
          aria-expanded={openMenu === 'model'}
          title={`当前模型：${modelText}`}
        >
          <svg className="h-3.5 w-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M3 9h18" />
            <path d="M9 21V9" />
          </svg>
          <span className="max-w-[140px] truncate">{modelText}</span>
          <Chevron />
        </button>
        {openMenu === 'model' && (
          <ModelMenu anchorRef={modelPillRef} onClose={() => setOpenMenu(null)} />
        )}
      </div>

      {/* 风格 pill */}
      <div className="relative">
        <button
          ref={stylePillRef}
          type="button"
          onClick={() => setOpenMenu((v) => (v === 'style' ? null : 'style'))}
          className={PILL_BASE}
          aria-haspopup="dialog"
          aria-expanded={openMenu === 'style'}
          title={`风格预设：${
            params.stylePreset && isStylePresetKey(params.stylePreset)
              ? STYLE_PRESETS[params.stylePreset].label
              : '无风格'
          }`}
        >
          <svg className="h-3.5 w-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19l9-7-9-7-9 7 9 7z" />
            <path d="M12 12v7" />
          </svg>
          <span>
            {params.stylePreset && isStylePresetKey(params.stylePreset)
              ? STYLE_PRESETS[params.stylePreset].label
              : '无风格'}
          </span>
          <Chevron />
        </button>
        {openMenu === 'style' && (
          <StylePickerPopover anchorRef={stylePillRef} onClose={() => setOpenMenu(null)} />
        )}
      </div>

      {/* 比例 pill */}
      <button
        type="button"
        onClick={() => {
          setOpenMenu(null)
          onOpenSizePicker()
        }}
        className={PILL_BASE}
        title={`图像比例：${ratioLabel}`}
      >
        <svg className="h-3.5 w-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="6" width="18" height="12" rx="2" />
        </svg>
        <span>{ratioLabel}</span>
        <Chevron />
      </button>

      {/* 分辨率 pill */}
      <div className="relative">
        <button
          ref={resolutionPillRef}
          type="button"
          onClick={() => setOpenMenu((v) => (v === 'resolution' ? null : 'resolution'))}
          className={PILL_BASE}
          aria-haspopup="dialog"
          aria-expanded={openMenu === 'resolution'}
          title={`输出分辨率：${tierLabel}`}
        >
          <svg className="h-3.5 w-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 4h6v6H4z" />
            <path d="M14 4h6v6h-6z" />
            <path d="M4 14h6v6H4z" />
            <path d="M14 14h6v6h-6z" />
          </svg>
          <span>{tierLabel}</span>
          <Chevron />
        </button>
        {openMenu === 'resolution' && (
          <ResolutionMenu anchorRef={resolutionPillRef} onClose={() => setOpenMenu(null)} />
        )}
      </div>

      {/* 网格 pill */}
      <div className="relative">
        <button
          ref={gridPillRef}
          type="button"
          onClick={() => setOpenMenu((v) => (v === 'grid' ? null : 'grid'))}
          className={PILL_BASE}
          aria-haspopup="dialog"
          aria-expanded={openMenu === 'grid'}
          title="参数网格（对照实验）"
        >
          <svg className="h-3.5 w-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <span>网格</span>
          <Chevron />
        </button>
        {openMenu === 'grid' && (
          <GridConfigPopover anchorRef={gridPillRef} onClose={() => setOpenMenu(null)} />
        )}
      </div>

      {/* 优化 pill */}
      <div
        className="relative"
        onMouseEnter={() => setOptimizeHover(true)}
        onMouseLeave={() => setOptimizeHover(false)}
      >
        <ButtonTooltip visible={Boolean(optimizeTooltipText) && optimizeHover} text={optimizeTooltipText} />
        <button
          type="button"
          onClick={() => canOptimize && onOptimize()}
          disabled={!canOptimize}
          className={canOptimize ? PILL_BASE : PILL_DISABLED}
          title="AI 提示词优化"
          aria-label="AI 提示词优化"
        >
          <svg className="h-3.5 w-3.5 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
          </svg>
          <span>优化</span>
        </button>
      </div>

      {/* 反推 pill */}
      <div
        className="relative"
        onMouseEnter={() => setCaptionHover(true)}
        onMouseLeave={() => setCaptionHover(false)}
      >
        <ButtonTooltip visible={Boolean(captionTooltipText) && captionHover} text={captionTooltipText} />
        <button
          type="button"
          onClick={() => canCaption && onCaption()}
          disabled={!canCaption}
          className={canCaption ? PILL_BASE : PILL_DISABLED}
          title="图生文 / 反推提示词"
          aria-label="图生文 / 反推提示词"
        >
          <svg className="h-3.5 w-3.5 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 15l5-5 4 4 3-3 6 6" />
            <circle cx="8.5" cy="8.5" r="1.5" />
          </svg>
          <span>反推</span>
        </button>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        {/* 重置全部输入 */}
        {(() => {
          const promptLen = prompt.trim().length
          const canReset = promptLen > 0 || inputImages.length > 0 || maskDraft != null
          const parts: string[] = []
          if (promptLen > 0) parts.push(`文字（${promptLen} 字符）`)
          if (inputImages.length > 0) parts.push(`${inputImages.length} 张参考图`)
          if (maskDraft) parts.push('1 个遮罩')
          const resetMessage = `将清空：${parts.join('、')}。继续？`
          return (
            <button
              type="button"
              disabled={!canReset}
              onClick={() =>
                setConfirmDialog({
                  title: '重置全部输入',
                  message: resetMessage,
                  action: () => {
                    setPrompt('')
                    clearInputImages()
                    clearMaskDraft()
                  },
                })
              }
              className={
                canReset
                  ? `${PILL_BASE} hover:bg-red-50/50 hover:text-red-500 dark:hover:bg-red-950/30 dark:hover:text-red-400`
                  : PILL_DISABLED
              }
              aria-label="重置全部输入"
              title={canReset ? '清空文字、参考图与遮罩' : '当前没有可重置的内容'}
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              </svg>
              <span>重置</span>
            </button>
          )
        })()}

        {/* 上传 */}
        <div
          className="relative"
          onMouseEnter={() => setAttachHover(true)}
          onMouseLeave={() => setAttachHover(false)}
        >
          <ButtonTooltip visible={atImageLimit && attachHover} text={`参考图数量已达上限（${apiMaxImages} 张），无法继续添加`} />
          <button
            type="button"
            onClick={() => !atImageLimit && onAttach()}
            className={atImageLimit ? PILL_DISABLED : PILL_BASE}
            title={atImageLimit ? `已达上限 ${apiMaxImages} 张` : '上传参考图'}
            aria-label="上传参考图"
          >
            <svg className="h-3.5 w-3.5 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M17 8l-5-5-5 5" />
              <path d="M12 3v12" />
            </svg>
            <span>上传</span>
          </button>
        </div>

        {/* 高级参数 */}
        <div className="relative">
          <button
            ref={advancedButtonRef}
            type="button"
            onClick={() => setOpenMenu((v) => (v === 'advanced' ? null : 'advanced'))}
            className={`inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border border-gray-200/70 bg-white/60 text-gray-500 shadow-sm transition-colors hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:bg-white/[0.08] ${
              openMenu === 'advanced' ? 'ring-1 ring-blue-300 dark:ring-blue-500/40' : ''
            }`}
            aria-haspopup="dialog"
            aria-expanded={openMenu === 'advanced'}
            aria-label="高级参数"
            title="高级参数（quality / format / 数量 等）"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="21" x2="14" y1="4" y2="4" />
              <line x1="10" x2="3" y1="4" y2="4" />
              <line x1="21" x2="12" y1="12" y2="12" />
              <line x1="8" x2="3" y1="12" y2="12" />
              <line x1="21" x2="16" y1="20" y2="20" />
              <line x1="12" x2="3" y1="20" y2="20" />
              <line x1="14" x2="14" y1="2" y2="6" />
              <line x1="8" x2="8" y1="10" y2="14" />
              <line x1="16" x2="16" y1="18" y2="22" />
            </svg>
          </button>
          {openMenu === 'advanced' && (
            <AdvancedParamsPopover
              anchorRef={advancedButtonRef}
              onClose={() => setOpenMenu(null)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
