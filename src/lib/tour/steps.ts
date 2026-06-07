import type { StepFallback } from './anchor'

/**
 * 新手引导步骤脚本(纯数据 + 工厂)。
 * buildTourSteps 是步骤的单一事实源:移动端过滤(skipOnMobile)与文案状态变体
 * 都在工厂内完成,组件只消费最终数组——步数/末步判定不依赖运行期自跳。
 */

export interface TourStepApi {
  /** 展开 InputBar 移动端折叠面板(进阶 pill 步的前置副作用) */
  setMobileInputCollapsed: (v: boolean) => void
}

export interface TourStep {
  id: string
  /** CSS 选择器;null = 无锚点居中气泡 */
  anchor: string | null
  title: string
  body: string
  /** 锚点解析失败(含 rAF 轮询超时)后的降级;仅对有锚点步有意义(anchor=null 步直接居中,不走轮询) */
  fallback: StepFallback
  /** 进入该步时的前置副作用(展开折叠面板等);TourOverlay 调用后会轮询重试锚点 */
  onEnter?: (api: TourStepApi) => void
}

export interface TourContext {
  isMobile: boolean
  /** 任一 profile 已配 key(重看路径文案需状态感知:「按钮是灰色的」只对无 key 成立) */
  hasApiKey: boolean
}

interface TourStepDef extends TourStep {
  skipOnMobile?: boolean
}

export function buildTourSteps(ctx: TourContext): TourStep[] {
  const defs: TourStepDef[] = [
    {
      id: 'welcome',
      anchor: null,
      title: '欢迎使用 Image Playground',
      body: '本地优先的图片生成工作台——所有数据只存在你的浏览器。用 30 秒走一遍核心流程。',
      fallback: 'center',
    },
    {
      id: 'configure-api',
      anchor: '[data-tour-id="submit"]',
      title: '第一步:配置 API',
      body: ctx.hasApiKey
        ? 'API 已配置好,这个按钮就是发送键。想换模型或调整配置,随时从侧边栏底部的齿轮进设置。'
        : '开始前先配置 API:当前发送按钮是灰色的,点它会打开设置面板,填入你的 API Key 即可。',
      fallback: 'center',
    },
    {
      id: 'prompt',
      anchor: '[data-input-bar]',
      title: '描述你想要的图片',
      body: '在输入框写提示词。小技巧:写 {橘色|黑色|白色} 这种通配组,提交时会自动展开成多条并发生成,一次跑完对照实验。',
      fallback: 'center',
    },
    {
      id: 'submit',
      anchor: '[data-tour-id="submit"]',
      title: '发送生成',
      body: '点这个按钮,或按 Ctrl+Enter 发送。配好 Key 且写了提示词后,它会亮起蓝色渐变。',
      fallback: 'center',
    },
    {
      id: 'results',
      anchor: '[data-home-main]',
      title: '查看结果',
      body: '生成的图片会出现在这片区域——每张是一张任务卡,可以收藏、拖拽排序、点开查看详情与实际参数。',
      fallback: 'center',
    },
    {
      id: 'advanced',
      anchor: '[data-tour-id="pillrow"]',
      title: '进阶玩法',
      body: '底部这排小按钮藏着进阶能力:「参数网格」批量扫参数生成对照矩阵、「提示词片段」存取常用模板、「AI 优化」一键改写草稿。多选已完成的任务卡还能并排对比。',
      fallback: 'center',
      // 结束后不还原折叠态(取舍):新用户首跑面板本就展开,onEnter 多为 no-op;
      // 重看路径展开后用户一拖即收,还原逻辑(记忆进入前状态)复杂度不值
      onEnter: (api) => {
        if (ctx.isMobile) api.setMobileInputCollapsed(false)
      },
    },
    {
      id: 'command-palette',
      anchor: null,
      title: '命令面板',
      body: '随时按 Ctrl / ⌘ + K 打开命令面板:搜索命令、切换对话、插入片段,全键盘直达。',
      fallback: 'center', // anchor=null 步不走轮询,fallback 实际不触达;移动端由 skipOnMobile 过滤
      skipOnMobile: true,
    },
    {
      id: 'finish',
      anchor: '[data-tour-id="help"]',
      title: '就这些!',
      body: '以后想再看一遍,点右上角这个 ? 图标即可。祝你玩得开心。',
      fallback: 'center',
    },
  ]

  return defs
    .filter((d) => !(ctx.isMobile && d.skipOnMobile))
    .map(({ skipOnMobile: _skipOnMobile, ...step }) => step)
}
