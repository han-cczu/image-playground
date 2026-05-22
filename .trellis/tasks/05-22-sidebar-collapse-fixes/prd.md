# Sidebar 折叠态两个修复：折叠按钮缺失 + 避免重复"新对话"

## Goal

Sidebar 折叠态有两个相互独立但都让用户卡住的 UX 问题：
1. 折叠后 toggle 按钮被布局挤出，**用户无法再展开回去**（必须靠键盘快捷键或刷新页面，但没有这种逃生）
2. 多次点击 + 会堆积多个空"新对话"，折叠态下首字符全是"新"完全无法区分，**用户感觉"我刚才那个对话消失了"**

两个都是 UI 层修复，单文件 `Sidebar/index.tsx` + 可能一处 store action 调整。

## What I already know

### Bug 1：折叠按钮被挤掉（`Sidebar/index.tsx:141-158`）

```tsx
<div className="flex items-center justify-between gap-2 ... px-3 py-3">
  <Logo collapsed={sidebarCollapsed} />                       {/* h-8 w-8 logo icon ≈ 32px */}
  <button className="hidden ... md:flex h-8 w-8 ...">{/* toggle */}</button>
</div>
```

数学：
- 折叠态 sidebar `md:w-14` = 56px
- 容器 `px-3` 内宽 = 56 − 24 = **32px**
- Logo icon `h-8 w-8` = 32px + Toggle button 32px = **64px**
- 容器 `flex items-center justify-between` 在 64 > 32 时，第二个 flex item（toggle）会被挤出可视区域或压扁到几乎不可见

### Bug 2：重复"新对话"（`store.ts:415-432`）

```ts
createConversation: (seedTitle) => {
  const id = genConversationId()
  const next: Conversation = {
    id,
    title: seedTitle?.trim() || '新对话',  // 永远默认"新对话"
    createdAt: now, updatedAt: now,
  }
  // 直接 prepend，不查重
  set(...)
}
```

`handleCreate` (`Sidebar/index.tsx:110-112`) 也是裸调 `createConversation()`，**没有"当前是否有空的新对话"检查**。
结果：连按 + 会堆 N 个标题相同、内容都为空的"新对话"。折叠态首字符都是"新"，完全分不清。

### 已知关联约束

- `taskRuntime.ts:377` 也调 `createConversation()`（提交 task 时若无 active 自动建）。这条路径**应该**不重用空对话（用户已经在写 prompt 提交了，新建一个是合理预期）
- `renameConversation` 已存在（双击对话项重命名），改名后就不再是"空新对话"
- `isArchiveConversation` / "历史记录" 是兜底永远存在的对话，不能误删

## Assumptions (temporary)

- A1 折叠态下 Logo 本身可作为"点击展开"入口（符合用户在没有按钮可点时的直觉点击行为）
- A2 复用空"新对话"的判定标准 = 当前 active conversation **标题仍是"新对话"默认值**（未被重命名）+ **该对话下没有 task**
- A3 不删除已存在的空"新对话"（保守，避免误删历史）；只是阻止新建一个新的

## Open Questions

- ~~Bug 1 修复方案~~ → **已锁定：A. Logo 折叠态变可点击展开按钮**
- ~~Bug 2 修复方案~~ → **已锁定：A. 复用——若已有空"新对话"，点 + 切到那条**

## Requirements

- R1. 折叠态 Logo span 变 `<button>`：onClick 调 `toggleSidebar`，hover 加视觉反馈（如 ring 或 bg 变化），`aria-label="展开 sidebar"`
- R2. 折叠态原 toggle button **隐藏**（避免和 Logo 双入口冲突），展开态恢复显示
- R3. `Sidebar/index.tsx handleCreate` 调 `createConversation` 前先扫描 `conversations`，找是否存在"`title === '新对话'` && `taskCountByConversation.get(id) === 0`"的对话；存在则 `setActiveConversation(id)` + 不创建；不存在则正常 `createConversation()`
- R4. **若有多个空"新对话"**（用户已堆积），复用时选 `createdAt` 最大的那条（最近创建的）
- R5. `taskRuntime.ts:377`（提交 task 自动创建）路径**不**走复用逻辑（提交场景用户期望新建）
- R6. 移动端 < md 抽屉模式不受影响
- R7. 改名为非"新对话"的对话即使 task count 为 0 也**不视为空对话**（尊重用户重命名意图）

## Acceptance Criteria

- [ ] AC1 折叠态 Logo 鼠标 hover 变化（ring 或 bg），点击 Logo 展开 sidebar
- [ ] AC2 折叠态原 toggle button 不再渲染（避免和 Logo 双入口冲突 + 解决挤掉 bug）
- [ ] AC3 展开态 Logo 恢复为普通 div，toggle button 正常渲染在 Logo 右侧
- [ ] AC4 点击 + 时，若已有"title === '新对话' && task count === 0"的对话，只 setActive 不新建；选最新的那条
- [ ] AC5 已重命名或已有 task 的对话不被识别为空对话，点 + 创建真新对话
- [ ] AC6 taskRuntime 提交 task 自动建对话路径不被影响（依然能创建）
- [ ] AC7 单测覆盖"复用空对话"判定：多空 / 已改名 / 有 task / archive 等
- [ ] AC8 暗色模式 + 移动端 < md 抽屉行为不受影响

## Definition of Done

- typecheck / test / build 全绿
- 单文件改动为主（Sidebar/index.tsx + 可能 store.ts 一处）
- 不引入新依赖
- 必要时更新 `.trellis/spec/frontend/component-guidelines.md`（折叠 sidebar 的布局陷阱）

## Out of Scope

- ❌ 折叠态显示 hover 完整标题 tooltip（之前 A 方向，本任务不做）
- ❌ 删除已存在的空"新对话"自动清理（仅阻止新建）
- ❌ 给"新对话"加自动 AI 命名
- ❌ Sidebar 整体视觉重新设计

## Technical Approach

### 1. Logo 变 toggle 入口（Bug 1 修复）

`Sidebar/index.tsx:14-39 Logo` 组件改造：

```tsx
function Logo({ collapsed, onToggle }: { collapsed: boolean; onToggle?: () => void }) {
  const inner = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 text-white" aria-hidden="true">
        {/* 原 SVG */}
      </span>
      {!collapsed && (
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="...">Image Playground</span>
          <span className="...">创作你的图像</span>
        </div>
      )}
    </>
  )
  if (collapsed && onToggle) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 rounded-lg hover:ring-2 hover:ring-blue-300 transition"
        title="展开 sidebar"
        aria-label="展开 sidebar"
      >
        {inner}
      </button>
    )
  }
  return <div className="flex items-center gap-2">{inner}</div>
}
```

调用处 `Sidebar/index.tsx:142` 传 `onToggle={toggleSidebar}`。同时折叠态 toggle button (`L143-157`) 改为 `!sidebarCollapsed &&` 条件渲染。

### 2. 复用空"新对话"（Bug 2 修复）

`Sidebar/index.tsx:110 handleCreate` 改造：

```tsx
const handleCreate = () => {
  // 找最新的空"新对话"（标题未改 + 无 task）
  const reusable = sortedConversations
    .filter((c) =>
      c.title === '新对话' &&
      !isArchiveConversation(c.id) &&
      (taskCountByConversation.get(c.id) ?? 0) === 0
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0]

  if (reusable) {
    setActiveConversation(reusable.id)
    return
  }
  createConversation()
}
```

不改 `store.ts createConversation` 本身（保持 `taskRuntime.ts:377` 调它仍走正常新建路径）。

### 3. 提炼可测的判定函数（如适合）

把"是否为空新对话"判定提到 `src/lib/conversations.ts`（项目已有此文件）作纯函数：

```ts
export function findReusableEmptyConversation(
  conversations: Conversation[],
  taskCountByConversation: Map<string, number>,
  defaultTitle = '新对话',
): Conversation | null
```

便于 vitest 单测覆盖（多空对话 / 已重命名 / 已有 task / archive 等场景）。

## Decision (ADR-lite)

**Context**: Sidebar 折叠态展开入口被 layout 挤掉用户回不去；连按 + 堆积同名空对话导致折叠态首字符无法区分。

**Decision**: A+A 组合方案 — Logo 折叠态变可点击 toggle 入口；handleCreate 复用最新的空"新对话"。两个修复都在 Sidebar/index.tsx 内，不动 store schema、不动 createConversation API。

**Consequences**:
- ✅ 折叠态有自然的展开入口（用户直觉点 Logo 行为被保护）
- ✅ + 按钮"幂等" + 不破坏 taskRuntime 自动建对话路径
- ✅ 判定函数可单测，回归覆盖足
- ⚠️ Logo 双重语义（品牌 / toggle）—— hover 提示 + title 必须明示
- ⚠️ 用户若手动把"新对话"标题改成英文（"New Chat" 等），复用逻辑失效——但这是用户主动改名，按"已离开默认状态"语义合理

## Research References

（两个修复都是基础 UI 工作，无需 trellis-research 调研）
