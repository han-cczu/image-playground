// ===== 设置 =====

export type ApiMode = 'images' | 'responses'
export type ApiProvider = 'openai' | 'gemini'

interface ApiProfileBase {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  timeout: number
}

export interface OpenAIProfile extends ApiProfileBase {
  provider: 'openai'
  apiMode: ApiMode
  codexCli: boolean
  apiProxy: boolean
}

export interface GeminiProfile extends ApiProfileBase {
  provider: 'gemini'
}

export type ApiProfile = OpenAIProfile | GeminiProfile

export function isOpenAIProfile(p: ApiProfile): p is OpenAIProfile {
  return p.provider === 'openai'
}

/** 提示词优化 API 的独立配置（OpenAI 兼容 chat completions，或 Gemini 原生 generateContent） */
export interface PromptOptimizerConfig {
  baseUrl: string
  apiKey: string
  model: string
  /** 秒 */
  timeout: number
  /** 用户可自定义的优化系统提示词 */
  systemPrompt: string
  /** API provider；缺省/旧数据视为 'openai' */
  provider?: ApiProvider
}

/** 提示词优化器的命名配置（多配置切换用） */
export interface PromptOptimizerProfile extends PromptOptimizerConfig {
  id: string
  name: string
}

/** 反推提示词 API 的独立配置（OpenAI 兼容 chat completions + vision，或 Gemini 原生 generateContent） */
export interface CaptionerConfig {
  baseUrl: string
  apiKey: string
  model: string
  /** 秒 */
  timeout: number
  /** 用户可自定义的反推系统提示词 */
  systemPrompt: string
  /** API provider；缺省/旧数据视为 'openai' */
  provider?: ApiProvider
}

/** 反推提示词的命名配置（多配置切换用） */
export interface CaptionerProfile extends CaptionerConfig {
  id: string
  name: string
}

export interface AppSettings {
  /** 旧版单配置字段：保留用于导入/查询参数兼容，实际请求以 active profile 为准 */
  baseUrl: string
  apiKey: string
  model: string
  timeout: number
  apiMode: ApiMode
  codexCli: boolean
  apiProxy: boolean
  clearInputAfterSubmit: boolean
  /** 批量调度并发上限(1~6,默认 3);全局顶层标量,只作用于 runEnqueuedTasks 批量路径 */
  batchConcurrency: number
  theme: 'light' | 'dark' | 'system'
  profiles: ApiProfile[]
  activeProfileId: string
  /** 派生镜像：当前激活的优化器配置（消费方读此字段，等于 optimizerProfiles 中 activeOptimizerProfileId 指向的项） */
  promptOptimizer: PromptOptimizerConfig
  optimizerProfiles: PromptOptimizerProfile[]
  activeOptimizerProfileId: string
  /** 派生镜像：当前激活的反推配置 */
  captioner: CaptionerConfig
  captionerProfiles: CaptionerProfile[]
  activeCaptionerProfileId: string
}

// ===== 任务参数 =====

export interface TaskParams {
  size: string
  quality: 'auto' | 'low' | 'medium' | 'high'
  output_format: 'png' | 'jpeg' | 'webp'
  output_compression: number | null
  moderation: 'auto' | 'low'
  n: number
  /** 风格预设 key（命中 STYLE_PRESETS 时在请求前作为英文前缀拼到 prompt）；undefined = 无风格 */
  stylePreset?: string
}

export const DEFAULT_PARAMS: TaskParams = {
  size: 'auto',
  quality: 'auto',
  output_format: 'png',
  output_compression: null,
  moderation: 'auto',
  n: 1,
}

// ===== 输入图片（UI 层面） =====

export interface InputImage {
  /** IndexedDB image store 的 id（SHA-256 hash） */
  id: string
  /** data URL，用于预览 */
  dataUrl: string
}

export interface MaskDraft {
  targetImageId: string
  maskDataUrl: string
  updatedAt: number
}

// ===== 任务记录 =====

export type TaskStatus = 'running' | 'done' | 'error'

// ===== XY 参数网格 =====

/** 可作为网格轴的维度 */
export type GridAxisKey = 'stylePreset' | 'quality' | 'size' | 'output_format' | 'n' | 'prompt'

export interface GridAxisValue {
  /** 稳定坐标键：size 用 tier 标识（如 '2K'）、prompt 用展开后的具体串、其余用参数值字符串 */
  key: string
  /** 展示用标签：size 显示像素串、stylePreset 显示中文名等 */
  label: string
}

export interface GridAxis {
  kind: GridAxisKey
  values: GridAxisValue[]
}

export interface FavoriteCategory {
  id: string
  name: string
  color: string
  sortOrder: number
  createdAt: number
}

/** 提示词片段：可命名保存/插入复用的文本，content 可含通配组（提交时正常展开） */
export interface PromptSnippet {
  id: string
  /** 显示名，搜索目标；trim 后非空，≤ MAX_SNIPPET_NAME_LEN */
  name: string
  /** 片段正文；非空，≤ MAX_SNIPPET_CONTENT_LEN */
  content: string
  createdAt: number
  updatedAt: number
  /** 列表序，normalize 后为连续整数 */
  sortOrder: number
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  sortOrder?: number
  /** 仅在由 favoriteCategory 迁移而来时填入，未来 sidebar 用作色条 */
  color?: string | null
}

export interface TaskRecord {
  id: string
  prompt: string
  params: TaskParams
  /** 生成时使用的 Provider 类型 */
  apiProvider?: ApiProvider
  /** 生成时使用的 Provider 名称 */
  apiProfileName?: string
  /** 生成时使用的模型 ID */
  apiModel?: string
  /** API 返回的实际生效参数，用于标记与请求值不一致的情况 */
  actualParams?: Partial<TaskParams>
  /** 输出图片对应的实际生效参数，key 为 outputImages 中的图片 id */
  actualParamsByImage?: Record<string, Partial<TaskParams>>
  /** 输出图片对应的 API 改写提示词，key 为 outputImages 中的图片 id */
  revisedPromptByImage?: Record<string, string>
  /** 并发生成时失败的子请求数量 */
  partialFailureCount?: number
  /** 并发生成时的代表性失败信息 */
  partialFailureMessage?: string
  /** 任务记录写入 IndexedDB 失败时的可见错误 */
  persistenceError?: string
  /** 输入图片的 image store id 列表 */
  inputImageIds: string[]
  maskTargetImageId?: string | null
  maskImageId?: string | null
  /** 输出图片的 image store id 列表 */
  outputImages: string[]
  status: TaskStatus
  error: string | null
  createdAt: number
  finishedAt: number | null
  /** 总耗时毫秒 */
  elapsed: number | null
  /** 是否收藏 */
  isFavorite?: boolean
  /** 收藏分类 id；仅在收藏记录上生效 */
  favoriteCategoryId?: string | null
  /** 自定义排序值（降序）。未设置时按 createdAt 排序。 */
  sortOrder?: number
  /** 归属的对话 id；运行时由 store/migration 保证非空，仅类型保留可选以兼容旧数据 */
  conversationId?: string
  /** 同一次批量提交（提示词通配 / XY 网格）展开出的多条 task 的关联 id；单条提交不设 */
  batchId?: string
  /** XY 网格的轴定义（含完整取值集，每条成员冗余写，便于删成员后重建矩阵骨架）；仅网格 task 设 */
  gridAxes?: { x: GridAxis; y?: GridAxis }
  /** 本 task 在矩阵中的坐标（存 GridAxisValue.key 稳定键）；仅网格 task 设 */
  gridCoord?: { x: string; y?: string }
}

// ===== IndexedDB 存储的图片 =====

export interface StoredImage {
  id: string
  blob?: Blob
  mime?: string
  /** 旧版图片主体字段：仅用于读取历史 IndexedDB 记录，新写入会转为 blob */
  dataUrl?: string
  /** 图片首次存储时间（ms） */
  createdAt?: number
  /** 图片来源：用户上传 / API 生成 / 遮罩 */
  source?: 'upload' | 'generated' | 'mask'
}

// ===== API 请求体 =====

export interface ImageGenerationRequest {
  model: string
  prompt: string
  size: string
  quality: string
  output_format: string
  moderation: string
  output_compression?: number
  n?: number
}

// ===== API 响应 =====

export interface ImageResponseItem {
  b64_json?: string
  url?: string
  revised_prompt?: string
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
}

export interface ImageApiResponse {
  data: ImageResponseItem[]
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
  n?: number
}

export interface ResponsesOutputItem {
  type?: string
  result?: string | {
    b64_json?: string
    image?: string
    data?: string
  }
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
  revised_prompt?: string
}

export interface ResponsesApiResponse {
  output?: ResponsesOutputItem[]
  tools?: Array<{
    type?: string
    size?: string
    quality?: string
    output_format?: string
    output_compression?: number
    moderation?: string
    n?: number
  }>
}

// ===== 导出数据 =====

/** ZIP manifest.json 格式 */
export interface ExportData {
  version: number
  exportedAt: string
  settings: AppSettings
  favoriteCategories?: FavoriteCategory[]
  conversations?: Conversation[]
  /** 提示词片段（可选：旧备份无此字段，导入回退空数组） */
  snippets?: PromptSnippet[]
  /** 批次笔记（可选；导出时已过滤为仅 tasks 中存在的 batchId） */
  batchNotes?: Record<string, { text: string; updatedAt: number }>
  tasks: TaskRecord[]
  /** imageId → 图片信息 */
  imageFiles: Record<string, {
    path: string
    createdAt?: number
    source?: 'upload' | 'generated' | 'mask'
  }>
}
