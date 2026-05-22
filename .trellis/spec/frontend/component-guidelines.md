# Component Guidelines

> How components are built in this project.

---

## Overview

<!--
Document your project's component conventions here.

Questions to answer:
- What component patterns do you use?
- How are props defined?
- How do you handle composition?
- What accessibility standards apply?
-->

(To be filled by the team)

---

## Component Structure

<!-- Standard structure of a component file -->

(To be filled by the team)

---

## Props Conventions

<!-- How props should be defined and typed -->

(To be filled by the team)

---

## Styling Patterns

### Pattern: Fixed-positioned bottom bar centering with sidebar offset

**Problem**: 桌面端 sidebar 占据左侧 256px / 56px 时，`fixed bottom-4 left-1/2 -translate-x-1/2` 的悬浮元素（如 InputBar）相对**视口**居中，看起来偏左，没有相对**main 内容区**居中。

**Solution**: 在桌面 ≥ md 断点加 `md:left-[calc(50%+<sidebarWidth/2>px)]` 补偿；不同折叠态用条件类名切换。值 = sidebar 宽度 / 2（256/2=128、56/2=28）。

```tsx
<div
  className={[
    'fixed bottom-4 left-1/2 -translate-x-1/2 transition-[left]',
    sidebarCollapsed ? 'md:left-[calc(50%+28px)]' : 'md:left-[calc(50%+128px)]',
  ].join(' ')}
>
  <InputBar />
</div>
```

**Why**: 这是 viewport-centered + sidebar-aware 的最简方案，不需要把 InputBar 改成 main 的子节点（避免 z-index / overflow 困扰）。`transition-[left]` 让折叠/展开切换有过渡。移动端 `< md` 不命中条件类名，保持视口中线。

**实证**：commit PR3 `src/components/InputBar/index.tsx`。

---

### Pattern: Mutually-exclusive popovers via single `openMenu` state

**Problem**: 底栏一排 pill 每个都带 popover（模型 / 分辨率 / 高级参数），如果每个用独立的 `useState<boolean>` 控制 `open`，会出现多个 popover 同时展开、外部点击关闭逻辑互相打架。

**Solution**: 用单一联合类型状态 `openMenu: 'model' | 'resolution' | 'advanced' | null`；切换某个 pill 时 `setOpenMenu(v => v === 'model' ? null : 'model')`，自动关闭其他。

```tsx
const [openMenu, setOpenMenu] = useState<'model' | 'resolution' | 'advanced' | null>(null)

const toggle = (key: typeof openMenu) =>
  setOpenMenu((curr) => (curr === key ? null : key))

// 任意 pill 点击：toggle('model') / toggle('resolution') / toggle('advanced')
// outside-click effect 统一 setOpenMenu(null)
// Esc 监听统一 setOpenMenu(null)
```

**Why**: 单一状态保证互斥，outside click / Esc / 提交后关闭这些副作用都只需要一处。新增 popover 只需扩联合类型一个 literal，不需要重写互斥逻辑。

**实证**：commit PR3 `src/components/InputBar/index.tsx`（model / resolution / advanced 三 popover 互斥）。

---

### Pattern: iOS-style toggle 几何对称公式

**Problem**: 自写 toggle（不引入 Radix / headless-ui）时，开启态滑块位移容易写得不对称——常见是"算出滑块走到容器右边内 = 容器宽 - 滑块宽 = 36 - 16 = 20px → 写 translate-x-5（20px）"。结果开启态滑块**贴着右边缘**，关闭态又有 2px 左边距，左右气孔不一致，视觉上像松动。

**Solution**: 把"左右气孔相等"作为公式，先选定单边气孔 `pad`，反推 translate：

```
轨道 (track):    h-5 w-9   →  20 × 36 px
滑块 (thumb):    h-4 w-4   →  16 × 16 px

左气孔 (off)  pad_off  = translate-x-0.5  =  2 px
右气孔 (on)   pad_on   = w-9 − w-4 − translate_on  =  36 − 16 − x  =  20 − x

要求 pad_on == pad_off == 2 px
   →  x = 18 px
   →  translate-x-[18px]
```

代码：

```tsx
const ON = draft.someFlag
<button
  role="switch"
  aria-checked={ON}
  aria-label="某项开关"  // ← 必带，见下方 Accessibility 段
  onClick={() => setDraft({ ...draft, someFlag: !ON })}
  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
    ON ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
  }`}
>
  <span
    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-200 ${
      ON ? 'translate-x-[18px]' : 'translate-x-0.5'
    }`}
  />
</button>
```

**Why**:
- `h-5 w-9` (20×36px) 是 iOS HIG 与 Material 现代 switch 的事实标准尺寸，触控目标 ≥ 36px 满足 WCAG。
- 滑块用 `h-4 w-4` (16×16px) 留出 2px 单边气孔，是当代 toggle 的常见比例（轨道:滑块 ≈ 5:4 高度）。
- `translate-x-[18px]` 用 Tailwind 任意值语法精确控制，不能用 `translate-x-5`（20px → 贴右边）或 `translate-x-4`（16px → 右边 4px 与左边 2px 不对称）。
- `shadow-md` + `transition-transform duration-200` 让滑动有"实体感"，区别于 2018 风的硬切换。

**实证**：commit `<sw-task>` 之后的 SettingsModal 视觉刷新任务，`src/components/SettingsModal.tsx` 3 处 toggle（clearInputAfterSubmit / codexCli / apiProxy）。

**未来扩展**：若同款 toggle ≥ 4 处复用，按 [code-reuse-thinking-guide](../guides/code-reuse-thinking-guide.md) 抽 `<SettingSwitch checked label onChange />` 组件，把上述公式封进去，调用方只关心 `checked` / `label`。抽组件时**不要重推数学**，直接复用本 Pattern 的常量。

---

### Pattern: Region-scoped React Error Boundary with `display: contents` wrapper

**Problem**: 单点渲染错误（React 渲染期 throw）会让整棵树 unmount，用户看到白屏，sidebar / Header / 输入栏全部一起塌掉。事件 handler 和 Promise rejection 走的是已有 `try/catch + showToast`，但**渲染期 throw 必须靠 error boundary**。React 19 boundary 只能用 class component 实现，且**包一层 div 会破坏 `[data-home-main]` / `[data-drag-select-surface]` 这些 closest selector 之外的直接子选择器与 flex 布局**。

**Solution**: 写一个 region-aware 的 `<ErrorBoundary region="main|sidebar|header|inputbar|modal">`，无错误时用 `display: contents` 包一层 div 维持 React class component 实例，**但物理 box 在 layout 中消失**，子元素仍参与父级 flex/grid 布局；触发错误时换成「区域适配」的 fallback UI（main 用完整面板、sidebar/inputbar 用紧凑卡片、header 用一行 banner、modal 用居中弹层）。

```tsx
// 关键：无错时用 display: contents 让 wrapper 不参与 layout
render() {
  if (!this.state.error) {
    return (
      <div style={{ display: 'contents' }} key={resetCounter}>
        {this.props.children}
      </div>
    )
  }
  // ... 区域适配 fallback
}
```

App.tsx 用法：

```tsx
<ErrorBoundary region="sidebar"><Sidebar ... /></ErrorBoundary>
<ErrorBoundary region="header"><Header ... /></ErrorBoundary>
<ErrorBoundary region="main"><main data-home-main data-drag-select-surface>...</main></ErrorBoundary>
<ErrorBoundary region="inputbar"><InputBar /></ErrorBoundary>
<ErrorBoundary region="modal"><DetailModal /></ErrorBoundary>
```

**Why**:

- `display: contents` 是 CSS 标准能力，让元素自己的 box 不渲染、子元素直接「继承上一级 layout」。这是 React class boundary（必须有真实 DOM 节点）+ 已有 `flex` 父容器（要求直接子是 flex 项）共存的唯一干净解。
- 区域级而非顶层：InputBar throw 时 sidebar / 已生成图片仍可见可用，比单顶层 boundary 体验高一档。
- React 19 dev 模式会在 `componentDidCatch` 之外还原向 console 打 stack，prod 模式我们只 log message 防泄漏。
- Retry 通过 `key={resetCounter++}` 强制子树重新 mount；连续 3 次 retry 失败禁用「重试」按钮，避免子树立刻再次 throw 造成的 UI 抽搐。

**Boundary 接不到的（React 硬约束）**：

- 事件 handler 内 throw
- Promise rejection / async error
- SSR throw
- Boundary 自身渲染 throw

这些路径仍然走 `try/catch + showToast`，不要试图用 boundary 替代。

**关键约束**：

- 必须 class component（React 19 hook 不支持 boundary）。
- 不要用 Fragment 包 children（class component 实例必须有真实 DOM，但 `display: contents` 让它消失在 layout 中）。
- 「清空本地数据并重载」必须走 `setConfirmDialog` 二次确认，对齐其他破坏性操作。
- 回退 UI `role="alert"` + 所有按钮 `aria-label`。
- prod 错误显示 `error.message + 6 字符 hash`（基于 `message + stack` 的简单 base36 hash），dev 显示完整 stack + componentStack。

**实证**：`src/components/ErrorBoundary.tsx` + `src/App.tsx` 8 处包裹（sidebar/header/main/inputbar + 5 个 modal）。`hashString` 与 `computeRetryState` 抽成纯函数，在 vitest node 环境直接单测，避开了项目当前没装 RTL/jsdom 的现实。

---

## Accessibility

### Required: icon-only `<button>` must have `aria-label`

任何只渲染 SVG / emoji / 单字符的 button 必须显式 `aria-label` 描述动作。屏幕阅读器读不到 SVG 内容、读不到 emoji 含义，没有 label 会念出 "button button button"。

```tsx
// ❌ 无 label，screen reader 无法理解
<button onClick={openSettings}>
  <SettingsIcon />
</button>

// ✅
<button onClick={openSettings} aria-label="打开设置">
  <SettingsIcon />
</button>
```

**适用范围**：Header 图标按钮、Sidebar 折叠按钮、新建对话、删除对话、汉堡菜单、上传、发送、所有 pill 触发按钮、popover 关闭按钮。即便有 `title` 也要加 `aria-label`（title 对屏幕阅读器不可靠）。

实证：commit `e6a2584`（PR2 UI shell）+ PR3 InputBar。

---

### Required: emoji / 装饰 SVG 要 `aria-hidden="true"`

页面装饰用的 emoji（如 EmptyState 的 🍌）与纯装饰 SVG 必须 `aria-hidden="true"`，否则屏幕阅读器会念出 emoji 名（"banana"）造成噪声。

```tsx
<div className="text-6xl" aria-hidden="true">🍌</div>
<h2>开始创作</h2>
<svg aria-hidden="true" focusable="false" ...>...</svg>
```

---

### Required: drawer / popover Esc + outside-click + cleanup

抽屉 / popover 必须：
1. 监听 `Escape` 关闭。
2. 监听 `mousedown`/`pointerdown` outside ref 关闭。
3. `useEffect` cleanup 解绑所有 listener（避免组件卸载后僵尸监听）。
4. 移动端抽屉打开时锁背景滚动：`document.body.style.overflow = 'hidden'`，关闭/卸载时恢复。

```tsx
useEffect(() => {
  if (!mobileOpen) return
  const prevOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
  document.addEventListener('keydown', onKey)
  return () => {
    document.body.style.overflow = prevOverflow
    document.removeEventListener('keydown', onKey)
  }
}, [mobileOpen, onClose])
```

实证：commit `e6a2584` `src/components/Sidebar/index.tsx`（抽屉 Esc + body lock）；PR3 `src/components/InputBar/AdvancedParamsPopover.tsx`（popover Esc + outside click）。

---

## Common Mistakes

### Common Mistake: 自写 toggle 开启态滑块位移不对称

**Symptom**: 写完 iOS-style switch，滑块开启态"贴着右边缘"或"关闭态左 2px / 开启态右 4px"，视觉上像没对齐。

**Cause**: 凭直觉用 `translate-x-4`(16px) 或 `translate-x-5`(20px)，没按"左右气孔相等"反推。
- `translate-x-5` (20px) → 滑块紧贴右边，左 2px / 右 0px
- `translate-x-4` (16px) → 左 2px / 右 4px，不对称
- 正确：`translate-x-[18px]` → 左 2px / 右 2px

**Fix**: 按 [iOS-style toggle 几何对称公式](#pattern-ios-style-toggle-几何对称公式) 的 Pattern 反推 translate 值。`h-5 w-9 + h-4 w-4` 必配 `translate-x-[18px] / translate-x-0.5`。

**Prevention**: 写 toggle 时第一步不是写代码，是先列出"轨道 W − 滑块 W − 期望右气孔 = translate"，把数学算对再下手。任何"看着差不多就行"的眼睛估算都会翻车——CSS 像素差 2px 在 retina 屏特别明显。

❌ Bad:
```tsx
className={ON ? 'translate-x-5' : 'translate-x-[2px]'}  // 右气孔 0px ≠ 左气孔 2px
```

✅ Good:
```tsx
className={ON ? 'translate-x-[18px]' : 'translate-x-0.5'}  // 左右各 2px
```

**实证**：SettingsModal 视觉刷新任务，trellis-check 子代理抓到本 bug 并自修 3 处（`SettingsModal.tsx:443 / 576 / 626`）。

---

### Common Mistake: 用 `title[0]` 取折叠态首字符导致 emoji 半字符

**Symptom**: 折叠态 sidebar / 头像渲染对话首字符，遇到 emoji 标题（如「🍌 香蕉对话」）显示 `?` 或乱码方块。

**Cause**: JS 字符串索引按 UTF-16 code unit 寻址，emoji 与部分 CJK 扩展字符是 surrogate pair，`title[0]` 拿到的是半个字符。

**Fix**: 用 `Array.from(title)[0]` 或 `[...title][0]`，按 code point 寻址。

```tsx
// ❌ Bad
const initial = title[0]  // '🍌'.length === 2，[0] = '\uD83C'

// ✅ Good
const initial = Array.from(title.trim())[0] ?? '?'
```

**Prevention**: 凡是按"首字符 / 截前 N 字"展示用户输入文本的场景（折叠 sidebar 图标、头像、tooltip 截断），都用 `Array.from(s)` 把 string 转 code-point 数组再索引/切片。

实证：commit `e6a2584` `src/components/Sidebar/ConversationItem.tsx`。

---

### Common Mistake: subscribing the entire store object instead of single fields

**Symptom**: 组件在不相关 store 字段变化时也跟着 re-render，造成卡顿或无限循环。

**Cause**: `const { activeConversationId, tasks } = useStore()` 解构整个 state，每次任意字段变都触发该组件 re-render。

**Fix**: 每个字段单独订阅，selector 返回最小标量。

```tsx
// ❌ Bad
const { activeConversationId, tasks, conversations } = useStore()

// ✅ Good
const activeConversationId = useStore((s) => s.activeConversationId)
const tasks = useStore((s) => s.tasks)
const conversations = useStore((s) => s.conversations)
```

zustand 默认对 selector 结果做 `Object.is` 比较，单字段订阅是 O(1) 引用比较；返回 object/array 时需要自定义 `equalityFn` 否则每次都不等。

实证：本任务 `TaskGrid.tsx`、`Sidebar/index.tsx`、`Header.tsx` 全部走单字段订阅。

---

### Common Mistake: 把 Toast / ConfirmDialog 等 recovery surface 包进 ErrorBoundary

**Symptom**: 引入 ErrorBoundary 之后，某次 ConfirmDialog 自己有 bug 渲染期 throw —— 整页进入「fallback UI → fallback UI 点按钮要弹 ConfirmDialog → ConfirmDialog 又 throw → 又被 boundary 接 → 又 fallback」死循环，按钮无响应、控制台错误暴涨。

**Cause**: ErrorBoundary 的 fallback UI 内部依赖**全局 recovery surface**（如 `ConfirmDialog` 处理二次确认、`Toast` 通知 async 错误）。如果这些组件本身被同一个 boundary 树包住，它们 throw 时会落回 fallback —— 而 fallback 又要调它们 → 递归。

**Fix**: recovery surface 永远渲染在**所有业务 ErrorBoundary 之外**。`App.tsx` 的结构应该是：

```tsx
return (
  <>
    <ErrorBoundary region="sidebar"><Sidebar /></ErrorBoundary>
    <ErrorBoundary region="header"><Header /></ErrorBoundary>
    <ErrorBoundary region="main"><main>...</main></ErrorBoundary>
    <ErrorBoundary region="inputbar"><InputBar /></ErrorBoundary>
    {/* Modals 各自包 boundary */}
    <ErrorBoundary region="modal"><DetailModal /></ErrorBoundary>
    ...
    {/* ↓ recovery surface 在所有业务 boundary 之外，不被任何 boundary 包 */}
    <ConfirmDialog />
    <Toast />
  </>
)
```

**Prevention**:
1. **Recovery surface 清单要短而瘦** —— ConfirmDialog、Toast 这种「fallback UI 会主动调用」的组件不能多，且自身代码要尽量纯展示（少订阅 store / 少做派生），降低 throw 概率。
2. **如果你担心 recovery surface 自己崩** —— 在最外层加一个 silent 顶层 boundary 兜底，但它的 fallback UI 必须**完全 inline DOM**（直接 `<div>` + 原生 `confirm()` / `alert()`），**不依赖任何业务组件或 store**。这样即便项目最重的依赖全炸，用户仍能看到一个"页面崩溃，请刷新"的兜底页。
3. **Code review red flag**：看到 `<ErrorBoundary>...<ConfirmDialog />...</ErrorBoundary>` 或类似把 Toast 包进任何业务 boundary 的写法，直接打回。

❌ Bad（ConfirmDialog 被 boundary 包，触发死循环）:

```tsx
<ErrorBoundary region="app">
  <Sidebar />
  <main>...</main>
  <InputBar />
  <ConfirmDialog />   {/* ← 它 throw 时 fallback 又要调它 */}
  <Toast />
</ErrorBoundary>
```

✅ Good（recovery surface 留在 boundary 外）:

```tsx
<>
  <ErrorBoundary region="sidebar"><Sidebar /></ErrorBoundary>
  <ErrorBoundary region="main"><main>...</main></ErrorBoundary>
  <ErrorBoundary region="inputbar"><InputBar /></ErrorBoundary>
  <ConfirmDialog />
  <Toast />
</>
```

**实证**：ErrorBoundary 实现任务 `src/App.tsx`。trellis-check 复核明确确认这一决策正确。详见同文件 [Pattern: Region-scoped React Error Boundary with `display: contents` wrapper](#pattern-region-scoped-react-error-boundary-with-display-contents-wrapper)。
