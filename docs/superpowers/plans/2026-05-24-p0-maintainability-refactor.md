# P0 可维护性重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在行为零变化前提下,将 `store.ts` 与 `InputBar`/`SettingsModal`/`MaskEditorModal` 三个巨型组件按域/职责拆分为可独立理解和测试的单元,并消除多域组件的无关重渲染。

**Architecture:** Zustand store 采用 **Slice 组合单实例**(代码按 settings/tasks/ui/filters 四域分文件,仍组合成一个 `useStore`,跨域 action 用 `get()` 直调,消费方 import 路径不变);三大组件按实测解剖抽取自定义 hook + 子组件,主文件退化为协调层;最后对高密度订阅组件引入 `useShallow`。

**Tech Stack:** React 19 + TypeScript 5.8(strict)+ Vite 6 + Zustand 5 + Vitest 4 + ESLint 9(flat config)。

---

## 重构操作约定(全计划通用,先读)

本计划是**等价重构**,不是新功能开发。据此:

1. **验证哲学**:主回归网 = 既有 170 个测试全程保持绿 + `npx tsc -b` 0 error + `npm run lint` 0 error + 手动冒烟。**只对新抽出的纯逻辑单元补单测**(本计划中:`useMaskHistory`、`useTimeoutInput`),不为"移动代码"机械编造失败测试。
2. **"抽取"的含义**:把源文件指定行号范围的逻辑**原样移入**新文件并暴露指定的接口签名;主文件改为调用该单元。**除签名要求外不重写内部实现逻辑**——目的是搬运,不是改写。每个任务因此只给「新接口签名 + 源行号 + 调用点改动 + 验证」,不誊写既有实现。
3. **行号会随重构漂移**:任务内的行号是**重构开始前**原始文件的锚点。执行靠前任务后,后续任务用符号/区块描述定位(已在每个任务给出区块特征)。
4. **每个任务独立提交**;commit message 用中文,type 前缀英文(项目约定)。
5. **基线锚点**:阶段 0 第一步先记录 `tsc -b` 绿 + `vitest run 170 passed`。

---

## 文件结构总览(重构后)

```
eslint.config.js                         # 新增
.prettierrc                              # 新增
src/
  hooks/
    useIsMobile.ts                       # 新增(从 InputBar 提升)
    useCloseOnEscape.ts                  # 既有,不动
  store/                                 # 由 src/store.ts 迁移而来(目录形式)
    index.ts                             # create + persist + re-export
    persist.ts                           # partialize + mergePersistedStoreState
    slices/
      settings.ts  tasks.ts  ui.ts  filters.ts
  components/
    MaskEditorModal/
      index.tsx                          # 协调层(~300 行)
      hooks/ useMaskCanvasInit.ts useMaskHistory.ts useCanvasViewport.ts
             usePointerInteraction.ts useCursorOverlay.ts
      BrushToolbar.tsx BrushSizePanel.tsx MaskInfoPopover.tsx CanvasViewport.tsx
    SettingsModal/
      index.tsx                          # 协调层(~300 行)
      ModelListDropdown.tsx
      ProfileSelector.tsx ApiProfileSection.tsx OptimizerSection.tsx
      FavoriteCategorySection.tsx DataManagementSection.tsx
      useTimeoutInput.ts
    InputBar/
      index.tsx                          # 协调层(~400 行)
      ModelMenu.tsx ResolutionMenu.tsx
      ImageThumb.tsx ImageGrid.tsx PillRow.tsx TextareaInput.tsx SubmitButton.tsx
      hooks/ useImageHintTimer.ts useAutoResizeTextarea.ts useDragDropFiles.ts
             useMobileGestures.ts useModelList.ts
      (既有 AdvancedParamsPopover/ParamRow/SelectionActionBar/StylePickerPopover 不动)
```

> 注:`MaskEditorModal.tsx` / `SettingsModal.tsx` 由单文件迁为同名目录(`MaskEditorModal/index.tsx` 等)。因 `import './MaskEditorModal'` 自动解析到 `index.tsx`,消费方 import 不变。`InputBar` 已是目录,直接加文件。

---

## 阶段 0 — ESLint + Prettier 安全网

### Task 0.1: 接入 ESLint + Prettier

**Files:**
- Create: `eslint.config.js`, `.prettierrc`
- Modify: `package.json`(devDependencies + scripts)

- [ ] **Step 1: 记录重构基线**

Run: `npx tsc -b` → 期望 0 error。
Run: `npx vitest run` → 期望 `Test Files 21 passed (21) / Tests 170 passed (170)`。
把这两个结果作为全程对照锚点。

- [ ] **Step 2: 安装开发依赖**

```bash
npm install -D eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh globals prettier eslint-config-prettier
```

- [ ] **Step 3: 创建 `eslint.config.js`(flat config)**

```js
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'public/sw.js'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2020, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  prettier,
)
```

- [ ] **Step 4: 创建 `.prettierrc`**

```json
{ "semi": false, "singleQuote": true, "printWidth": 100, "trailingComma": "all" }
```

- [ ] **Step 5: 加 package.json 脚本**

在 `scripts` 中新增:
```json
"lint": "eslint src",
"format": "prettier --write src"
```

- [ ] **Step 6: 跑 lint,记录现状**

Run: `npm run lint`
期望:可能有 error/warning。**本步只记录**,error 在 Task 0.2 处理;`react-refresh` warning 可暂留。

- [ ] **Step 7: Commit**

```bash
git add eslint.config.js .prettierrc package.json package-lock.json
git commit -m "build(lint): 接入 ESLint(react-hooks)+ Prettier 作为重构安全网"
```

### Task 0.2: 打开未用变量检查并清理死代码

**Files:**
- Modify: `tsconfig.json:15-16`,以及 lint 报出的源文件

- [ ] **Step 1: 打开两个编译选项**

将 `tsconfig.json` 中:
```json
"noUnusedLocals": false,
"noUnusedParameters": false,
```
改为:
```json
"noUnusedLocals": true,
"noUnusedParameters": true,
```

- [ ] **Step 2: 跑 tsc 找出未用项**

Run: `npx tsc -b`
对每个报错:**删除**未使用的局部变量/import;未使用的函数参数加 `_` 前缀(如 `(_e) =>`)。**不改任何逻辑。**

- [ ] **Step 3: 修 ESLint error**

Run: `npm run lint`
修复所有 **error** 级问题(不含 warning)。若 `no-explicit-any` 报 error 处过多,允许逐个用精确类型替换或就地 `// eslint-disable-next-line` 并加注释说明(后续 P1 再清)。

- [ ] **Step 4: 验证基线未回归**

Run: `npx tsc -b` → 0 error
Run: `npx vitest run` → 170 passed
Run: `npm run lint` → 0 error

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(lint): 打开 noUnused 检查并清理死代码,lint 零 error"
```

---

## 阶段 1 — store slice 化

### Task 1.1: 将 `store.ts` 迁为目录(行为零变)

**Files:**
- Create: `src/store/index.ts`(由 `src/store.ts` 整体移入)
- Delete: `src/store.ts`

- [ ] **Step 1: 移动文件**

```bash
git mv src/store.ts src/store/index.ts
```

- [ ] **Step 2: 修正 index.ts 内的相对 import 深度**

`src/store/index.ts` 比原 `src/store.ts` 深一层。把文件内所有 `'./lib/...'` 改为 `'../lib/...'`,`'./types'` 改为 `'../types'`,`'./components/...'` 改为 `'../components/...'`。逐一核对顶部 import 块。

- [ ] **Step 3: 验证消费方与测试无感**

Run: `npx tsc -b` → 0 error(消费方 `import ... from '../store'` 自动解析到 `index.ts`)
Run: `npx vitest run` → 170 passed(注意 `store.test.ts` 对 store 的 import 路径若是 `./store` 仍有效)
Run: `npm run lint` → 0 error

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(store): 将 store.ts 迁为 store/ 目录(行为不变)"
```

### Task 1.2: 抽出 `createFiltersSlice`(最低耦合,先练手)

**Files:**
- Create: `src/store/slices/filters.ts`
- Modify: `src/store/index.ts`

- [ ] **Step 1: 定义 slice 类型与工厂**

`src/store/slices/filters.ts`:
```ts
import type { StateCreator } from 'zustand'
import type { AppState } from '../index' // AppState 暂从 index 导出;Task 1.6 收口到 types

export interface FiltersSlice {
  searchQuery: string
  setSearchQuery: (q: string) => void
  filterStatus: 'all' | 'running' | 'done' | 'error'
  setFilterStatus: (s: FiltersSlice['filterStatus']) => void
  filterFavorite: boolean
  setFilterFavorite: (f: boolean) => void
  filterFavoriteCategoryId: string | null
  setFilterFavoriteCategoryId: (id: string | null) => void
  selectedTaskIds: string[]
  setSelectedTaskIds: (ids: string[] | ((prev: string[]) => string[])) => void
  toggleTaskSelection: (id: string) => void
  clearSelection: () => void
}

export const createFiltersSlice: StateCreator<AppState, [], [], FiltersSlice> = (set, get) => ({
  // 将 index.ts 中 filters 相关字段/action 的实现原样搬入(原 store.ts 行 173-186, 515-542)
  // 互斥逻辑保持:setFilterFavorite 置 true 时清 filterFavoriteCategoryId,反之亦然
})
```

- [ ] **Step 2: 从 index.ts 移除这些字段实现,改为展开 slice**

在 `index.ts` 的 `create(persist((set, get) => ({ ... })))` 中,删掉 filters 那批字段,在对象里加 `...createFiltersSlice(set, get, store)`。保持 `AppState` 接口仍包含 `FiltersSlice`(可让 `AppState extends FiltersSlice ...`,Task 1.6 统一)。

- [ ] **Step 3: 验证**

Run: `npx tsc -b` → 0 error
Run: `npx vitest run` → 170 passed
Run: `npm run lint` → 0 error

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(store): 抽出 filters slice"
```

### Task 1.3: 抽出 `createSettingsSlice`

**Files:**
- Create: `src/store/slices/settings.ts`
- Modify: `src/store/index.ts`

- [ ] **Step 1: 定义 slice**

`src/store/slices/settings.ts`,接口含:`settings: AppSettings` / `setSettings` / `dismissedCodexCliPrompts: string[]` / `dismissCodexCliPrompt`。实现从 index.ts 原样搬入(原 store.ts 行 112-115, 223-224, 262-263)。`AppSettings` 从 `'../../types'` 导入。

- [ ] **Step 2: index.ts 展开 slice**(同 Task 1.2 Step 2 模式:删字段、加 `...createSettingsSlice(set, get, store)`)。

- [ ] **Step 3: 验证**

Run: `npx tsc -b` → 0 error；`npx vitest run` → 170 passed；`npm run lint` → 0 error

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(store): 抽出 settings slice"
```

### Task 1.4: 抽出 `createUiSlice`

**Files:**
- Create: `src/store/slices/ui.ts`
- Modify: `src/store/index.ts`

- [ ] **Step 1: 定义 slice**

接口含(从原 store.ts 行 160-216, 501-570 搬入):`sidebarCollapsed`/`toggleSidebar`/`setSidebarCollapsed`、`dismissedInsecureContextBanner`/`setDismissedInsecureContextBanner`、`detailTaskId`/`setDetailTaskId`、`lightboxImageId`/`lightboxImageList`/`setLightboxImageId`、`showSettings`/`setShowSettings`、`showPromptOptimizer`/`setShowPromptOptimizer`、`toast`/`showToast`、`confirmDialog`/`setConfirmDialog`、`galleryView`(+ 其 setter)。

> `showToast` 内含 `setTimeout` 自动清除,搬运时保持闭包语义不变。

- [ ] **Step 2: index.ts 展开 slice**。

- [ ] **Step 3: 验证**:`npx tsc -b` 0 error；`npx vitest run` 170 passed；`npm run lint` 0 error

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(store): 抽出 ui slice"
```

### Task 1.5: 抽出 `createTasksSlice`(含全部跨域 action)

**Files:**
- Create: `src/store/slices/tasks.ts`
- Modify: `src/store/index.ts`

- [ ] **Step 1: 定义 slice**

接口含(从原 store.ts 行 118-157, 270-498 搬入):`tasks`/`setTasks`;`conversations`/`activeConversationId` 及 `setConversations`/`createConversation`/`renameConversation`/`deleteConversationWithTasks`/`setActiveConversation`;`favoriteCategories`/`favoriteCategoriesInitialized` 及 `setFavoriteCategories`/`createFavoriteCategory`/`ensureDefaultFavoriteCategory`/`updateFavoriteCategory`/`deleteFavoriteCategory`/`moveFavoriteCategory`;`params`/`setParams`;`prompt`/`setPrompt`;`inputImages` 及 `addInputImage`/`removeInputImage`/`clearInputImages`/`setInputImages`/`moveInputImage`;`maskDraft`/`setMaskDraft`/`clearMaskDraft`;`maskEditorImageId`/`setMaskEditorImageId`。

- [ ] **Step 2: 跨域 action 改用 `get()` 直调,逐条核对等价**

- `deleteFavoriteCategory`:清理 task.favoriteCategoryId 后,调 `get().setFilterFavoriteCategoryId(null)`(若当前筛选该分类)。原内联 `set` 改为对 filters slice action 的调用,语义等价。
- `deleteConversationWithTasks`:级联删 task + 切 `activeConversationId` + 调 `get().setConfirmDialog(...)`/`get().showToast(...)`(原 UI 反馈)。
- `removeInputImage`/`clearInputImages`/`setInputImages`:联动清空 `maskDraft`/`maskEditorImageId`(均在本 slice 内,直接在返回对象里同置)。
- `setMaskDraft`:联动 `orderImagesWithMaskFirst` 重排 `inputImages`(本 slice 内)。

> 核对方法:对照原 store.ts 每个 action 的 `set(...)` 载荷,确保拆分后写入的字段集合与值完全一致。

- [ ] **Step 3: index.ts 展开 slice**。

- [ ] **Step 4: 验证(本任务最关键)**

Run: `npx tsc -b` → 0 error
Run: `npx vitest run` → 170 passed(**`store.test.ts` 665 行是跨域 action 的回归保护,必须全绿**)
Run: `npm run lint` → 0 error

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(store): 抽出 tasks slice(含跨域 action)"
```

### Task 1.6: 收口 persist、AppState 类型与 index 组装

**Files:**
- Create: `src/store/persist.ts`
- Modify: `src/store/index.ts`,`src/store/slices/*.ts`(类型 import)

- [ ] **Step 1: 抽 persist.ts**

把 index.ts 中的 `partialize` 配置与 `mergePersistedStoreState` 函数移入 `src/store/persist.ts` 并导出。**`partialize` 持久化字段保持逐字不变**(settings、favoriteCategories、favoriteCategoriesInitialized、params、prompt、inputImages[id+空dataUrl]、dismissedCodexCliPrompts、activeConversationId、sidebarCollapsed、dismissedInsecureContextBanner、galleryView),persist `name: 'image-playground'` 不变。

- [ ] **Step 2: 统一 AppState 类型**

在 `src/store/index.ts` 定义并导出:
```ts
export type AppState = SettingsSlice & TasksSlice & UiSlice & FiltersSlice
```
把各 slice 文件里 `import type { AppState } from '../index'` 的循环引用风险消除:slice 只 import 自己的 Slice 接口与所需领域类型;`StateCreator<AppState, ...>` 中的 `AppState` 从 index 引入是单向的(slice→index 仅类型),可接受;若 tsc 报循环,改为各 slice 用 `StateCreator<SettingsSlice & TasksSlice & UiSlice & FiltersSlice, ...>` 的组合类型别名置于独立 `src/store/types.ts`。

- [ ] **Step 3: 确认 index.ts 最终形态**

```ts
export const useStore = create<AppState>()(
  persist(
    (set, get, store) => ({
      ...createSettingsSlice(set, get, store),
      ...createTasksSlice(set, get, store),
      ...createUiSlice(set, get, store),
      ...createFiltersSlice(set, get, store),
    }),
    { name: 'image-playground', partialize, merge: mergePersistedStoreState },
  ),
)
```
末尾对 `taskRuntime`/`exportImport`/`imageCache` 的 re-export **逐条保留不变**。

- [ ] **Step 4: 验证 + persist 兼容性冒烟**

Run: `npx tsc -b` → 0 error；`npx vitest run` → 170 passed；`npm run lint` → 0 error
手动:`npm run dev`,在浏览器中确认——刷新页面后既有设置/对话/历史正常加载(localStorage `image-playground` 键未失效);新建/删除对话、删除收藏分类、收藏筛选与分类筛选互斥行为均与重构前一致。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(store): 收口 persist 与 AppState 类型,完成 slice 化"
```

---

## 阶段 2 — MaskEditorModal 拆分

> 先迁目录:`git mv src/components/MaskEditorModal.tsx src/components/MaskEditorModal/index.tsx`,修正内部相对 import 深度(`'../../lib/...'` 等),`npx tsc -b` + `npx vitest run` 验证后单独提交:`refactor(mask): MaskEditorModal 迁为目录`。后续任务在该目录内加文件。

### Task 2.1: 抽 `useMaskHistory`(纯逻辑,补单测)

**Files:**
- Create: `src/components/MaskEditorModal/hooks/useMaskHistory.ts`
- Create: `src/components/MaskEditorModal/hooks/useMaskHistory.test.ts`
- Modify: `src/components/MaskEditorModal/index.tsx`(原行 126-127, 142, 221-229, 269-274, 376-394, 750-779)

- [ ] **Step 1: 定义 hook 接口**

```ts
export interface MaskHistory {
  canUndo: boolean
  canRedo: boolean
  pushSnapshot: () => void          // 绘制前存当前 maskCanvas ImageData
  restoreMask: () => void           // 从栈顶恢复并触发 renderPreview
  undo: () => void
  redo: () => void
  clear: () => void                 // push 快照 + fillWhiteMask + renderPreview
  cancelActiveStroke: () => void    // 笔画中断回滚
}
export function useMaskHistory(args: {
  maskCanvasRef: React.RefObject<HTMLCanvasElement | null>
  renderPreview: () => void
  fillWhiteMask: () => void
}): MaskHistory
```
将原 `undoStackRef`/`redoStackRef`/`historyState`(行 126-127,142)、`pushUndoSnapshot`/`restoreMask`(376-394)、`syncHistoryState`(269-274)、`handleUndo`/`handleRedo`(750-770)、`handleClear`(772-779)、`cancelActiveStroke`(221-229)原样移入。`canUndo/canRedo` 取代 `historyState` 暴露给 UI。保留"最多 40 个快照"上限逻辑。

- [ ] **Step 2: 写单测(纯栈逻辑值得测)**

`useMaskHistory.test.ts`,用 `@testing-library/react` 的 `renderHook`(若未装则用最小手写 harness);若不引入新测试依赖,改为提取纯函数 `pushBounded(stack, item, max)` 单独测试。测试用例:
```ts
// 验证栈上限 40、undo 后 canRedo=true、redo 还原、clear 后 canUndo=true
```
给出至少 3 个断言(上限裁剪、undo/redo 对称、clear 入栈)。

- [ ] **Step 3: index.tsx 改用 hook**

删除被移动的 ref/函数,改为 `const history = useMaskHistory({ maskCanvasRef, renderPreview, fillWhiteMask })`;调用点改 `history.undo()` 等;工具栏 disabled 用 `!history.canUndo`。

- [ ] **Step 4: 验证**

Run: `npx vitest run src/components/MaskEditorModal/hooks/useMaskHistory.test.ts` → 新测试 PASS
Run: `npx tsc -b` → 0 error；`npx vitest run` → ≥170 passed；`npm run lint` → 0 error

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(mask): 抽出 useMaskHistory 并补单测"
```

### Task 2.2: 抽 `useCanvasViewport`

**Files:**
- Create: `src/components/MaskEditorModal/hooks/useCanvasViewport.ts`
- Modify: `index.tsx`(原行 132,139,196-219,706-725,607-616)

- [ ] **Step 1: 定义接口**

```ts
export interface CanvasViewport {
  viewTransform: ViewTransform
  viewTransformRef: React.MutableRefObject<ViewTransform>
  commitViewTransform: (t: ViewTransform) => void   // clamp + ref 同步 + setState
  resetViewTransform: () => void
  zoomAtPoint: (clientPoint: Point, factor: number) => void
  isZoomed: boolean
}
export function useCanvasViewport(args: {
  size: CanvasSize | null
  baseFrameRef: React.RefObject<HTMLDivElement | null>
  stageRef: React.RefObject<HTMLDivElement | null>
}): CanvasViewport
```
移入 `viewTransformRef`/`viewTransform`、`commitViewTransform`/`resetViewTransform`(196-219)、滚轮缩放(706-725)、ResizeObserver clamp(607-616);内部调用既有 `clampViewTransform`/`getComfortableInitialTransform`/`zoomAtPoint`(`lib/image/viewportTransform`)。

- [ ] **Step 2: index.tsx 改用 hook;Step 3: 验证(tsc/test/lint 同上);Step 4: Commit**

```bash
git add -A && git commit -m "refactor(mask): 抽出 useCanvasViewport"
```

### Task 2.3: 抽 `useMaskCanvasInit`

**Files:**
- Create: `src/components/MaskEditorModal/hooks/useMaskCanvasInit.ts`
- Modify: `index.tsx`(原行 430-558 的初始化/加载/cleanup effect,134-135 的 sourceDataUrl/size)

- [ ] **Step 1: 定义接口**

```ts
export function useMaskCanvasInit(args: {
  imageId: string | null
  maskDraft: MaskDraft | null
  imageCanvasRef: React.RefObject<HTMLCanvasElement | null>
  maskCanvasRef: React.RefObject<HTMLCanvasElement | null>
  previewCanvasRef: React.RefObject<HTMLCanvasElement | null>
  renderPreview: () => void
  onError: (msg: string) => void
}): { sourceDataUrl: string; size: CanvasSize | null; isLoading: boolean }
```
移入 sessionId 追踪(430-445)与核心初始化 effect(447-558):加载源图、初始化 maskCanvas 为白、加载草稿 mask、cancelled 标志 cleanup。保持 `ensureImageCached`/`loadImage`/`prepareMaskTargetDataUrl` 调用与会话有效性检查。

- [ ] **Step 2-4: index.tsx 改用 hook;验证;Commit**

```bash
git add -A && git commit -m "refactor(mask): 抽出 useMaskCanvasInit"
```

### Task 2.4: 抽 `usePointerInteraction`

**Files:**
- Create: `src/components/MaskEditorModal/hooks/usePointerInteraction.ts`
- Modify: `index.tsx`(原行 121-125,143-146,231-267,396-428,625-748)

- [ ] **Step 1: 定义接口**

```ts
export interface PointerInteraction {
  hoverPoint: Point | null
  isPointerOverCanvas: boolean
  isPanning: boolean
  isAltKeyPressed: boolean
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: (e: React.PointerEvent) => void
    onPointerLeave: (e: React.PointerEvent) => void
    onWheel: (e: React.WheelEvent) => void
  }
}
export function usePointerInteraction(args: {
  maskCanvasRef: React.RefObject<HTMLCanvasElement | null>
  viewport: CanvasViewport
  history: MaskHistory
  tool: Tool
  brushSize: number
  size: CanvasSize | null
  renderPreview: () => void
}): PointerInteraction
```
移入 `activePointerIdRef`/`lastPointRef`/`pointerPositionsRef`/`pinchGestureRef`/`panGestureRef`(121-125)、`isPanning`/`isAltKeyPressed`/`hoverPoint`/`isPointerOverCanvas`(143-146)、捏合(231-267)、绘制 `drawAt`/`drawStroke`(396-428)、指针/滚轮处理与 `finishStroke`(625-748)、Alt 键监听 effect(570-589)。绘制前调 `history.pushSnapshot()`;缩放调 `viewport.zoomAtPoint`。

- [ ] **Step 2-4: 改用 hook;验证;Commit**

```bash
git add -A && git commit -m "refactor(mask): 抽出 usePointerInteraction(绘制+手势)"
```

### Task 2.5: 抽 `useCursorOverlay`

**Files:**
- Create: `src/components/MaskEditorModal/hooks/useCursorOverlay.ts`
- Modify: `index.tsx`(原行 300-362 的 updateCursor,560-568 的 effect)

- [ ] **Step 1: 定义接口**

```ts
export function useCursorOverlay(args: {
  cursorCanvasRef: React.RefObject<HTMLCanvasElement | null>
  viewTransformRef: React.MutableRefObject<ViewTransform>
  brushSize: number
  hoverPoint: Point | null
  isPointerOverCanvas: boolean
  showBrushControls: boolean
  size: CanvasSize | null
  isAltKeyPressed: boolean
}): void  // 副作用 hook,内部 effect 调 updateCursor
```
移入 `updateCursor`(300-362)及其触发 effect(560-568)。

- [ ] **Step 2-4: 改用 hook;验证;Commit**

```bash
git add -A && git commit -m "refactor(mask): 抽出 useCursorOverlay"
```

### Task 2.6: 抽子组件并重组主文件

**Files:**
- Create: `BrushToolbar.tsx`、`BrushSizePanel.tsx`、`MaskInfoPopover.tsx`、`CanvasViewport.tsx`(均在 `src/components/MaskEditorModal/`)
- Modify: `index.tsx`

- [ ] **Step 1: 抽 `<CanvasViewport>`**

props:`{ size, viewTransform, isPanning, isAltKeyPressed, refs: {image,mask,preview,cursor,base,stage}, handlers }`。移入原行 894-927 的 4-canvas 叠放 JSX + 指针事件绑定。

- [ ] **Step 2: 抽 `<BrushToolbar>`**

props:`{ tool, onToolChange, canUndo, canRedo, onUndo, onRedo, isZoomed, onResetView, onClear, onToggleBrushSize, isSaving }`。移入原行 930-1004。

- [ ] **Step 3: 抽 `<BrushSizePanel>`**

props:`{ open, brushSize, onChange, anchor, disabled }`。移入原行 1006-1027(portal 滑块)。

- [ ] **Step 4: 抽 `<MaskInfoPopover>`**

props:`{ open, onOpenChange }`(含触摸长按 450ms 逻辑或由父传入 handlers)。移入原行 867-872 及 176-181 的定时器。

- [ ] **Step 5: index.tsx 退化为协调层**

只保留:store 订阅(`maskEditorImageId`/`maskDraft` + actions)、`tool`/`brushSize`/`showBrushControls`/`sliderAnchor`/`isSaving` 状态、5 个 hook 调用、`handleSave`/`handleRemoveMask`、`renderPreview`/`fillWhiteMask` 的定义、以及组装 4 个子组件的 JSX。目标 ~300 行。

- [ ] **Step 6: 验证**

Run: `npx tsc -b` → 0 error；`npx vitest run` → ≥170 passed；`npm run lint` → 0 error
手动冒烟:打开遮罩编辑器 → 画/擦 → 调笔刷大小 → Alt 平移 + 滚轮缩放 → 撤销/重做 → 重置视图 → 清空 → 保存 → 移除遮罩,逐项与重构前一致。

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor(mask): 抽子组件并将主文件降为协调层"
```

---

## 阶段 3 — SettingsModal 拆分

> 先迁目录:`git mv src/components/SettingsModal.tsx src/components/SettingsModal/index.tsx`,修正相对 import 深度,验证后提交 `refactor(settings): SettingsModal 迁为目录`。

### Task 3.1: 抽共享组件 `<ModelListDropdown>`(消除 ~170 行重复)

**Files:**
- Create: `src/components/SettingsModal/ModelListDropdown.tsx`
- Modify: `index.tsx`(原行 696-776 API Profile 处、845-912 Optimizer 处)

- [ ] **Step 1: 定义接口**

```ts
export interface ModelListDropdownProps {
  value: string
  onChange: (model: string) => void
  onFetch: () => Promise<void>
  isLoading: boolean
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  modelList: string[] | null
  error: string | null
  placeholder?: string
}
export function ModelListDropdown(props: ModelListDropdownProps): JSX.Element
```
把"模型 ID 输入框 + 刷新拉取按钮 + 下拉列表 + 加载/错误态 + 外部点击关闭"统一实现一次。外部点击关闭的 effect 内置到组件(用组件内部 ref)。

- [ ] **Step 2: 两处替换为 `<ModelListDropdown>`**

API Profile 处与 Optimizer 处各自传入对应的 state/handler(model 列表状态仍暂存在 index.tsx,Task 3.3 再随 section 下沉)。

- [ ] **Step 3: 验证**:`npx tsc -b` 0 error；`npx vitest run` ≥170；`npm run lint` 0 error
- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(settings): 抽出共享 ModelListDropdown,消除模型列表重复"
```

### Task 3.2: 抽 `useTimeoutInput`(纯逻辑,补单测)

**Files:**
- Create: `src/components/SettingsModal/useTimeoutInput.ts`
- Create: `src/components/SettingsModal/useTimeoutInput.test.ts`
- Modify: `index.tsx`(原行 49,61-62,219-227,919-928)

- [ ] **Step 1: 提取纯规范化函数 + hook**

```ts
// 纯函数,便于单测
export function normalizeTimeout(input: string, fallback: number): number
// hook 封装受控输入 + blur 提交
export function useTimeoutInput(initial: number, onCommit: (v: number) => void): {
  value: string
  setValue: (s: string) => void
  commit: () => void
}
```
`normalizeTimeout`:trim → 空/NaN/≤0 返回 fallback,否则返回整数。两处(主超时 219-227、optimizer 919-928)共用。

- [ ] **Step 2: 写单测**

`useTimeoutInput.test.ts` 测 `normalizeTimeout`:
```ts
// '' → fallback；'abc' → fallback；'0' → fallback；'30' → 30；' 45 ' → 45；'-5' → fallback
```
≥5 个断言。

- [ ] **Step 3: 两处改用 hook;Step 4: 验证(含新测试 PASS);Step 5: Commit**

```bash
git add -A && git commit -m "refactor(settings): 抽出 useTimeoutInput 并补单测"
```

### Task 3.3: 抽 `<ProfileSelector>` / `<ApiProfileSection>` / `<OptimizerSection>`

**Files:**
- Create: `ProfileSelector.tsx`、`ApiProfileSection.tsx`、`OptimizerSection.tsx`
- Modify: `index.tsx`(原行 459-536 / 453-791 / 793-959)

- [ ] **Step 1: `<ProfileSelector>`**

props:`{ profiles, activeProfileId, open, onOpenChange, onSelect, onCreate, onDelete, disabled }`。移入 459-536(配置列表/创建/切换/删除菜单)。

- [ ] **Step 2: `<ApiProfileSection>`**

props:`{ profile, onUpdate, apiProxyAvailable, modelList状态组 }`(含 provider 切换、URL+Codex/代理开关、API Key 显隐、apiMode、`<ModelListDropdown>`、`useTimeoutInput`)。移入 453-791 的字段编辑部分;该 section 内聚 `showApiKey` 与模型列表 state。

- [ ] **Step 3: `<OptimizerSection>`**

props:`{ config, onUpdate }`(含 URL、API Key 显隐、`<ModelListDropdown>`、`useTimeoutInput`、systemPrompt)。移入 793-959;内聚 `showOptimizerApiKey` 与 optimizer 模型列表 state。

- [ ] **Step 4: index.tsx 装配这三个组件**,把对应 state 下沉到各 section,只保留 `draft`/`commitSettings`/`isDirty` 等协调逻辑。

- [ ] **Step 5: 验证**:`npx tsc -b` 0 error；`npx vitest run` ≥170；`npm run lint` 0 error
- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor(settings): 抽出 ProfileSelector/ApiProfileSection/OptimizerSection"
```

### Task 3.4: 抽 `<FavoriteCategorySection>` / `<DataManagementSection>` 并重组主文件

**Files:**
- Create: `FavoriteCategorySection.tsx`、`DataManagementSection.tsx`
- Modify: `index.tsx`(原行 961-1050 / 1052-1114)

- [ ] **Step 1: `<FavoriteCategorySection>`**

props:`{ categories, onUpdate, onMove, onDelete }`(增删改色、上下移、删除确认)。移入 961-1050;`handleDeleteCategory` 的确认对话逻辑随入或经 props 注入 `setConfirmDialog`。

- [ ] **Step 2: `<DataManagementSection>`**

props:`{ onExport, onImportMerge, onImportReplace, onClearAll }`。移入 1052-1114(导出/导入/清空 + 隐藏 file input + 确认对话)。

- [ ] **Step 3: index.tsx 退化为协调层**

保留:`showSettings` 订阅、`draft` 暂存与初始化 effect、`commitSettings`/`isDirty`/`handleClose`/`handleSave`、底部保存/取消按钮、装配各 section。目标 ~300 行。

- [ ] **Step 4: 验证**

Run: `npx tsc -b` 0 error；`npx vitest run` ≥170；`npm run lint` 0 error
手动冒烟:新建/切换/删除 profile、拉模型列表、改超时、配置 optimizer、收藏分类增删改色与排序、导出、导入(合并/替换)、清空数据、有未保存改动时关闭弹确认。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(settings): 抽出收藏分类/数据管理 section,主文件降为协调层"
```

---

## 阶段 4 — InputBar 拆分

> InputBar 已是目录,直接加文件。本阶段行号锚点为原始 `src/components/InputBar/index.tsx`(1630 行)。

### Task 4.1: 提升 `useIsMobile` 到 `src/hooks/`

**Files:**
- Create: `src/hooks/useIsMobile.ts`
- Modify: `InputBar/index.tsx`(原行 55-63)

- [ ] **Step 1:** 把 `useIsMobile`(55-63)原样移到 `src/hooks/useIsMobile.ts` 并 `export`。
- [ ] **Step 2:** index.tsx 改为 `import { useIsMobile } from '../../hooks/useIsMobile'`,删除本地定义。
- [ ] **Step 3:** 验证:`npx tsc -b` 0 error；`npx vitest run` ≥170；`npm run lint` 0 error
- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(inputbar): 提升 useIsMobile 到 src/hooks"
```

### Task 4.2: 抽 `useImageHintTimer`

**Files:**
- Create: `src/components/InputBar/hooks/useImageHintTimer.ts`
- Modify: `index.tsx`(原行 635,689-693,715-735)

- [ ] **Step 1: 定义接口**

```ts
export function useImageHintTimer(): {
  imageHintId: string | null
  showHint: (id: string) => void
  hideHint: () => void
  startHintTouch: (id: string) => void  // 长按延迟显示
}
```
移入 `imageHintId` state、`imageHintTimerRef`、`clearImageHintTimer`/`showImageHint`/`hideImageHint`/`startImageHintTouch`(715-735)及 cleanup effect(689-693)。

- [ ] **Step 2-3: 改用 hook;验证;Step 4: Commit**

```bash
git add -A && git commit -m "refactor(inputbar): 抽出 useImageHintTimer"
```

### Task 4.3: 抽 `useAutoResizeTextarea`

**Files:**
- Create: `src/components/InputBar/hooks/useAutoResizeTextarea.ts`
- Modify: `index.tsx`(原行 856-893)

- [ ] **Step 1: 定义接口**

```ts
export function useAutoResizeTextarea(args: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  deps: { prompt: string; imageCount: number; hasMask: boolean; maskPreviewUrl: string }
}): { adjustHeight: () => void }
```
移入 `adjustTextareaHeight`(856-880)与三个触发 effect(882-893:prompt 变化、images/mask 变化、window resize)。

- [ ] **Step 2-3: 改用 hook;验证;Step 4: Commit**

```bash
git add -A && git commit -m "refactor(inputbar): 抽出 useAutoResizeTextarea"
```

### Task 4.4: 抽 `useDragDropFiles`

**Files:**
- Create: `src/components/InputBar/hooks/useDragDropFiles.ts`
- Modify: `index.tsx`(原行 631,787-854)

- [ ] **Step 1: 定义接口**

```ts
export function useDragDropFiles(args: {
  onFiles: (files: File[]) => void   // 复用 index 的 handleFiles
  atImageLimit: boolean
}): { isDragging: boolean }
```
移入 `isDragging` state、dragCounter、全局 dragenter/over/leave/drop 监听(808-854)与粘贴监听(787-805)。`onFiles` 由 index 传入(handleFiles 含数量限制与 toast,保留在 index 因依赖多个 store action)。

- [ ] **Step 2-3: 改用 hook;验证;Step 4: Commit**

```bash
git add -A && git commit -m "refactor(inputbar): 抽出 useDragDropFiles(拖拽+粘贴)"
```

### Task 4.5: 抽 `useMobileGestures`

**Files:**
- Create: `src/components/InputBar/hooks/useMobileGestures.ts`
- Modify: `index.tsx`(原行 636,896-921)

- [ ] **Step 1: 定义接口**

```ts
export function useMobileGestures(args: { isMobile: boolean }): {
  mobileCollapsed: boolean
  setMobileCollapsed: (v: boolean) => void
  dragHandleRef: React.RefObject<HTMLDivElement | null>
}
```
移入 `mobileCollapsed` state 与拖动条手势 effect(896-921,touchstart/move/end 切换折叠)。

- [ ] **Step 2-3: 改用 hook;验证;Step 4: Commit**

```bash
git add -A && git commit -m "refactor(inputbar): 抽出 useMobileGestures"
```

### Task 4.6: 抽 `useModelList` 并提升 `ModelMenu`/`ResolutionMenu` 为独立文件

**Files:**
- Create: `src/components/InputBar/hooks/useModelList.ts`、`src/components/InputBar/ModelMenu.tsx`、`src/components/InputBar/ResolutionMenu.tsx`
- Modify: `index.tsx`(原行 142-486 / 492-583)

- [ ] **Step 1: 抽 `useModelList`**

```ts
export type ModelListState =
  | { kind: 'idle' } | { kind: 'loading' }
  | { kind: 'success'; models: string[] } | { kind: 'error'; message: string }
export function useModelList(activeProfile: ApiProfile): {
  state: ModelListState
  fetchModels: () => Promise<void>
}
```
移入原 ModelMenu 内的 `modelState`(155)、`doFetch`(181-207)、初始化 effect(210-226),含缓存检查。

- [ ] **Step 2: 提升 `<ModelMenu>`**

把原行 142-486 的 ModelMenu 子函数移到 `ModelMenu.tsx`,props:`{ anchorRef, onClose }`,内部用 `useModelList` + store(`settings`/`setSettings`/`setShowSettings`)。外部点击/Esc 关闭 effect 随入。

- [ ] **Step 3: 提升 `<ResolutionMenu>`**

把原行 492-583 移到 `ResolutionMenu.tsx`,props:`{ anchorRef, onClose }`,内部用 store(`params`/`setParams`)+ `calculateImageSize`。

- [ ] **Step 4: index.tsx 改 import 这两个组件**,删除内联定义。
- [ ] **Step 5: 验证**:`npx tsc -b` 0 error；`npx vitest run` ≥170；`npm run lint` 0 error
- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor(inputbar): 抽出 useModelList 并提升 ModelMenu/ResolutionMenu"
```

### Task 4.7: 抽 `<ImageThumb>` 与 `<ImageGrid>`

**Files:**
- Create: `src/components/InputBar/ImageThumb.tsx`、`src/components/InputBar/ImageGrid.tsx`
- Modify: `index.tsx`(原行 639-641,923-1224)

- [ ] **Step 1: 抽 `<ImageThumb>`(279 行重灾区)**

props:
```ts
interface ImageThumbProps {
  image: InputImage
  index: number
  isMaskTarget: boolean
  maskPreviewUrl: string
  hintVisible: boolean
  onRemove: (index: number) => void
  onClickImage: (id: string) => void
  onClickMask: (id: string) => void
  dragHandlers: ImageDragHandlers   // 见下
  hintHandlers: { onTouchStart: () => void; onHintShow: () => void; onHintHide: () => void }
}
```
移入原 `renderImageThumb`(994-1183)的单图渲染 + 拖拽(handleDragStart/Over/Drop)+ 触摸(handleTouchStart/Move/End/Cancel)。

- [ ] **Step 2: 抽 `<ImageGrid>`**

封装拖拽编排状态(`imageDragIndex`/`imageDragOverIndex`/`touchDragPreview`,639-641)与纯计算辅助(getTouchDropIndex/normalizeImageDropIndex/isBeforeMaskDropArea/resetImageDrag/getDataTransferDragIndex/setImageDragTarget,923-992),渲染缩略图列表 + 清空按钮(1185-1224)+ 触摸拖拽预览 portal。props:`{ inputImages, maskTargetImage, maskDraft, maskPreviewUrl, onMove, onRemove, onClearAll, ...hint/click handlers }`,内部 `.map` 渲染 `<ImageThumb>`。

- [ ] **Step 3: index.tsx 改用 `<ImageGrid>`;Step 4: 验证;Step 5: Commit**

```bash
git add -A && git commit -m "refactor(inputbar): 抽出 ImageThumb/ImageGrid(含拖拽交互)"
```

### Task 4.8: 抽 `<PillRow>`/`<TextareaInput>`/`<SubmitButton>` 并重组主文件

**Files:**
- Create: `PillRow.tsx`、`TextareaInput.tsx`、`SubmitButton.tsx`(在 `src/components/InputBar/`)
- Modify: `index.tsx`(原行 645,1227-1615)

- [ ] **Step 1: 抽 `<TextareaInput>`**

props:`{ value, onChange, onKeyDown, onClear, textareaRef, adjustHeight }`。移入 1564-1592。

- [ ] **Step 2: 抽 `<SubmitButton>`**

props:`{ canSubmit, hasMask, hover, onHoverChange, onSubmit, onOpenSettings, needsConfig }`。移入 1593-1615。

- [ ] **Step 3: 抽 `<PillRow>`**

props:`{ openMenu, onOpenMenuChange, params, settings, onParamsChange, refs, onOpenSizePicker, onOptimize, onReset, onAttach, onOpenAdvanced }`。移入 1227-1459(模型/风格/比例/分辨率/优化/重置/上传/高级 pill 行 + 装配 ModelMenu/StylePickerPopover/ResolutionMenu/AdvancedParamsPopover)。`openMenu` 互斥状态(645)上提为 props 由 index 管理或内聚到 PillRow。

- [ ] **Step 4: index.tsx 退化为协调层**

保留:store 订阅(改 useShallow 见阶段 5)、`handleFiles`、`params` 规范化 effect(681-687)、`maskPreviewUrl` 生成(695-713)、`filteredTasks` useMemo(610-617)、`canSubmit` 计算、各 hook 调用、装配 `<MobileCollapseHandle>`(1523-1530,可内联)/`<PillRow>`/`<ImageGrid>`/`<TextareaInput>`/`<SubmitButton>`/拖拽遮罩层(1474-1506)/SizePicker(1508-1515)。目标 ~400 行。

- [ ] **Step 5: 验证**

Run: `npx tsc -b` 0 error；`npx vitest run` ≥170；`npm run lint` 0 error
手动冒烟:输入并提交生成、文件/粘贴/整页拖拽上传、参考图删除与拖拽排序(桌面+移动触摸)、遮罩入口、各 pill 菜单(模型/风格/尺寸/分辨率/高级)、优化按钮、重置二次确认、移动端折叠手势,逐项与重构前一致。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor(inputbar): 抽出 PillRow/TextareaInput/SubmitButton,主文件降为协调层"
```

---

## 阶段 5 — 性能收口

### Task 5.1: 高密度订阅组件改用 `useShallow`

**Files:**
- Modify: `src/components/InputBar/index.tsx`、`src/components/TaskGrid.tsx`、`src/components/Sidebar/index.tsx`、`src/components/DetailModal.tsx`

- [ ] **Step 1: 改造订阅模式**

将各组件中"逐字段多次 `useStore((s) => s.x)`"或"返回新对象的 `useStore`"改为:
```ts
import { useShallow } from 'zustand/react/shallow'
const { tasks, searchQuery, filterStatus } = useStore(
  useShallow((s) => ({ tasks: s.tasks, searchQuery: s.searchQuery, filterStatus: s.filterStatus })),
)
```
逐组件套用,**不改任何字段含义与用法**,仅改订阅形态以减少无关重渲。actions(稳定引用)可继续单独取。

- [ ] **Step 2: 验证无功能回归**

Run: `npx tsc -b` 0 error；`npx vitest run` ≥170；`npm run lint` 0 error
手动:在这些视图下操作,确认行为与重构前一致(可选用 React DevTools Profiler 对照 render 次数下降)。

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "perf(store): 高密度订阅组件改用 useShallow 消除无关重渲"
```

### Task 5.2: 全量验证与合并准备

- [ ] **Step 1: 全量回归**

Run: `npx tsc -b` → 0 error
Run: `npx vitest run` → ≥170 passed(新增的 hook 单测计入)
Run: `npm run lint` → 0 error
Run: `npm run build` → 构建成功(确认 Vite 产物与 sw build id 注入正常)

- [ ] **Step 2: 全量手动冒烟**

依次覆盖阶段 1/2/3/4 的全部冒烟项 + persist 兼容(刷新后旧数据加载)+ PWA/SW 不受影响。

- [ ] **Step 3: 行号锚点核对**

确认四个目标对象行数达标:`store/` 为 slice 结构;`MaskEditorModal/index.tsx` ~300、`SettingsModal/index.tsx` ~300、`InputBar/index.tsx` ~400 行量级。

- [ ] **Step 4: 合并(经用户确认后)**

```bash
git checkout main
git merge --no-ff refactor/p0-maintainability
```

---

## Self-Review(已执行)

- **Spec 覆盖**:阶段 0(ESLint/Prettier + noUnused)↔ Task 0.1-0.2;阶段 1(slice 化 + persist 兼容 + 跨域 action + re-export)↔ Task 1.1-1.6;阶段 2(5 hook + 4 子组件)↔ Task 2.1-2.6;阶段 3(ModelListDropdown/useTimeoutInput + 5 section)↔ Task 3.1-3.4;阶段 4(6 hook/提升 + 5 子组件)↔ Task 4.1-4.8;阶段 5(useShallow + 全量验证)↔ Task 5.1-5.2。无遗漏。
- **占位符**:无 TBD/TODO;每个任务给出接口签名、源行号、验证命令与提交。
- **类型一致**:`MaskHistory`/`CanvasViewport`/`PointerInteraction`/`ModelListState`/`ModelListDropdownProps` 等接口在定义任务与被引用任务间命名一致;hook 间依赖(history→pointer、viewport→pointer)签名对齐。
- **验证适配重构**:等价重构以"既有测试保持绿 + tsc + lint + 冒烟"为主回归网,仅 `useMaskHistory`/`useTimeoutInput` 两处纯逻辑补单测。
</content>
