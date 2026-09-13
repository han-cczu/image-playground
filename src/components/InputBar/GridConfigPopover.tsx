import PopoverSurface from './PopoverSurface'
import { useMemo, useRef, useState } from 'react'
import { useStore, submitGridTask } from '../../store'
import { usePopoverDismiss } from '../../hooks/usePopoverDismiss'
import type { GridAxis, GridAxisKey } from '../../types'
import {
  GRID_AXIS_DEFS,
  getGridAxisDef,
  countGridImages,
  type GridAxisCtx,
} from '../../lib/gridExperiment'
import { MAX_PROMPT_EXPANSION_HARD } from '../../lib/promptExpand'

interface Props {
  /** 锚点（网格 pill）引用，用于点击外部检测 */
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
}

const CHIP_BASE = 'rounded-lg px-2.5 py-1 text-xs border transition-colors'
const CHIP_ON = 'border-brand bg-brand-soft text-brand-ink   '
const CHIP_OFF = 'border-line bg-surface text-content-muted hover:bg-surface-muted    '

// 滚动浮层中的轴选项使用原生 select，避免绝对定位菜单被面板顶边裁切。
const SELECT_CLASS =
  'w-full px-3 py-2 rounded-lg border border-line  bg-surface  hover:bg-surface  text-sm transition-all duration-200 shadow-sm'

/**
 * XY 参数网格配置弹层：选 X 轴（必选，≥2 取值）+ 可选 Y 轴，各维度多选取值，
 * 点「生成网格」做笛卡尔积批量生成。结构对齐 AdvancedParamsPopover。
 */
export default function GridConfigPopover({ anchorRef, onClose }: Props) {
  const settings = useStore((s) => s.settings)
  const params = useStore((s) => s.params)
  const prompt = useStore((s) => s.prompt)
  const conversations = useStore((s) => s.conversations)
  const activeConversationId = useStore((s) => s.activeConversationId)
  const targetConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId,
  )

  const popoverRef = useRef<HTMLDivElement>(null)
  const [xKind, setXKind] = useState<GridAxisKey | ''>('')
  const [yKind, setYKind] = useState<GridAxisKey | ''>('')
  const [xKeys, setXKeys] = useState<string[]>([])
  const [yKeys, setYKeys] = useState<string[]>([])

  const ctx: GridAxisCtx = useMemo(() => ({ settings, params, prompt }), [settings, params, prompt])

  /** 当前 ctx 下可用的维度（禁用维度——如 codexCli 下的 quality、无通配时的 prompt——不出现） */
  const availableKinds = useMemo(
    () => GRID_AXIS_DEFS.filter((d) => d.getDisabledReason(ctx) === null).map((d) => d.kind),
    [ctx],
  )

  const xCandidates = useMemo(
    () => (xKind ? (getGridAxisDef(xKind)?.getCandidates(ctx) ?? []) : []),
    [xKind, ctx],
  )
  const yCandidates = useMemo(
    () => (yKind ? (getGridAxisDef(yKind)?.getCandidates(ctx) ?? []) : []),
    [yKind, ctx],
  )

  usePopoverDismiss(true, anchorRef, popoverRef, onClose)

  const toggle = (keys: string[], key: string): string[] =>
    keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]

  const handleXKind = (kind: string) => {
    setXKind(kind as GridAxisKey | '')
    setXKeys([])
    if (kind && yKind === kind) {
      setYKind('')
      setYKeys([])
    }
  }
  const handleYKind = (kind: string) => {
    setYKind(kind as GridAxisKey | '')
    setYKeys([])
  }

  const hasY = Boolean(yKind) && yKeys.length >= 2
  const cellCount = xKeys.length * (hasY ? yKeys.length : 1)
  // 总图数经 countGridImages 计算:n 作轴时各格 n 不同,不能简单乘基线 n。
  const totalImages = xKind
    ? countGridImages(
        {
          x: { kind: xKind, values: xKeys.map((k) => ({ key: k, label: k })) },
          ...(hasY && yKind
            ? { y: { kind: yKind, values: yKeys.map((k) => ({ key: k, label: k })) } }
            : {}),
        },
        params.n,
      )
    : 0
  const overHardLimit = cellCount > MAX_PROMPT_EXPANSION_HARD
  const canGenerate = Boolean(xKind) && xKeys.length >= 2 && !overHardLimit

  const xDef = GRID_AXIS_DEFS.map((d) => ({ value: d.kind, label: d.label })).filter((o) =>
    availableKinds.includes(o.value),
  )
  const yDef = [
    { value: '', label: '无（单轴）' },
    ...GRID_AXIS_DEFS.filter((d) => availableKinds.includes(d.kind) && d.kind !== xKind).map(
      (d) => ({ value: d.kind, label: d.label }),
    ),
  ]

  const handleGenerate = () => {
    if (!canGenerate || !xKind) return
    const xValues = xCandidates.filter((c) => xKeys.includes(c.key))
    const config: { x: GridAxis; y?: GridAxis } = { x: { kind: xKind, values: xValues } }
    if (hasY && yKind) {
      config.y = { kind: yKind, values: yCandidates.filter((c) => yKeys.includes(c.key)) }
    }
    void submitGridTask(config).catch(() => {
      /* submitGridTask surfaces recoverable errors via toast */
    })
    onClose()
  }

  return (
    <PopoverSurface anchorRef={anchorRef} panelRef={popoverRef} label="参数网格" width={350}>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-content ">参数网格</h4>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-content-subtle transition hover:bg-surface-muted hover:text-content-muted  "
          aria-label="关闭参数网格"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div className="space-y-3">
        <p className="text-xs text-content-muted">
          {targetConversation ? `生成到：${targetConversation.title}` : '提交后创建新对话'}
        </p>
        {/* X 轴 */}
        <div className="space-y-1.5">
          <span className="text-xs text-content-muted ">X 轴维度（必选）</span>
          <select
            aria-label="X 轴维度（必选）"
            value={xKind}
            onChange={(event) => handleXKind(event.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">选择维度…</option>
            {xDef.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {xKind && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {xCandidates.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => setXKeys((k) => toggle(k, v.key))}
                  className={`${CHIP_BASE} ${xKeys.includes(v.key) ? CHIP_ON : CHIP_OFF}`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Y 轴 */}
        <div className="space-y-1.5">
          <span className="text-xs text-content-muted ">Y 轴维度（可选）</span>
          <select
            aria-label="Y 轴维度（可选）"
            value={yKind}
            onChange={(event) => handleYKind(event.target.value)}
            className={SELECT_CLASS}
          >
            {yDef.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {yKind && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {yCandidates.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => setYKeys((k) => toggle(k, v.key))}
                  className={`${CHIP_BASE} ${yKeys.includes(v.key) ? CHIP_ON : CHIP_OFF}`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <p className="text-[11px] text-content-muted ">
          其余参数沿用当前底栏设置。未选「提示词通配」轴时，提示词中的 {'{a|b}'} 不会展开。
        </p>

        {/* 预览 + 生成 */}
        <div className="flex items-center justify-between gap-2 border-t border-line pt-3 ">
          <span className={`text-xs ${overHardLimit ? 'text-red-500' : 'text-content-muted '}`}>
            {xKeys.length >= 2
              ? overHardLimit
                ? `共 ${cellCount} 格，超过上限 ${MAX_PROMPT_EXPANSION_HARD}`
                : `${xKeys.length}×${hasY ? yKeys.length : 1} 共 ${totalImages} 张图片`
              : 'X 轴至少选 2 个取值'}
          </span>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="shrink-0 rounded-xl bg-brand px-3 py-1.5 text-xs font-medium text-on-brand transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            生成网格
          </button>
        </div>
      </div>
    </PopoverSurface>
  )
}
