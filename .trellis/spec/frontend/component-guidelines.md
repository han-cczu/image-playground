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
