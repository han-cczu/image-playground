# P0 可维护性重构 — 设计文档

- **日期**:2026-05-24
- **分支**:`refactor/p0-maintainability`
- **状态**:已批准设计,待写实施计划
- **性质**:纯结构重构,**行为等价**,不改任何业务逻辑或 UI 表现

---

## 1. 背景与目标

项目当前功能完整、测试扎实(`tsc -b` 通过,21 个测试文件 170 用例全绿),核心矛盾是**特性堆得快、结构没跟上**,集中表现为四处可维护性债务:

| 对象 | 现状 | 实测要点 |
|---|---|---|
| `components/InputBar/index.tsx` | 1630 行 | 14 个 useState、10+ useEffect、订阅 23 个 store 字段跨 4 域;`renderImageThumb` 单块 279 行 |
| `components/SettingsModal.tsx` | 1137 行 | 16 个 useState、8 个 useEffect、混 5 个功能区;模型列表下拉 ~170 行重复 |
| `components/MaskEditorModal.tsx` | 1030 行 | 11 个 useState、22 个 useRef、7 个 useEffect、12 个事件处理函数 |
| `store.ts` | 623 行 | 单一巨型 store,30+ 字段裸 action,消费方普遍多字段订阅、无 `useShallow`/选择器 |

**目标**:在不改变任何外部行为的前提下,把上述四处拆分为职责单一、可独立理解和测试的单元;消除多域组件的无关重渲染;为后续迭代降低改动面与回归风险。

---

## 2. 范围

### 2.1 纳入(In Scope)

- 阶段 0:接入 ESLint + Prettier(含 `eslint-plugin-react-hooks`)作为重构安全网。
- 阶段 1:`store.ts` 按域 slice 化(Slice 组合**单 store** 形态)。
- 阶段 2-4:`MaskEditorModal` / `SettingsModal` / `InputBar` 三大组件按解剖拆分为子组件 + 自定义 hook。
- 阶段 5:对高密度订阅组件引入 `useShallow`/细粒度 selector,消除过度渲染。

### 2.2 排除(Out of Scope)

- 不引入新的状态管理库或新运行时依赖(ESLint/Prettier 为开发依赖,不计)。
- 不改任何业务逻辑、API 调用行为、数据格式、UI 交互表现。
- 不处理 P1/P2 问题(API 适配器去重、导入原子性与 `QuotaExceededError`、CORS 代理开放性、URL 传参校验等)——除非另行授权。

---

## 3. 总体策略与分支模型

- 全程在单分支 `refactor/p0-maintainability` 完成("一次性大重构",不向 `main` 逐步合并)。
- 分支内部按 **阶段 0 → 1 → 2 → 3 → 4 → 5** 顺序推进,每阶段一个(或数个)提交。
- 顺序依据:store 是地基(被 22 文件消费)故先行;三大组件中 `MaskEditorModal` 最自包含(仅订阅 `maskDraft`)放前面,`InputBar`(跨 4 域、23 字段)最复杂放最后。
- 全部阶段完成、全量验证通过后,一次性合并回 `main`。

### 验证关口(Gate,每阶段强制)

每个阶段结束、进入下一阶段前,必须同时满足:

1. `npx tsc -b` 通过(0 error)。
2. `npx vitest run` 全绿(基线 170 用例不减少;新增可测单元应补测试)。
3. 阶段 0 之后:`npm run lint` 0 error(warning 可暂留并记录)。
4. 该阶段所属功能域的**手动冒烟**通过(见各阶段"验证")。

> 基线锚点:重构前先记录 `tsc -b` 绿 + `vitest run` 170 passed 作为对照。

---

## 4. 阶段 0 — ESLint + Prettier 安全网

**动机**:三大 UI 组件目前几乎无组件级单测,重构安全网主要靠 `tsc strict` + 手动冒烟。`eslint-plugin-react-hooks` 能在静态阶段抓出 effect 依赖缺失、条件调用 hook 等重构高发缺陷,显著降低风险。

**内容**:

- 新增开发依赖:`eslint`、`@typescript-eslint/parser`、`@typescript-eslint/eslint-plugin`、`eslint-plugin-react-hooks`、`eslint-plugin-react-refresh`、`prettier`、`eslint-config-prettier`。
- 新增配置:`eslint.config.js`(flat config,匹配现有 ESLint 9 / Vite 6 生态)、`.prettierrc`。
- `package.json` 新增脚本:`"lint": "eslint src"`、`"format": "prettier --write src"`。
- `tsconfig.json` 打开 `noUnusedLocals` / `noUnusedParameters`(若触发既有告警,本阶段一并清理,但**不改逻辑**,仅删未用变量/参数或加下划线前缀)。

**验证**:`npm run lint` 跑通;`tsc -b` + `vitest run` 仍全绿。本阶段**只引入工具与清理死代码,不拆任何组件**。

---

## 5. 阶段 1 — store slice 化(Slice 组合单 store)

### 5.1 目标结构

`src/store.ts` → `src/store/` 目录。因 `import '../store'` / `'./store'` 会自动解析到 `src/store/index.ts`,**所有消费方 import 路径零改动**。

```
src/store/
  index.ts        # create<AppState>()((...a) => ({ ...4 slice })) + persist + 末尾 re-export 原样保留
  slices/
    settings.ts   # createSettingsSlice
    tasks.ts      # createTasksSlice
    ui.ts         # createUiSlice
    filters.ts    # createFiltersSlice
  persist.ts      # partialize + mergePersistedStoreState
  types.ts        # AppState 及各 slice 的类型(或保留在 src/types.ts)
```

### 5.2 字段归域表(基于实测)

| 域 | 字段 / action |
|---|---|
| **settings** | `settings`、`setSettings`、`dismissedCodexCliPrompts`、`dismissCodexCliPrompt` |
| **tasks** | `tasks`/`setTasks`;`conversations`/`activeConversationId` 及其增删改;`favoriteCategories`/`favoriteCategoriesInitialized` 及其增删改移;`params`/`setParams`;`prompt`/`setPrompt`;`inputImages` 及增删改移;`maskDraft`/`maskEditorImageId` 及其操作 |
| **ui** | `sidebarCollapsed`/`toggleSidebar`/`setSidebarCollapsed`;`dismissedInsecureContextBanner`;`detailTaskId`;`lightboxImageId`/`lightboxImageList`;`showSettings`;`showPromptOptimizer`;`toast`/`showToast`;`confirmDialog`/`setConfirmDialog`;`galleryView` |
| **filters** | `searchQuery`、`filterStatus`、`filterFavorite`、`filterFavoriteCategoryId`;`selectedTaskIds`/`toggleTaskSelection`/`clearSelection`(多选,归入 filters) |

> `inputImages` / `maskDraft` / `maskEditorImageId` 三者紧耦合(见下),**整组保留在 tasks slice,不拆散**。

### 5.3 跨域 action 处理(单实例下 `get()` 直调)

以下 5 类跨域逻辑在单 store 实例中通过 `get().otherAction()` 直接调用,零摩擦;实施时逐一核对原 `set`/`get` 语义保持等价:

1. `deleteFavoriteCategory` — 清理引用该分类的 task + 重置 `filterFavoriteCategoryId`(tasks ↔ filters)。
2. `deleteConversationWithTasks` — 级联删 task + 切换 `activeConversationId` + UI 反馈(tasks ↔ ui)。
3. `removeInputImage` / `clearInputImages` / `setInputImages` — 联动清空 `maskDraft` / `maskEditorImageId`(tasks 内)。
4. `setMaskDraft` — 联动 `orderImagesWithMaskFirst` 重排 `inputImages`(tasks 内)。
5. `filterFavorite` ↔ `filterFavoriteCategoryId` 互斥(filters 内)。

### 5.4 persist 与兼容性

- `partialize` 持久化字段保持**完全不变**(settings、favoriteCategories、favoriteCategoriesInitialized、params、prompt、inputImages[id+空dataUrl]、dismissedCodexCliPrompts、activeConversationId、sidebarCollapsed、dismissedInsecureContextBanner、galleryView);persist `name: 'image-playground'` 与 `merge` 函数语义不变,确保**已有用户 localStorage 数据无缝兼容**。
- `index.ts` 末尾对 `taskRuntime` / `exportImport` / `imageCache` 的 re-export **逐条保留**,消费方无感知。

### 5.5 验证

`store.test.ts`(665 行)是本阶段最硬的回归保护,全程必须绿;`conversations.test.ts` / `conversationMigration.test.ts` 绿;手动冒烟:刷新页面后历史/设置/对话正常加载,新建/删除对话、删除收藏分类、筛选互斥行为不变。

---

## 6. 阶段 2 — MaskEditorModal(1030 → 目标主文件 ~300 行)

仅订阅 `maskDraft`/`maskEditorImageId`,几乎不碰 store,风险最低,作为三大组件拆分的首个范例。

### 6.1 抽取自定义 hook

| Hook | 职责 | 关键 state/ref |
|---|---|---|
| `useMaskCanvasInit` | canvas 初始化、源图与草稿加载(对应 effect 447-558) | `imageCanvasRef`/`maskCanvasRef`/`previewCanvasRef`、`sourceDataUrl`、`size` |
| `useMaskHistory` | undo/redo 栈与快照(`pushUndoSnapshot`/`restoreMask`/`handleUndo`/`handleRedo`/`handleClear`) | `undoStackRef`/`redoStackRef`/`historyState` |
| `useCanvasViewport` | 视图变换:缩放/平移/clamp/重置/ResizeObserver | `viewTransformRef`/`viewTransform`/`baseFrameRef`/`stageRef` |
| `usePointerInteraction` | 指针绘制 + pan/pinch 手势(合并 drawing 与 gestures) | `activePointerIdRef`/`pointerPositionsRef`/`panGestureRef`/`pinchGestureRef` |
| `useCursorOverlay` | 笔刷光标 canvas 绘制(`updateCursor`,effect 560-568) | `cursorCanvasRef`/`hoverPoint`/`viewTransformRef`/`brushSize` |

### 6.2 抽取子组件

`<CanvasViewport>`(4 个 canvas 叠放 + 指针/滚轮事件,894-927)、`<BrushToolbar>`(工具/撤销重做/重置/清空,930-1004)、`<BrushSizePanel>`(滑块 portal,1006-1027)、`<MaskInfoPopover>`(说明气泡,867-872)。

### 6.3 验证

`mask.test.ts` / `maskPreprocess.test.ts` / `viewportTransform.test.ts` 绿;手动冒烟:打开遮罩编辑器画/擦、缩放平移、撤销重做、保存、清空、移除遮罩。

---

## 7. 阶段 3 — SettingsModal(1137 → 目标主文件 ~300 行)

### 7.1 消除重复(最大收益)

- `<ModelListDropdown>` — API Profile(行 ~700-765)与 Optimizer(行 ~847-911)两处"模型 ID 输入 + 拉列表按钮 + 下拉菜单 + 加载/错误态"结构完全相同(~170 行),抽为单一可复用组件,props:`value/onChange/onFetch/isLoading/isOpen/onOpenChange/modelList/error`。
- `useTimeoutInput` — 两处超时输入规范化(`commitTimeout` 219-227 与 optimizer 919-928)抽为共享 hook。

### 7.2 抽取子组件(各自内聚其 state 子集)

`<ProfileSelector>`(配置列表/创建/切换/删除,459-536)、`<ApiProfileSection>`(API 配置编辑,453-791)、`<OptimizerSection>`(优化器配置,793-959)、`<FavoriteCategorySection>`(收藏分类增删改移,961-1050)、`<DataManagementSection>`(导入/导出/清空,1052-1114)。`draft` 暂存与 `commitSettings`/`isDirty`/保存关闭逻辑保留在主组件作为协调层。

### 7.3 验证

`apiProfiles.test.ts` / `api.test.ts` / `exportImport.test.ts` 绿;手动冒烟:新建/切换/删除 profile、拉模型列表、改超时、配置 optimizer、导出导入合并/替换、清空数据、收藏分类增删改色、未保存关闭确认。

---

## 8. 阶段 4 — InputBar(1630 → 目标主文件 ~400 行)

最复杂,放最后。优先抽出 `renderImageThumb`(279 行,含全部图片拖拽/触摸交互)。

### 8.1 抽取自定义 hook

| Hook | 职责 | 对应行号 |
|---|---|---|
| `useDragDropFiles` | 全屏 dragenter/over/leave/drop + dragCounter | 808-854 |
| `useAutoResizeTextarea` | textarea 动态高度计算 + resize 监听 | 856-893 |
| `useMobileGestures` | 移动端拖动条折叠手势 | 896-921 |
| `useImageHintTimer` | 长按延迟显示/隐藏图片提示 | 715-735 |
| `useModelList` | 模型列表加载缓存状态机 | 181-226 |
| `useIsMobile` | 提升到 `src/hooks/`(当前内联 55-63) | 55-63 |

### 8.2 抽取子组件

`<ImageThumb>`(单图缩略图 + 拖拽/触摸,994-1183)、`<ImageGrid>`(缩略图网格 + 清空按钮 + 触摸预览,1185-1224)、`<PillRow>`(参数 pill 行,1227-1459)、`<TextareaInput>`(1564-1592)、`<SubmitButton>`(1593-1615);`ModelMenu`(142-486)/`ResolutionMenu`(492-583)提升为独立文件。

> `params` 规范化 effect(681-687)、`maskPreviewUrl` 生成(695-713)、`filteredTasks` useMemo(610-617)等业务派生保留在主组件。

### 8.3 验证

全量 `vitest run` 绿;手动冒烟:输入/提交生成、上传(文件/粘贴/拖拽)、参考图增删拖拽排序、遮罩入口、各 pill 菜单、风格/尺寸/高级参数、移动端折叠与触摸拖拽、重置二次确认。

---

## 9. 阶段 5 — 性能收口

slice 化后,对解剖标注的高密度订阅组件改用 `useShallow` 单次订阅或细粒度 selector,消除跨域字段变更引发的无关重渲:

- `InputBar`(23 字段 / 4 域)、`TaskGrid`(11 / 3 域)、`Sidebar`(11 / 3 域)、`DetailModal`(10 字段)。

**验证**:全量 `tsc -b` + `vitest run` 170 绿 + `npm run lint` 0 error + 整体冒烟(覆盖前述各阶段冒烟项)→ 合并回 `main`。

---

## 10. 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| UI 组件无单测,自动化安全网薄弱 | 高 | 阶段 0 先上 ESLint(react-hooks 规则);每阶段强制手动冒烟;分阶段提交便于二分定位 |
| 一次性大重构中间态不可用 | 中 | 分支内分阶段、每阶段 Gate 全绿后才推进,而非全改完才验证 |
| store slice 化破坏跨域 action 语义 | 中 | 单实例 `get()` 直调保持原语义;逐条核对;`store.test.ts` 665 行回归保护 |
| persist 兼容性(老用户 localStorage) | 中 | `partialize`/`name`/`merge` 完全不变,显式验证刷新后数据加载 |
| hook 抽取改变 effect 时序/依赖 | 中 | ESLint react-hooks 校验依赖;手动冒烟交互;保持 effect 触发条件等价 |
| 组件拆分引入 props drilling 过深 | 低 | 按解剖的清晰边界拆;必要时子组件直接订阅 store 而非透传 |

---

## 11. 成功标准

1. 四个目标对象拆分完成:`store` 为 slice 组合结构;三大组件主文件分别降至约 300/300/400 行量级,职责单一。
2. 全程 `tsc -b` 通过、`vitest run` 不少于 170 用例全绿、`npm run lint` 0 error。
3. **行为零回归**:所有手动冒烟项与重构前一致。
4. persist 数据格式不变,老用户无感知。
5. 高密度订阅组件改用 `useShallow`/选择器,无功能回归。

---

## 12. 附录 — 受影响文件清单(预估)

- **新增**:`eslint.config.js`、`.prettierrc`;`src/store/{index,persist,types}.ts` + `src/store/slices/{settings,tasks,ui,filters}.ts`;`src/hooks/useIsMobile.ts`;各组件拆出的子组件与 hook 文件。
- **改动**:`package.json`、`tsconfig.json`;`src/store.ts`(迁移为目录);`MaskEditorModal.tsx`、`SettingsModal.tsx`、`InputBar/index.tsx`(瘦身为协调层);阶段 5 的 `TaskGrid.tsx`、`Sidebar/index.tsx`、`DetailModal.tsx`。
- **保持不变**:`lib/` 下全部模块(`taskRuntime`、`exportImport`、API 适配器等)、`types.ts`(类型如需细分另议)、所有 `*.test.ts` 应保持绿(可新增,不应删改既有断言)。
</content>
</invoke>
