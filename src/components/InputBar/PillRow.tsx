import { useRef, useState } from 'react'
import { useStore } from '../../store'
import { useHintTooltip } from '../../hooks/useHintTooltip'
import { usePopoverDismiss } from '../../hooks/usePopoverDismiss'
import { getActiveApiProfile } from '../../lib/api/apiProfiles'
import { STYLE_PRESETS, isStylePresetKey } from '../../lib/stylePresets'
import ModelMenu from './ModelMenu'
import ResolutionMenu from './ResolutionMenu'
import StylePickerPopover from './StylePickerPopover'
import AdvancedParamsPopover from './AdvancedParamsPopover'
import GridConfigPopover from './GridConfigPopover'
import SnippetPopover from './SnippetPopover'
import ButtonTooltip from './ButtonTooltip'
import PopoverSurface from './PopoverSurface'

const CONTROL =
  'ui-button min-h-9 max-w-full gap-1.5 bg-surface-muted px-2.5 text-xs text-content-muted hover:bg-brand-soft hover:text-brand-ink'
const MORE_ITEM =
  'ui-button min-h-11 w-full justify-start px-3 text-left text-sm hover:bg-surface-muted'

function Chevron() {
  return (
    <svg
      className="h-3 w-3 shrink-0 opacity-70"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
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
  onInsertSnippet: (content: string) => void
}

type OpenMenu = 'model' | 'style' | 'size' | 'more' | 'advanced' | 'grid' | 'snippet' | null

/** 常用参数直接可见；进阶工具先关闭菜单，再由原功能面板接管 Escape 栈。 */
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
  onInsertSnippet,
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
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const modelRef = useRef<HTMLButtonElement>(null)
  const styleRef = useRef<HTMLButtonElement>(null)
  const sizeRef = useRef<HTMLButtonElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const morePanelRef = useRef<HTMLDivElement>(null)
  const attachHint = useHintTooltip<HTMLDivElement>({ enabled: atImageLimit })
  usePopoverDismiss(openMenu === 'more', moreRef, morePanelRef, () => setOpenMenu(null))

  const activeProfile = getActiveApiProfile(settings)
  const modelText = activeProfile.model || activeProfile.name || '未配置'
  const styleLabel =
    params.stylePreset && isStylePresetKey(params.stylePreset)
      ? STYLE_PRESETS[params.stylePreset].label
      : '无风格'
  const promptLength = prompt.trim().length
  const canReset = promptLength > 0 || inputImages.length > 0 || maskDraft != null

  const resetInputs = () => {
    const parts: string[] = []
    if (promptLength > 0) parts.push(`文字（${promptLength} 字符）`)
    if (inputImages.length > 0) parts.push(`${inputImages.length} 张参考图`)
    if (maskDraft) parts.push('1 个遮罩')
    setOpenMenu(null)
    setConfirmDialog({
      title: '重置全部输入',
      message: `将清空：${parts.join('、')}。继续？`,
      action: () => {
        setPrompt('')
        clearInputImages()
        clearMaskDraft()
      },
    })
  }
  const close = () => setOpenMenu(null)

  return (
    <div data-tour-id="pillrow" className="flex min-w-0 flex-wrap items-center gap-1.5">
      <div className="relative" {...attachHint.anchorProps}>
        <ButtonTooltip
          visible={atImageLimit && attachHint.visible}
          text={`参考图数量已达上限（${apiMaxImages} 张），无法继续添加`}
        />
        <button
          type="button"
          onClick={() => !atImageLimit && onAttach()}
          aria-disabled={atImageLimit}
          className={`${CONTROL} ${atImageLimit ? 'cursor-not-allowed opacity-40' : ''}`}
          aria-label="上传参考图"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="m3 16 5-5 4 4 3-3 6 6M16 6v6m-3-3h6" />
          </svg>
          <span>参考图</span>
        </button>
      </div>
      <button
        ref={modelRef}
        type="button"
        onClick={() => setOpenMenu(openMenu === 'model' ? null : 'model')}
        className={CONTROL}
        aria-label={`选择模型：${modelText}`}
        aria-haspopup="dialog"
        aria-expanded={openMenu === 'model'}
        title={`当前模型：${modelText}`}
      >
        <span className="max-w-[150px] truncate">{modelText}</span>
        <Chevron />
      </button>
      <button
        ref={sizeRef}
        type="button"
        onClick={() => setOpenMenu(openMenu === 'size' ? null : 'size')}
        className={CONTROL}
        aria-label={`尺寸：${ratioLabel}，${tierLabel}`}
        aria-haspopup="dialog"
        aria-expanded={openMenu === 'size'}
      >
        <span>
          {ratioLabel}
          {tierLabel !== ratioLabel ? ` · ${tierLabel}` : ''}
        </span>
        <Chevron />
      </button>
      <button
        ref={styleRef}
        type="button"
        onClick={() => setOpenMenu(openMenu === 'style' ? null : 'style')}
        className={CONTROL}
        aria-label={`风格：${styleLabel}`}
        aria-haspopup="dialog"
        aria-expanded={openMenu === 'style'}
      >
        <span>{styleLabel}</span>
        <Chevron />
      </button>
      <button
        ref={moreRef}
        type="button"
        onClick={() => setOpenMenu(openMenu === 'more' ? null : 'more')}
        className={CONTROL}
        aria-label="更多创作工具"
        aria-haspopup="dialog"
        aria-expanded={openMenu === 'more'}
      >
        <span>更多</span>
        <Chevron />
      </button>
      {openMenu === 'model' && <ModelMenu anchorRef={modelRef} onClose={close} />}
      {openMenu === 'style' && <StylePickerPopover anchorRef={styleRef} onClose={close} />}
      {openMenu === 'size' && (
        <ResolutionMenu
          anchorRef={sizeRef}
          onClose={close}
          ratioLabel={ratioLabel}
          onOpenSizePicker={onOpenSizePicker}
        />
      )}
      {openMenu === 'grid' && <GridConfigPopover anchorRef={moreRef} onClose={close} />}
      {openMenu === 'snippet' && (
        <SnippetPopover anchorRef={moreRef} onClose={close} onInsert={onInsertSnippet} />
      )}
      {openMenu === 'advanced' && <AdvancedParamsPopover anchorRef={moreRef} onClose={close} />}
      {openMenu === 'more' && (
        <PopoverSurface
          anchorRef={moreRef}
          panelRef={morePanelRef}
          label="更多创作工具"
          width={280}
        >
          <p className="px-3 pb-1 text-xs font-medium text-content-muted">创作工具</p>
          <button type="button" className={MORE_ITEM} onClick={() => setOpenMenu('grid')}>
            参数网格
          </button>
          <button type="button" className={MORE_ITEM} onClick={() => setOpenMenu('snippet')}>
            提示词片段
          </button>
          <button
            type="button"
            className={`${MORE_ITEM} flex-col items-start gap-1 ${canOptimize ? '' : 'text-content-subtle'}`}
            aria-label="AI 提示词优化"
            aria-disabled={!canOptimize}
            onClick={() => {
              if (canOptimize) {
                close()
                onOptimize()
              }
            }}
          >
            <span>AI 优化</span>
            {optimizeTooltipText && (
              <span className="text-xs font-normal">{optimizeTooltipText}</span>
            )}
          </button>
          <button
            type="button"
            className={`${MORE_ITEM} flex-col items-start gap-1 ${canCaption ? '' : 'text-content-subtle'}`}
            aria-label="图生文 / 反推提示词"
            aria-disabled={!canCaption}
            onClick={() => {
              if (canCaption) {
                close()
                onCaption()
              }
            }}
          >
            <span>反推提示词</span>
            {captionTooltipText && (
              <span className="text-xs font-normal">{captionTooltipText}</span>
            )}
          </button>
          <div className="mt-1 border-t border-line pt-1">
            <button type="button" className={MORE_ITEM} onClick={() => setOpenMenu('advanced')}>
              高级参数
            </button>
            <button
              type="button"
              className={`${MORE_ITEM} text-red-500 disabled:opacity-40`}
              disabled={!canReset}
              aria-label="重置全部输入"
              onClick={resetInputs}
            >
              重置全部输入
            </button>
          </div>
        </PopoverSurface>
      )}
    </div>
  )
}
