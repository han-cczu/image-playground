import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, submitGridTask } from '../../store'
import type { GridAxis, GridAxisKey } from '../../types'
import { GRID_AXIS_DEFS, getGridAxisDef, type GridAxisCtx } from '../../lib/gridExperiment'
import { MAX_PROMPT_EXPANSION_HARD } from '../../lib/promptExpand'
import Select from '../Select'

interface Props {
  /** 锚点（网格 pill）引用，用于点击外部检测 */
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
}

const CHIP_BASE =
  'rounded-lg px-2.5 py-1 text-xs border transition-colors'
const CHIP_ON =
  'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-200'
const CHIP_OFF =
  'border-gray-200/70 bg-white/60 text-gray-600 hover:bg-gray-100 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/[0.06]'

const SELECT_CLASS =
  'w-full px-3 py-2 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/60 dark:bg-white/[0.03] hover:bg-white dark:hover:bg-white/[0.06] text-sm transition-all duration-200 shadow-sm'

/**
 * XY 参数网格配置弹层：选 X 轴（必选，≥2 取值）+ 可选 Y 轴，各维度多选取值，
 * 点「生成网格」做笛卡尔积批量生成。结构对齐 AdvancedParamsPopover。
 */
export default function GridConfigPopover({ anchorRef, onClose }: Props) {
  const settings = useStore((s) => s.settings)
  const params = useStore((s) => s.params)
  const prompt = useStore((s) => s.prompt)

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

  /** Esc / 点击外部关闭 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (popoverRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [anchorRef, onClose])

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
  const totalImages = cellCount * params.n
  const overHardLimit = cellCount > MAX_PROMPT_EXPANSION_HARD
  const canGenerate = Boolean(xKind) && xKeys.length >= 2 && !overHardLimit

  const xDef = GRID_AXIS_DEFS.map((d) => ({ value: d.kind, label: d.label })).filter((o) => availableKinds.includes(o.value))
  const yDef = [
    { value: '', label: '无（单轴）' },
    ...GRID_AXIS_DEFS.filter((d) => availableKinds.includes(d.kind) && d.kind !== xKind).map((d) => ({ value: d.kind, label: d.label })),
  ]

  const handleGenerate = () => {
    if (!canGenerate || !xKind) return
    const xValues = xCandidates.filter((c) => xKeys.includes(c.key))
    const config: { x: GridAxis; y?: GridAxis } = { x: { kind: xKind, values: xValues } }
    if (hasY && yKind) {
      config.y = { kind: yKind, values: yCandidates.filter((c) => yKeys.includes(c.key)) }
    }
    void submitGridTask(config)
    onClose()
  }

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-modal="true"
      aria-label="参数网格"
      className="absolute bottom-full left-0 mb-2 w-[340px] max-w-[calc(100vw-2rem)] rounded-2xl border border-gray-200/70 bg-white/95 p-4 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 z-40"
    >
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100">参数网格</h4>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
          aria-label="关闭参数网格"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="space-y-3">
        {/* X 轴 */}
        <div className="space-y-1.5">
          <span className="text-xs text-gray-500 dark:text-gray-400">X 轴维度（必选）</span>
          <Select value={xKind} onChange={handleXKind} options={[{ value: '', label: '选择维度…' }, ...xDef]} className={SELECT_CLASS} />
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
          <span className="text-xs text-gray-500 dark:text-gray-400">Y 轴维度（可选）</span>
          <Select value={yKind} onChange={handleYKind} options={yDef} className={SELECT_CLASS} />
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

        <p className="text-[11px] text-gray-400 dark:text-gray-500">
          其余参数沿用当前底栏设置。未选「提示词通配」轴时，提示词中的 {'{a|b}'} 不会展开。
        </p>

        {/* 预览 + 生成 */}
        <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-3 dark:border-white/[0.08]">
          <span className={`text-xs ${overHardLimit ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`}>
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
            className="shrink-0 rounded-xl bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            生成网格
          </button>
        </div>
      </div>
    </div>
  )
}
