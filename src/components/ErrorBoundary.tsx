import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useStore, clearAllData } from '../store'

/**
 * Region 决定回退 UI 形态。
 *   - main     完整面板（emoji + 标题 + 三按钮 + dev stack）
 *   - sidebar  侧栏紧凑卡片（icon + 单行 + 重试 + 详情展开）
 *   - inputbar 底栏紧凑悬浮（与 InputBar 同位置）
 *   - header   极简一行
 *   - modal    Modal 内嵌入面板（不破坏关闭逻辑）
 */
export type ErrorBoundaryRegion =
  | 'main'
  | 'sidebar'
  | 'inputbar'
  | 'header'
  | 'modal'

export interface ErrorBoundaryProps {
  children: ReactNode
  region: ErrorBoundaryRegion
  /** 外部 reset key：变化时 boundary 自动清除错误。 */
  resetKey?: unknown
}

interface ErrorBoundaryState {
  error: Error | null
  componentStack: string | null
  /** 递增；用于通过 `key` 重新挂载子树。 */
  resetCounter: number
  /** 连续 retry 失败次数（retry 后立刻再次抛错记为一次失败）。 */
  retryFailedCount: number
  /** 是否处于「刚 retry，等待确认是否成功」窗口。 */
  retryPending: boolean
  /** 详情展开（仅 sidebar / inputbar 紧凑形态用）。 */
  detailOpen: boolean
}

/** 连续 retry 失败上限，达到后禁用「重试」按钮。 */
const MAX_RETRY_FAILED = 3

/**
 * 简单 hash，用于 prod 模式给用户一个可反馈的错误 id。
 *
 * 故意不使用加密强度算法 —— 只需「同一 error message + stack」始终得到同一 6 字符 id，
 * 用户反馈时可由开发者反查 log。
 */
export function hashString(input: string): string {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h) + input.charCodeAt(i)
    h |= 0
  }
  // toString(36) 在负数前面会加 '-'，先转无符号
  const unsigned = h >>> 0
  return unsigned.toString(36).padStart(6, '0').slice(-6)
}

export interface RetryStateInput {
  retryFailedCount: number
  retryPending: boolean
}

export interface RetryStateAction {
  type: 'retry' | 'errorDuringRetry' | 'errorFresh' | 'recoverConfirmed'
}

/**
 * 纯函数 reducer：boundary 内 retry/error 状态机。
 *
 * 状态语义：
 *   - 处于 retryPending（刚点过重试）时再次接到 error  -> retryFailedCount + 1，仍 pending
 *   - 非 pending 时接到 error                          -> retryFailedCount 不变（首次错误）
 *   - 点击重试                                          -> 进入 pending（计数等下次错误才加）
 *   - 子树成功渲染（外部确认）                          -> 退出 pending，计数归零
 */
export function computeRetryState(
  prev: RetryStateInput,
  action: RetryStateAction,
): RetryStateInput {
  switch (action.type) {
    case 'retry':
      return { retryFailedCount: prev.retryFailedCount, retryPending: true }
    case 'errorDuringRetry':
      return {
        retryFailedCount: prev.retryFailedCount + 1,
        retryPending: true,
      }
    case 'errorFresh':
      return { retryFailedCount: prev.retryFailedCount, retryPending: false }
    case 'recoverConfirmed':
      return { retryFailedCount: 0, retryPending: false }
  }
}

const REGION_LABEL: Record<ErrorBoundaryRegion, string> = {
  main: '主区域',
  sidebar: '侧栏',
  inputbar: '输入栏',
  header: '顶栏',
  modal: '弹层',
}

interface FallbackActions {
  onRetry: () => void
  onReload: () => void
  onClearAndReload: () => void
  retryDisabled: boolean
  error: Error
  componentStack: string | null
  region: ErrorBoundaryRegion
  detailOpen: boolean
  toggleDetail: () => void
}

function getErrorBrief(error: Error): { message: string; hash: string } {
  const message = error.message || error.name || '未知错误'
  const hash = hashString(`${message}::${error.stack ?? ''}`)
  return { message, hash }
}

/** 按钮种类；实际渲染顺序固定为 重试 → 刷新页面 → 清空数据，与原实现一致。 */
type ActionButtonKind = 'retry' | 'reload' | 'clear'

/** 按钮组形态，对应四种 fallback；header 形态只有「重试」一个按钮。 */
type ActionVariant = 'main' | 'compact' | 'header' | 'modal'

/**
 * 各形态下按钮的 className，逐字保留自原四个 fallback ——
 * 包括 main/compact 带 transition-colors 而 modal 不带、compact/modal 的
 * 刷新/清空按钮无 font-medium 等差异，刻意不做视觉归一（本次重构要求渲染结果完全不变）。
 */
const ACTION_BUTTON_CLASS: Record<ActionVariant, Partial<Record<ActionButtonKind, string>>> = {
  main: {
    retry: 'inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-4 py-1.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/20',
    reload: 'inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08]',
    clear: 'inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-4 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20',
  },
  compact: {
    retry: 'rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/20',
    reload: 'rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08]',
    clear: 'rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs text-red-700 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20',
  },
  header: {
    retry: 'rounded-full border border-red-300 px-2.5 py-0.5 text-[11px] font-medium hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-500/50 dark:hover:bg-red-500/20',
  },
  modal: {
    retry: 'rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/20',
    reload: 'rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08]',
    clear: 'rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20',
  },
}

interface ErrorActionButtonsProps {
  variant: ActionVariant
  /** 要渲染的按钮集合（compact 形态顶行只有重试，详情区才有刷新/清空，故拆开传）。 */
  buttons: readonly ActionButtonKind[]
  onRetry: () => void
  onReload: () => void
  onClearAndReload: () => void
  retryDisabled: boolean
}

/**
 * 操作按钮组：四个 fallback 共用。
 * disabled 逻辑保持原样 —— 只有「重试」受 retryDisabled 限流，刷新/清空始终可点。
 */
function ErrorActionButtons(props: ErrorActionButtonsProps) {
  const { variant, buttons, onRetry, onReload, onClearAndReload, retryDisabled } = props
  const cls = ACTION_BUTTON_CLASS[variant]
  return (
    <>
      {buttons.includes('retry') && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retryDisabled}
          aria-label="重试"
          className={cls.retry}
        >
          重试
        </button>
      )}
      {buttons.includes('reload') && (
        <button
          type="button"
          onClick={onReload}
          aria-label="刷新页面"
          className={cls.reload}
        >
          刷新页面
        </button>
      )}
      {/* main 形态用全称文案，其余形态用短文案；aria-label 统一全称（与原实现一致） */}
      {buttons.includes('clear') && (
        <button
          type="button"
          onClick={onClearAndReload}
          aria-label="清空本地数据并重载"
          className={cls.clear}
        >
          {variant === 'main' ? '清空本地数据并重载' : '清空数据并重载'}
        </button>
      )}
    </>
  )
}

/** 错误 ID 徽标的 code 样式：modal 段落是 text-sm，需显式 text-xs 缩小；main 段落本身已是 text-xs。 */
const ERROR_ID_CODE_CLASS = {
  base: 'rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]',
  xs: 'rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-white/[0.06]',
} as const

/** 「错误 ID：xxxxxx」徽标：prod 下用户可反馈的 hash id（main / modal 共用）。 */
function ErrorIdBadge({ hash, size }: { hash: string; size: keyof typeof ERROR_ID_CODE_CLASS }) {
  return (
    <>
      错误 ID：<code className={ERROR_ID_CODE_CLASS[size]}>{hash}</code>
    </>
  )
}

/** DEV 堆栈预览的容器样式（main 宽幅大字号；compact / modal 紧凑小字号）。 */
const DEV_STACK_CLASS = {
  main: 'mt-6 max-h-64 w-full max-w-3xl overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-left font-mono text-xs leading-relaxed text-gray-700 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300',
  compact: 'max-h-40 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-2 text-left font-mono text-[11px] leading-snug text-gray-700 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300',
  modal: 'mt-4 max-h-48 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-2 text-left font-mono text-[11px] leading-snug text-gray-700 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300',
} as const

interface DevStackProps {
  variant: keyof typeof DEV_STACK_CLASS
  error: Error
  componentStack: string | null
}

/** DEV 模式下的 <pre> 堆栈预览；prod 渲染 null（与原先各 fallback 内 isDev && <pre> 等价）。 */
function DevStack({ variant, error, componentStack }: DevStackProps) {
  if (!import.meta.env.DEV) return null
  return (
    <pre className={DEV_STACK_CLASS[variant]}>
{error.stack || error.message}
{componentStack ? `\n\n--- componentStack ---${componentStack}` : ''}
    </pre>
  )
}

function FallbackMain(props: FallbackActions) {
  const { retryDisabled, error, componentStack, region } = props
  const brief = getErrorBrief(error)

  return (
    <div
      role="alert"
      className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-10 text-center"
    >
      <div className="mb-4 text-6xl" aria-hidden="true">🛠️</div>
      <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100">
        这个区域出错了
      </h2>
      <p className="mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
        {REGION_LABEL[region]} 渲染失败，可以尝试重试或刷新页面。
      </p>
      <p className="mt-2 max-w-md text-xs text-gray-400 dark:text-gray-500">
        <ErrorIdBadge hash={brief.hash} size="base" />
        <span className="ml-2">{brief.message}</span>
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <ErrorActionButtons variant="main" buttons={['retry', 'reload', 'clear']} {...props} />
      </div>
      {retryDisabled && (
        <p className="mt-3 text-xs text-red-500 dark:text-red-400">
          已连续重试 {MAX_RETRY_FAILED} 次失败，请尝试刷新页面或清空数据。
        </p>
      )}
      <DevStack variant="main" error={error} componentStack={componentStack} />
    </div>
  )
}

function FallbackCompact(props: FallbackActions) {
  const { error, componentStack, region, detailOpen, toggleDetail } = props
  const brief = getErrorBrief(error)

  const isInputBar = region === 'inputbar'
  const wrapperClass = isInputBar
    ? 'fixed bottom-4 left-1/2 z-[100] w-[min(92vw,32rem)] -translate-x-1/2 rounded-2xl border border-red-200 bg-white/95 px-4 py-3 text-sm shadow-lg backdrop-blur-xl dark:border-red-500/30 dark:bg-gray-900/95'
    : 'm-2 rounded-xl border border-red-200 bg-red-50/80 px-3 py-2 text-sm dark:border-red-500/30 dark:bg-red-500/10'

  return (
    <div role="alert" className={wrapperClass}>
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-red-500 dark:text-red-400">⚠️</span>
        <span className="flex-1 truncate text-gray-700 dark:text-gray-200">
          {REGION_LABEL[region]}出错（{brief.hash}）
        </span>
        <ErrorActionButtons variant="compact" buttons={['retry']} {...props} />
        <button
          type="button"
          onClick={toggleDetail}
          aria-label={detailOpen ? '收起详情' : '展开详情'}
          aria-expanded={detailOpen}
          className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:bg-white/[0.08]"
        >
          详情
        </button>
      </div>
      {detailOpen && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {brief.message}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <ErrorActionButtons variant="compact" buttons={['reload', 'clear']} {...props} />
          </div>
          <DevStack variant="compact" error={error} componentStack={componentStack} />
        </div>
      )}
    </div>
  )
}

function FallbackHeader(props: FallbackActions) {
  const { error, region } = props
  const brief = getErrorBrief(error)
  return (
    <div
      role="alert"
      className="flex items-center gap-2 border-b border-red-200 bg-red-50/80 px-4 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
    >
      <span aria-hidden="true">⚠️</span>
      <span className="flex-1 truncate">
        {REGION_LABEL[region]}出错（{brief.hash}）：{brief.message}
      </span>
      <ErrorActionButtons variant="header" buttons={['retry']} {...props} />
    </div>
  )
}

function FallbackModal(props: FallbackActions) {
  const { error, componentStack, region } = props
  const brief = getErrorBrief(error)

  return (
    <div
      role="alert"
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-md dark:bg-black/50" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md">
        <div className="relative w-full max-w-md rounded-2xl border border-white/50 bg-white p-5 shadow-2xl ring-1 ring-black/5 dark:border-white/[0.08] dark:bg-gray-900 dark:ring-white/10">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">
            {REGION_LABEL[region]}加载失败
          </h3>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            <ErrorIdBadge hash={brief.hash} size="xs" />
          </p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{brief.message}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ErrorActionButtons variant="modal" buttons={['retry', 'reload', 'clear']} {...props} />
          </div>
          <DevStack variant="modal" error={error} componentStack={componentStack} />
        </div>
      </div>
    </div>
  )
}

/** region → fallback 组件映射；sidebar & inputbar 走紧凑形态。 */
const FALLBACK_BY_REGION: Record<ErrorBoundaryRegion, (props: FallbackActions) => ReactNode> = {
  main: FallbackMain,
  sidebar: FallbackCompact,
  inputbar: FallbackCompact,
  header: FallbackHeader,
  modal: FallbackModal,
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
    componentStack: null,
    resetCounter: 0,
    retryFailedCount: 0,
    retryPending: false,
    detailOpen: false,
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 控制台留痕：方便 dev 排查，prod 也保留 message + componentStack
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('[ErrorBoundary]', this.props.region, error, info.componentStack)
    } else {
      // eslint-disable-next-line no-console
      console.error('[ErrorBoundary]', this.props.region, error.message)
    }

    this.setState((prev) => {
      const next = computeRetryState(
        { retryFailedCount: prev.retryFailedCount, retryPending: prev.retryPending },
        prev.retryPending ? { type: 'errorDuringRetry' } : { type: 'errorFresh' },
      )
      return {
        componentStack: info.componentStack ?? null,
        retryFailedCount: next.retryFailedCount,
        retryPending: next.retryPending,
      }
    })
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    // 外部 resetKey 变化：等同于 retry
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.handleRetry()
    }
  }

  handleRetry = (): void => {
    this.setState((prev) => {
      const next = computeRetryState(
        { retryFailedCount: prev.retryFailedCount, retryPending: prev.retryPending },
        { type: 'retry' },
      )
      return {
        error: null,
        componentStack: null,
        resetCounter: prev.resetCounter + 1,
        retryFailedCount: next.retryFailedCount,
        retryPending: next.retryPending,
        detailOpen: false,
      }
    })
  }

  handleReload = (): void => {
    location.reload()
  }

  handleClearAndReload = (): void => {
    const setConfirmDialog = useStore.getState().setConfirmDialog
    setConfirmDialog({
      title: '清空本地数据并重载',
      message: '将清除全部对话、任务、图片与设置（不包含未导出的备份）。\n确认后页面会自动刷新。',
      tone: 'danger',
      confirmText: '清空并重载',
      action: () => {
        void (async () => {
          try {
            await clearAllData()
          } finally {
            location.reload()
          }
        })()
      },
    })
  }

  toggleDetail = (): void => {
    this.setState((prev) => ({ detailOpen: !prev.detailOpen }))
  }

  render(): ReactNode {
    const { error, componentStack, resetCounter, retryFailedCount, detailOpen } = this.state
    const { region } = this.props

    if (!error) {
      // 用 display:contents 包一层 div：保持 class component 的物理节点，
      // 但不影响 grid/flex 子选择器和现有 data-* selector（如 data-home-main / data-drag-select-surface）。
      return (
        <div
          style={{ display: 'contents' }}
          key={resetCounter}
          data-error-boundary-region={region}
        >
          {this.props.children}
        </div>
      )
    }

    const actions: FallbackActions = {
      onRetry: this.handleRetry,
      onReload: this.handleReload,
      onClearAndReload: this.handleClearAndReload,
      retryDisabled: retryFailedCount >= MAX_RETRY_FAILED,
      error,
      componentStack,
      region,
      detailOpen,
      toggleDetail: this.toggleDetail,
    }

    const Fallback = FALLBACK_BY_REGION[region]
    return <Fallback {...actions} />
  }
}
