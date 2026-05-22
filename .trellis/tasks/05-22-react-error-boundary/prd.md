# 引入 React Error Boundary

## Goal

阻止单点渲染错误拖垮整页。今天 InputBar 一行 `TypeError` 把整个页面卷成白屏，
直接来源是 React 没有 error boundary 接住渲染期 throw，整棵树 unmount。
要给应用补上至少一层 boundary，最坏情况下也能让用户看到「区域出问题了 + 重试/重载」的友好回退，而不是白屏。

## What I already know

- **React 19** 已用（`package.json:19`）。Error boundary 必须用 class component 实现（hook 不支持），通过 `getDerivedStateFromError` + `componentDidCatch`。
- **当前应用结构**（`src/App.tsx:84-103`）：
  ```
  <Sidebar />
  <Header />
  <main>{empty ? <EmptyState /> : <TaskGrid />}</main>
  <InputBar />
  <DetailModal /> <Lightbox /> <SettingsModal /> <PromptOptimizerModal /> <ConfirmDialog /> <Toast /> <MaskEditorModal /> <ImageContextMenu />
  ```
  每个区域都可能成为独立 boundary 候选。
- **无现成 error boundary**：`grep "componentDidCatch\|getDerivedStateFromError" src/` → 0 命中。
- **无 react-error-boundary 库**：`package.json` 没有；项目策略「不引入新库除非必要」。
- **已有用户可见错误传达**：`showToast(msg, 'error')`，但是 toast 只能展示已经被 catch 的错误（如 IDB write fail），无法接渲染期 throw。
- **今日实证**：commit `15597dc` 修了一个 hydration normalize 漏洞导致 InputBar 渲染 throw。如果有 boundary，用户至少能看到 sidebar / Header，调试也方便（boundary 可以在 dev 模式打印 stack）。

## Assumptions (temporary)

- A1 用户**最关心防白屏**，次要关心错误日志上报（项目没接 Sentry 类工具，不引）。
- A2 boundary 内回退 UI 应该「明确告诉用户哪个区域出问题 + 提供一个 retry 按钮 + 提供一个 reset 全局状态/reload 按钮」。
- A3 不引入新依赖（自写 class component；行数极少，complexity 低，复用率有限就一两处）。
- A4 异步错误（Promise rejection）与事件 handler 内错误**仍走原有 try/catch + showToast 路径**，error boundary 不接（这是 React 的硬约束，无法绕）。

## Decisions

- **D1 Boundary 粒度 = B 区域级**：分别给 Sidebar / Header / main / InputBar / Modal 容器各包一个 boundary。回退 UI 必须适配不同区域形态（侧栏窄条 / 主区域大块 / 底栏悬浮条 / Modal 弹层 = 自动从 z-index 上层弹出）。
- **D2 Recovery 三按钮**：「重试」（reset boundary state 让子树重新 mount）+「刷新页面」（`location.reload()`）+「清空本地数据并重载」（调用 `clearAllData` 后 reload，**必须二次确认**避免误点，对齐现有 ConfirmDialog 模式）。
- **D3 错误信息展示 = dev 显 stack，prod 显 message + hash**：通过 `import.meta.env.DEV` 区分。dev 完整 `error.stack` + `componentStack`；prod 显 `error.message` + 6 字符哈希（基于 `error.message + error.stack` 取 hash 前 6 位）。哈希用于用户上下文反馈时定位。

## Requirements

- R1 单一 `ErrorBoundary` class component，接 `children` + `region: 'sidebar' | 'header' | 'main' | 'inputbar' | 'modal'` prop 用于自适应回退 UI 尺寸/位置。
- R2 5+ 处使用：Sidebar 内部 / Header 内部 / main 容器（包 EmptyState 与 TaskGrid 切换处）/ InputBar 内部 / 各 Modal 顶层（DetailModal / Lightbox / SettingsModal / PromptOptimizerModal / MaskEditorModal / ImageContextMenu）。
- R3 回退 UI 三个按钮：「重试」「刷新页面」「清空本地数据并重载」（最后一个走 ConfirmDialog 二次确认）。
- R4 dev 模式（`import.meta.env.DEV`）展示完整 `error.stack` 与 `componentStack`，可滚动框；prod 仅展示 `error.message` 与 6 字符 hash。
- R5 「重试」通过递增内部 `resetKey` 强制子树重新 mount；如果子树立刻再次 throw，记录 retry 次数，第 3 次 retry 失败后禁用「重试」按钮（避免死循环 UI 抽搐）。
- R6 区域适配：
  - `sidebar` / `inputbar`：紧凑回退 UI（小图标 + 单行文字 + retry 按钮，详情点击展开）
  - `main`：完整回退 UI（图标 + 标题 + 描述 + 三按钮 + dev stack）
  - `header`：极简（一行文字 + retry）
  - `modal`：modal 内部嵌入回退面板（不破坏 modal 关闭逻辑）
- R7 不引入新 npm 依赖。
- R8 boundary 自身不能引入新 bug —— class component 写法标准、有单测覆盖。
- R9 回退 UI 配色与 EmptyState / Toast / AdvancedParamsPopover 同套 token（参考 component-guidelines.md::Styling Patterns）。
- R10 a11y：回退 UI 用 `role="alert"`；所有按钮 `aria-label`；dev stack 用 `<pre>` 包裹。

## Acceptance Criteria

- [ ] AC1 故意在 TaskGrid 内 throw，sidebar / Header / InputBar 仍可见可用，仅 main 区域显示回退 UI。
- [ ] AC2 故意在 InputBar 内 throw，sidebar / Header / main 仍正常，底栏区域显示回退 UI（紧凑形态）。
- [ ] AC3 故意在 Sidebar 内 throw，Header / main / InputBar 仍正常。
- [ ] AC4 回退 UI 三按钮：「重试」「刷新页面」「清空本地数据并重载」（最后一个先弹 ConfirmDialog）。
- [ ] AC5 重试在子树已修后能恢复（mount 成功，回退 UI 消失）；连续 3 次 retry 失败后「重试」按钮 disabled。
- [ ] AC6 dev 显完整 stack（可滚动）；prod 仅 message + 6 字符 hash。
- [ ] AC7 boundary 不破坏现有 138 tests，新增至少 3 个 boundary 单测：(a) 故意 throw 触发回退 UI；(b) 重试后恢复；(c) 3 次失败后 disabled。
- [ ] AC8 a11y：回退 UI `role="alert"`，按钮 `aria-label` 齐。

## Definition of Done

- typecheck / `npm run test` / `npm run build` 全绿。
- 手动验证：把某个组件 hardcode `throw new Error('test')` 跑 dev → 看到回退 UI；revert 后 retry → 恢复。
- 不引入新依赖。
- 把 error boundary 模式写到 `.trellis/spec/frontend/component-guidelines.md` 的 Patterns 节。

## Out of Scope (explicit)

- ❌ 接入 Sentry / 任何错误日志上报服务。
- ❌ 异步 / 事件 handler 错误捕获（React 边界硬约束，不该在本任务硬塞）。
- ❌ Suspense / lazy boundary（项目当前没有 lazy split）。
- ❌ 错误「不可恢复」时的高级 UX（如倒计时自动 reload）。

## Technical Notes

### 关键文件

- `src/App.tsx` — 主要插入点。
- 新文件：`src/components/ErrorBoundary.tsx`（class component + 回退 UI）。
- 可能改：`src/components/Toast.tsx` 同源样式 token 作 reference。
- `.trellis/spec/frontend/component-guidelines.md` — 沉淀 Pattern（Boundary 用法 + 已知约束）。

### 三种候选形态

**Approach A — 单顶层 boundary（最小化）**

* How: 在 `App.tsx` 顶层把整棵树包一个 `<ErrorBoundary>`。
* Pros: 实现最简单，1 个组件文件 + 1 处包裹。
* Cons: 触发后用户看到的还是「整页变成回退 UI」，体验上类似白屏（但至少有引导和 retry），无法保留 sidebar / Header 仍可用。
* 适合 MVP / 防白屏第一道防线。

**Approach B — 区域级 boundary（最大隔离）** *(Recommended for production)*

* How: 给 `<Sidebar>` / `<Header>` / `<main>` / `<InputBar>` / 各 Modal 容器分别包一个 boundary。
* Pros: 任何区域单点崩溃不影响其他区域；用户能看到「InputBar 区域出问题，但 sidebar 和已生成图片仍可用」。
* Cons: 5+ 处包裹，回退 UI 需要适配不同尺寸（InputBar 是悬浮条 vs main 是大块）；测试与代码体积稍大。

**Approach C — 顶层 + 主区域两层**

* How: 顶层一层保命；额外给 `<main>` 单独一层（因为 TaskGrid 渲染逻辑最复杂，最可能 throw）。
* Pros: 平衡。InputBar / Sidebar 等小组件 throw 时仍走顶层；main 区出错时不影响输入。
* Cons: 比 A 多 1 处 boundary；比 B 简单。

### React 19 boundary 关键约束

- 必须 class component；hooks 不工作。
- `componentDidCatch(error, info)` 拿到 error + componentStack。
- 重置 boundary：常见做法是 boundary 自己暴露 `resetKeys`（props 变化触发 reset）或暴露一个 `reset()` 方法通过 ref 调用；自写也行。
- 不接：事件 handler 内 throw / async throw / SSR throw / boundary 自身的 throw。
- React 19 dev 模式默认会在 console 打印 stack（除非 `componentDidCatch` 不再向上抛）。

## Research References

（自写 class component 简单成熟，不需要 trellis-research。React 官方文档 + 项目 PRD 一贯禁新依赖已足够定调。）
