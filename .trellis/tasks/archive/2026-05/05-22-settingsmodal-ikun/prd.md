# SettingsModal 视觉美化：对齐主页 ikun 风格

## Goal

让设置弹窗的审美水准与近期 ikun-style 改造后的主页（Sidebar / EmptyState / AdvancedParamsPopover）一致，
消除"老派后台弹窗"的违和感。**纯视觉层面**，不动信息架构 / 不引入新功能 / 不改 store 字段。

直接动机：用户主观感受"设置界面和主页外观不匹配 = 美观程度不够"。
读 SettingsModal 代码定位到 5 个具体的"视觉老化信号"（见 What I already know）。

## What I already know

### SettingsModal 现状（`src/components/SettingsModal.tsx`，1151 行）

整体外壳是 ikun 风格（`rounded-3xl border-white/50 bg-white/95 backdrop-blur shadow-2xl ring-1`），
**与主页同一套设计 token**，所以"不匹配"不是色板问题，是内部细节老化：

| # | 现状 | 位置 | 像哪个时代 |
|---|---|---|---|
| 1 | Toggle 开关 `h-3.5 w-6`（约 14×24px）+ `h-2.5 w-2.5` 滑块 | L441-446 | 2018 Bootstrap toggle |
| 2 | section 标题 `text-sm font-medium`（14px）+ 小灰 icon | L427-432, L458-462 | 2017-2019 后台风 |
| 3 | modal `max-w-md` (448px) 装 1151 行表单 | L400 | 老 SaaS"设置弹窗"形态 |
| 4 | 描述文字 `text-[10px]`（10px！）| L449 | 信息太挤，retina 屏读不清 |
| 5 | 每个 section 标题前都挂小灰 icon | L428, L459 等多处 | 现代设计要么去掉、要么放右侧统一栏 |

### 新风格参考（最近 ikun-style 提交后的视觉 token）

- `src/components/InputBar/AdvancedParamsPopover.tsx:16-20` 定义了新输入域 token：
  ```js
  'w-full px-3 py-2 rounded-xl border border-gray-200/60 dark:border-white/[0.08]
   bg-white/60 dark:bg-white/[0.03] focus:outline-none text-sm
   transition-all duration-200 shadow-sm'
  ```
  → Settings 现有输入 `border-gray-200/70 bg-white/60` **几乎一致**，可以保留
- `src/components/EmptyState.tsx`：大标题 `text-xl font-semibold`、装饰 pill `rounded-full`、留白充足
- `src/components/Sidebar/`：现代 list item 节奏，section 间距明显

### 项目约定

- Tailwind config (`tailwind.config.js:9-11`)：`gray` 实际映射到 `zinc`（更冷调，更现代）
- 暗色模式用 `dark:` 前缀，需同步处理
- 现有 Toggle 是**自写的**，不是统一组件——其它地方（如 store 设置）也可能有同款（需 grep 验证：是否值得抽 `<SettingSwitch>` 共享组件）

## Assumptions (temporary, to validate)

- A1 用户**只关心审美**，不关心信息架构（不希望改 tab / sidebar / 分页等结构性改造）
- A2 弹窗形态保留（不需要改成 sidebar 嵌入页）
- A3 不打算把表单组件抽象化（YAGNI；除非 grep 发现 toggle / row 真有 ≥ 3 处重复）
- A4 1151 行 SettingsModal 中，**视觉改动主要集中在 className**，无大段重写

## Open Questions

- ~~[BLOCKING] MVP 范围~~ → **已锁定：档 1 = 仅 className 视觉刷新**

## Requirements (evolving)

待 MVP 确认后填充。已锁定方向（不论档次都会做）：

- R1 Toggle 开关升到现代 iOS 风（`h-5 w-9` 左右 + 更明显阴影 + 平滑过渡）
- R2 section 标题升到 `text-base font-semibold` 以上，**去掉小灰 icon**
- R3 modal 拓宽至少到 `max-w-2xl`（672px），section 横向更舒展
- R4 `text-[10px]` 描述统一升到 `text-xs`（12px）
- R5 section 之间加分隔线（`border-t border-gray-100/60` 或加大 `space-y-8`）
- R6 视觉风格与 `EmptyState` / `Sidebar` / `AdvancedParamsPopover` 一致

## Acceptance Criteria (evolving)

- [ ] AC1 打开设置，section 标题视觉权重明显高于现状；不再有小灰 icon
- [ ] AC2 Toggle 开关肉眼一致地"现代"（尺寸 ≥ h-5 w-9，hover/active 有明显反馈）
- [ ] AC3 描述文字至少 12px，所有 `text-[10px]` 已清理
- [ ] AC4 modal 宽度 ≥ 672px（桌面端），section 内部不再永远滚动到底（信息分组直观）
- [ ] AC5 暗色模式同样美观（不出现 fallback 灰白对比破洞）
- [ ] AC6 与现有 InputBar / Sidebar / EmptyState 同屏看不违和

## Definition of Done

- typecheck / `npm run test` / `npm run build` 全绿
- 手动验证：桌面 + 移动断点 + 明暗主题各看一遍
- 不引入新依赖（不需要额外 UI 库）
- 视觉改动**可独立 revert**（不耦合任何 store / 逻辑改动）
- 必要时把"toggle 组件统一规范"写到 `.trellis/spec/frontend/component-guidelines.md` 或新文件

## Out of Scope (explicit)

- ❌ 不改信息架构（不拆 tab / 不改 sidebar / 不分页）
- ❌ 不动 store 字段、不动 settings schema、不动 API
- ❌ 不引入 Radix / headless-ui / 任何新 UI 库
- ❌ 不做"设置项动画化"或华丽效果
- ❌ 不解决 SettingsModal 1151 行单文件大小（拆分是独立工作）
- ❌ 不实现"未保存提示" / "重置默认值" 等新交互（之前没有，本任务也不引入）

## Technical Notes

### 关键文件

- `src/components/SettingsModal.tsx` —— 主要改动对象（1151 行，主要改 className）
- `src/components/InputBar/AdvancedParamsPopover.tsx:16-20` —— 视觉 token 参考
- `src/components/EmptyState.tsx` —— 现代留白节奏参考
- `src/components/Sidebar/ConversationItem.tsx` —— list item 节奏参考
- `tailwind.config.js` —— `gray = zinc` 注意

### 潜在风险

- Toggle 升尺寸后**触控目标变化**，移动端要测一下手感
- modal 加宽到 `max-w-2xl` 后，小屏（< 720px）需要降级到 `max-w-full` 或保留 `max-w-md`，避免横向滚动
- 暗色模式细节多（hover bg、border opacity 等），改一个 token 漏一处可能就破窗

### 是否值得抽 `<SettingSwitch>` 组件（档 2 的关键判断）

实施前应 grep `role="switch"` / `inline-flex.*rounded-full.*bg-blue` 看有多少处重复。
若仅 SettingsModal 内部用 → 不抽；若 ≥ 3 处复用 → 抽组件更划算。

## Research References

（视觉改造模式成熟，本任务不需要 trellis-research 子代理调研。视觉对照直接看 PRD 中列出的代码位置即可）
