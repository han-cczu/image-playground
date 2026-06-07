# 新用户操作引导(聚光灯分步导览)设计

- 日期:2026-06-07
- 状态:待评审
- 范围:新用户首次进入自动播放 8 步聚光灯导览(半透明遮罩 + 镂空高亮真实 UI + 步骤气泡);核心流程完整讲解(配 API → 提示词 → 生成 → 查看),进阶功能点到入口;Header 右上 ? 图标随时重看。
- 产品决策(用户已拍板):形式 = 聚光灯分步导览;范围 = 核心流程 + 进阶入口(6~8 步);重看 = 角落常驻 ? 图标(不做命令面板/设置页入口)。
- 设计过程:4 读者摸底 + 3 方案(minimal/visual/robust)judge panel——契合度评审 minimal 9 分胜出,正确性评审 robust 胜出;综合 = minimal 架构骨架 + robust 降级分类 + visual 的 reduced-motion 显式判定。

## 1. 背景与目标

- 项目零 onboarding 基建:新用户面对空任务流 + 灰色发送按钮,只有零散的"缺 key 跳设置"提示;批量 `{a|b|c}`、XY 网格、片段库等深功能完全靠自行发现。
- **目标**:首跑 30 秒带用户走通核心流程,顺带种草进阶入口;不打扰存量用户;可随时重看。

## 2. 现状盘点(摸底结论,均已核实行号)

- **首跑屏幕状态**:无 key → SubmitButton needsConfig 态(灰色,点击即 `onOpenSettings`,`SubmitButton.tsx:31`);tasks 空 → 主区渲染 EmptyState,TaskGrid return null(`App.tsx:177-184`)——**任务卡锚点首跑不存在**。可稳定锚定:InputBar 卡片(fixed 常驻,`index.tsx:351-352`)、Header、Sidebar、EmptyState 区。
- **data-\* 锚点先例成熟**:`data-task-id` / `data-input-bar` / `data-home-main` / `data-no-drag-select` 等已大量使用——新增 `data-tour-id` 完全符合代码风格,querySelector 统一取 rect,无需透出各组件 ref。
- **z-index 体系**:Header/InputBar z-30 → popover z-40 → Modal z-50~70 → ConfirmDialog z-110 → Toast z-120 → ErrorBoundary z-200。
- **浮层基建可复用**:`useCloseOnEscape`(全局 Esc 栈 + IME 守卫)、`useLockBodyScroll`(lockCount)、`useFocusTrap`(ConfirmDialog 同款);ViewportTooltip 的定位三段式思路可借鉴但组件本身不适配(absolute + 单轴翻转)。
- **移动端硬约束**:Sidebar 抽屉默认隐藏(`-translate-x-full`,`Sidebar/index.tsx:178`)→ 齿轮不可见;PillRow 在 `mobileCollapsed` 态高度塌缩为 0(`InputBar/index.tsx:366-374`);**`mobileCollapsed` 是 InputBar 局部 useState(`useMobileGestures.ts:8`),`mobileSidebarOpen` 是 App 局部 state(`App.tsx:37`)——顶层 TourOverlay 均够不着**(评审定级 #1 实现风险)。
- **持久化范式**:`dismissedInsecureContextBanner` 一次性布尔三处登记(ui slice + partialize `persist.ts:59-60` + merge `=== true` 归一 `persist.ts:39-40`)是成熟先例;settings 走 normalizeSettings 白名单,放新字段成本高且语义错位。
- **时序**:settings/profiles 同步水合,tasks 走 IDB 异步(initStore 内 setTasks 后还有 image-GC await 链);**现行 initStore 没有 StrictMode inflight 守卫**(评审 grep 证实,文档先例引用失实)。

## 3. 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 遮罩镂空 | **box-shadow 单 div**:`0 0 0 9999px rgba(0,0,0,.55)` + 蓝色光晕环(`0 0 0 2px blue/60, 0 0 28px blue/40`),borderRadius 12px,锚点 rect 外扩 8px | 单元素纯 CSS、改 inline style 即移动(`transition` 自动补间)、天然圆角、光晕契合项目审美;SVG mask 表达力过剩无先例;四矩形圆角难、动画现缝隙 |
| 交互模型 | **完全只读导览**:全屏 pointer-events:auto 捕获层吞掉一切点击(含镂空区),操作仅气泡按钮 + Esc | 评审共有盲点正面锁死:若镂空穿透,点 needsConfig 发送钮 → SettingsModal(z-70)开在 tour(z-130)之下 + focus-trap 灾难 |
| z-index | **z-[130]**(> Toast 120,< ErrorBoundary 200) | 引导只跑在主界面,不叠加任何 Modal;不遮硬错误兜底 |
| 锚点机制 | **`data-tour-id` 属性 + querySelector**,可见性以 `rect.width>0 && height>0` 实测为准 | 项目 data-* 先例;rect 实测兜住 640~768 断点带(isMobile<640 与 md=768 不一致,双轨判定) |
| 降级分类 | **per-step typed fallback**(robust 嫁接):锚点丢失→居中无镂空气泡(保留文案,本期全部步骤取 center;skip 语义保留给未来可砍步);onEnter 副作用触发异步渲染(展开折叠面板)→ **rAF 轮询 ≤600ms** 再降级 | 三种 null 来源(选择器未命中/塌缩零尺寸/异步未渲染)各有正确反应;降级居中讲解比静默跳步对用户更友好;绝不留空白遮罩卡死 |
| 步骤事实源 | **`buildTourSteps(ctx)` 纯函数**(robust 嫁接),按 `ctx.isMobile` 过滤 skipOnMobile 步、按 `ctx.hasApiKey` 选择文案变体,返回最终数组 | 步数/末步判定单一事实源、可单测;替代运行时 onEnter 自跳(打乱步数算术);**文案状态感知**解决重看路径"按钮是灰色的"失实问题(评审盲点) |
| 移动端展开 | **`mobileCollapsed` 提升为 ui slice 瞬态字段**(实现前置改造);InputBar 与 TourOverlay 双消费 | 评审一致结论:这是唯一干净解法;props 穿线跨层级太深;不做 robust 的 skipOnMobile 整步砍掉(移动端用户不该失去进阶导览) |
| 状态字段 | ui slice:`tourActive`/`tourStep` 瞬态 + `hasSeenTour` 持久(dismissed* 三处登记范式) | 不进 settings(白名单成本+语义错位);不用裸 localStorage(非响应式) |
| 老用户豁免 | `settings.profiles.some(p => p.apiKey.trim()) \|\| tasks.length > 0` → 静默 `setHasSeenTour(true)` | profiles.some 防漏判非激活 profile 的 key(顶层 apiKey 只镜像 active);tasks 判定须等 initStore 完成 |
| 触发时机 | `initStore().then(maybeStartTour)`;**模块级 once flag**(全新实现,无现成 inflight 可抄);弹窗互斥守卫(confirmDialog/showSettings/showCommandPalette 任一打开则不弹) | StrictMode 双挂载防重;接受 GC 尾巴的轻微延迟(订阅 setTasks 属过度设计,评审判定) |
| 重看入口 | **Header 右上主题按钮旁 ? 圆钮**(独立 `HelpButton.tsx` 小组件,visual 嫁接),`data-tour-id="help"` | 桌面+移动恒可见(Sidebar 底部折叠/抽屉态不可见,违背"常驻";右下 fixed 要新占层避让 InputBar);点击 = `setTourActive(true)+setTourStep(0)`,**不读不写 hasSeenTour** |
| reduced-motion | **JS `window.matchMedia('(prefers-reduced-motion: reduce)')` 显式判定**,命中则 inline transition 置 none(visual 嫁接) | 镂空 transition 在 inline style,index.css 的 @media class 列表约束不到它——唯一正确手段(正确性评审证实) |

## 4. 设计明细

### 4.1 新增文件(3 个)

- **`src/lib/tour/anchor.ts`**(纯逻辑,可单测):`resolveAnchor(selector)` → rect | null(实测尺寸);`computeBubblePlacement(rect, bubbleSize, viewport)` → 四向放置 + clamp(margin 12,箭头随侧);`resolveStepFallback(step, rect)` → `{action:'spotlight'|'center'|'skip'}`。
- **`src/lib/tour/steps.ts`**(纯数据 + 工厂):`TourStep` 类型 `{ id, anchor: string|null, title, body, fallback: 'center'|'skip', skipOnMobile?, onEnter?(api) }`;`buildTourSteps(ctx: { isMobile, hasApiKey })` 返回过滤后数组。
- **`src/components/TourOverlay.tsx`**:消费 tourActive/tourStep;镂空 div + 点击捕获层 + 气泡(上一步/下一步/跳过,末步"开始使用");重算监听 window resize + scroll(capture,捕获 main 内滚)+ ResizeObserver(body),rAF 节流,cleanup 成对解绑;`useCloseOnEscape(tourActive, skip)` + `useLockBodyScroll(tourActive)` + `useFocusTrap(tourActive, bubbleRef)`,每步切换手动 `.focus()` 拉回"下一步"钮。挂 App fragment 顶层(Toast 之后)。

### 4.2 步骤脚本(桌面 8 步 / 移动 7 步)

| # | 锚点 | 内容要点 | 降级/移动端 |
|---|------|---------|------------|
| 1 | null(居中) | 欢迎:"本地优先的图片生成工作台,数据只存你的浏览器,30 秒走一遍核心流程" | — |
| 2 | `[data-tour-id="submit"]` | 配 API:文案按 `hasApiKey` 两变体(无 key:"发送按钮是灰色的,点它即可打开设置填 Key";有 key(重看):"API 已配置,设置可随时从侧边栏齿轮进入") | center;跨端常驻,不开抽屉不开 Modal |
| 3 | `[data-input-bar]`(整卡) | 提示词 + 卖点:"`{橘色|黑色|白色}` 通配自动笛卡尔展开批量生成"(不写入 textarea) | center |
| 4 | `[data-tour-id="submit"]` | 发送:"点击或 Ctrl+Enter;配好 key 且有提示词后亮起蓝色渐变"(与步 2 之间隔步 3,避免连续同锚) | center |
| 5 | `[data-home-main]` | 查看结果:"生成的图出现在这片区域,任务卡可收藏/拖拽/点开看参数"(空态区讲解,不造假卡) | center |
| 6 | `[data-tour-id="pillrow"]`(整行) | 进阶巡礼:参数网格(对照实验)/提示词片段/AI 优化,一句带过"多选已完成任务卡可并排对比"(术语严格对齐各 pill title) | onEnter `setMobileCollapsed(false)` → rAF 轮询等展开动画 → 仍零尺寸则 center |
| 7 | null(居中) | "Ctrl/⌘+K 命令面板,搜命令/切对话/插片段" | `skipOnMobile: true`(buildTourSteps 过滤) |
| 8 | `[data-tour-id="help"]` | 结束:"想再看一遍,点右上角 ? 即可";按钮文案"开始使用" | center |

### 4.3 状态与触发

- ui slice 三字段 + setter;partialize 加 `hasSeenTour`,merge 加 `=== true` 归一;**`mobileCollapsed` 从 useMobileGestures 提升为 ui slice 瞬态**(InputBar 改读 store,行为不变)。
- `maybeStartTour()`(模块级 once flag):hasSeenTour → return;老用户(profiles 有 key 或 tasks 非空)→ 静默置 hasSeenTour 后 return;弹窗互斥守卫;通过则启动。
- `finish()/skip()`:`setTourActive(false)`;**仅自动触发路径**写 `setHasSeenTour(true)`,重看路径不写。

### 4.4 边界语义(评审确认)

- **URL bootstrap 分享链**(`#apiKey` 先于 initStore 写入)→ 被判老用户跳过引导:**接受**(被引导而来的用户有人带)。
- **clearAllData 不重置 hasSeenTour**(与 dismissed* 一致);**exportImport 不携带**(设备本地 UI 状态非用户数据,换机重弹符合预期)。
- **引导期 Toast**:互斥守卫不含 toast(纯新用户首屏不会触发);Toast z-120 被遮罩盖住属可接受边角。
- **StrictMode**:once flag + 全部监听 cleanup 成对解绑;顺带记录:现行 `initStore()` 本身无双调用守卫,属既有正交问题,不在本期修。

## 5. 非目标

- 交互式引导(要求用户真实完成操作才进下一步)——只读导览,降低实现与挫败风险。
- 引导叠加在 Modal 之上(指向 SettingsModal 内部字段)——锚定入口即止。
- 假任务卡演示数据、命令面板/设置页重看入口(产品已排除)、通用 tour 框架。
- 屏幕阅读器完整支持(背景 inert/aria-hidden):气泡有 role=dialog + focus trap,但背景仍在可访问树——完整 inert 需包裹层改造,留后续(审查记录)。
- 引导结束后还原移动端折叠面板状态——新用户首跑面板本就展开,重看路径一拖即收,还原逻辑不值复杂度(审查记录)。

## 6. 测试计划

- **vitest 纯逻辑(主力,绕开 jsdom ResizeObserver 坑)**:`anchor.test.ts`(resolveAnchor 三种 null 来源/四向放置+clamp/fallback 决策);`steps` 单测(buildTourSteps 移动端过滤步数、hasApiKey 文案变体);`store.test.ts` 扩(三字段瞬态/持久边界、merge 归一、partialize 白名单);`shouldAutoStartTour(state)` 纯判定逐条断言(已看过/有 key/有任务/弹窗打开/纯新用户)。
- **Playwright e2e**(对照 reference_playwright_verify 配方):A 新用户首跑 8 步全程断言镂空覆盖各锚点 → 完成后刷新不再弹;B 老用户豁免(预置带 key profile);C 重看(? 图标重播,不改写 hasSeenTour);D Esc 跳过;E 移动端 375px(步 6 自动展开折叠面板、步 7 被过滤);F `emulateMedia` reduced-motion(transition 为 none)。

## 7. 触及文件

新增:`components/TourOverlay.tsx` · `components/HelpButton.tsx` · `lib/tour/steps.ts` · `lib/tour/anchor.ts` · `lib/tour/anchor.test.ts`
修改:`store/slices/ui.ts`(三字段 + mobileCollapsed 提升)· `store/persist.ts` · `App.tsx`(initStore().then + TourOverlay 挂载)· `components/Header.tsx`(HelpButton)· `components/InputBar/index.tsx`(mobileCollapsed 改读 store)· `components/InputBar/SubmitButton.tsx` / `PillRow.tsx`(data-tour-id)· `index.css`(气泡入场动画 + reduced-motion class 部分)· `store.test.ts`
