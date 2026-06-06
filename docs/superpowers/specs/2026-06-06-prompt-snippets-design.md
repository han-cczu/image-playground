# 提示词片段库(snippets)设计

- 日期:2026-06-06
- 状态:待评审
- 范围:roadmap v2 第 1 项。把提示词从「一次性输入」变为「可沉淀资产」:保存/管理常用片段与含通配的模板,底栏「片段」pill 一键插入光标处,导出/导入随 ZIP 备份。

## 1. 背景与目标

应用已转向「实验工作台」(通配批量 / XY 网格 / 血缘 / 命令面板),但实验的**输入侧**没有资产化:

- 风格预设写死 8 种,用户自己打磨的修饰词组合、含通配的实验模板(如 `{晨光|正午|黄昏}的{近景|远景}`)只能反复手敲或外部记事本粘贴。
- 「提示词模板/snippets 库」已被两个 spec 点名「另议」(batch-experiment-foundation §1/§8)。

**目标**:用户可以把任意文本片段存为命名 snippet,在输入框光标处一键插入;片段含通配组时提交后正常笛卡尔展开,与网格 prompt 轴无缝衔接;随导出/导入备份迁移。

**明确不做(本期)**:见 §7 非目标。

## 2. 现状盘点(可复用件)

- **pill + popover 模式**:`PillRow.tsx` 已有 5 个互斥弹层(model/style/resolution/advanced/grid),`OpenMenu` union + anchorRef + Esc/outside-click(`StylePickerPopover` 为最简模板)。新片段 pill 完全沿用。
- **textarea 光标插入**:`textareaRef` 在 `InputBar/index.tsx`(L79),`adjustTextareaHeight` 同处;PillRow 是其子组件,插入回调可由 index.tsx 下传。
- **fuzzyMatch**(`lib/fuzzyMatch.ts`):命令面板沉淀的子序列匹配纯函数,popover 搜索直接复用。
- **持久化范式**:`favoriteCategories` = zustand store + persist partialize + `normalizeFavoriteCategories` 防损坏 + 导出 manifest 字段 + 导入 merge。snippets 同款。
- **通配展开**(`lib/promptExpand.ts`):对 prompt 内容透明,snippet 插入后无需任何新逻辑。

## 3. 交互形态比较(关键决策)

| 方案 | 说明 | 取舍 |
|------|------|------|
| **A. 底栏「片段」pill + popover(采用)** | 列表 + 搜索 + 点击插入光标处 + 内联管理 | 对齐现有 5 个 pill 心智与代码模式;移动端天然可用;实现面小 |
| B. textarea 内 `/` inline 触发 | 输入 `/` 弹自动补全 | 与 IME、正文斜杠(URL/分数)冲突;锚定光标坐标的浮层实现复杂;移动端键盘遮挡。v2 再议 |
| C. 仅命令面板入口 | 「插入片段:×」命令 | 桌面 only;面板执行时光标态丢失只能 append。降为本期**可选**增强(§4.6) |

## 4. 详细设计

### 4.1 类型(`src/types.ts`)

```ts
export interface PromptSnippet {
  id: string            // snip-<ts36>-<uid36>-<rand>(对齐 genCategoryId 形态)
  name: string          // 显示名,搜索目标;非空,trim 后 ≤ 50 字符
  content: string       // 片段正文,可含通配组;非空,≤ 5000 字符
  createdAt: number
  updatedAt: number
  sortOrder: number     // 列表序,连续整数
}
```

### 4.2 纯函数(`src/lib/promptSnippets.ts`,新建)

```ts
export const MAX_SNIPPETS = 200
export const MAX_SNIPPET_NAME_LEN = 50
export const MAX_SNIPPET_CONTENT_LEN = 5000

export function genSnippetId(): string

/** 损坏数据兜底:跳过无效项、修补缺失字段、按 sortOrder 重排为连续整数(对齐 normalizeFavoriteCategories)。 */
export function normalizeSnippets(value: unknown): PromptSnippet[]

/** 导入合并:按 id 去重,已有同 id 保留本地(对齐 mergeFavoriteCategories 语义);超 MAX_SNIPPETS 截断。 */
export function mergeSnippets(local: PromptSnippet[], imported: PromptSnippet[]): PromptSnippet[]

/** 光标处插入:返回新文本与新光标位(插入段末尾)。selStart>selEnd 入参时自动交换;越界钳制。原样插入,不自作聪明加分隔符。 */
export function insertAtCursor(
  text: string, selStart: number, selEnd: number, snippet: string,
): { next: string; caret: number }
```

注意:`insertAtCursor` 操作的是 **UTF-16 下标**(textarea `selectionStart` 语义),与 fuzzyMatch 的码点下标无关,不混用。

### 4.3 store(`src/store/slices/tasks.ts` 或独立挂在现有 slice;与 favoriteCategories 同居一处)

```ts
snippets: PromptSnippet[]
setSnippets: (s: PromptSnippet[]) => void                       // normalize 后整体替换(导入用)
createSnippet: (input: { name: string; content: string }) => string | null  // 满 MAX 返回 null + toast
updateSnippet: (id, patch: Partial<Pick<PromptSnippet, 'name' | 'content'>>) => void  // 更新 updatedAt
deleteSnippet: (id: string) => void
moveSnippet: (id: string, direction: -1 | 1) => void            // 对齐 moveFavoriteCategory
```

持久化:`partialize` 增 `snippets`;`mergePersistedStoreState` 增 `snippets: normalizeSnippets(persisted?.snippets)`。纯 localStorage(zustand persist),不进 IDB——文本量级(200×5KB 上限 ≈ 1MB 最坏,正常远小)。

### 4.4 UI:`SnippetPopover.tsx`(新建,`src/components/InputBar/`)

- PillRow 增「片段」pill(置于「网格」与「优化」之间),`OpenMenu` union 加 `'snippet'`。
- 结构对齐 `StylePickerPopover`(anchorRef + onClose + Esc/outside-click),宽度 ~280px:
  - **顶部搜索框**:`fuzzyMatch(query, name + ' ' + content前缀)` 过滤排序(空 query 按 sortOrder)。
  - **列表区**(max-h 滚动):每行 = 名称 + content 单行截断预览;**点击行 → 插入光标处并关闭**;行尾 hover 显示「编辑/删除」图标按钮(删除走 ConfirmDialog)。
  - **底部操作区**:「+ 新建片段」与「保存当前输入」(prompt 非空时可用,content 预填当前 prompt)。
  - **编辑态**:popover 内切换为表单(name 输入 + content textarea + 保存/取消),新建与编辑共用;校验非空与长度上限。
  - 空状态:「还没有片段——保存当前输入试试」。
- 列表行展示通配标记:content 含活动通配组时行尾加小角标(复用 `countPromptExpansion > 1` 判定),提示「插入后提交将展开 N 条」。

### 4.5 插入接线(`InputBar/index.tsx` → PillRow props)

```ts
const handleInsertSnippet = (content: string) => {
  const el = textareaRef.current
  const { next, caret } = insertAtCursor(prompt, el?.selectionStart ?? prompt.length, el?.selectionEnd ?? prompt.length, content)
  setPrompt(next)
  requestAnimationFrame(() => {
    el?.focus(); el?.setSelectionRange(caret, caret); adjustTextareaHeight()
  })
}
```

PillRow 增 prop `onInsertSnippet(content: string)`。popover 打开期间 textarea 失焦,`selectionStart` 保留上次光标位——符合预期;textarea 从未聚焦过则 append 到末尾。

### 4.6 可选增强:命令面板「插入片段」

`buildCommands` 增 `snippet` 组:每片段一条「插入片段:<name>」,run = `setPrompt(prompt + content)`(**append 语义**,面板打开时光标态不可得)。`CommandStore` Pick 增 `prompt`/`setPrompt`/`snippets`。实现成本 ~30 行 + 测试;若评审认为命令面板膨胀可砍,不影响主体。

### 4.7 导出/导入(`lib/exportImport.ts`)

- `ExportData` 增可选 `snippets?: PromptSnippet[]`;manifest `version: 4` **不升版**(旧版本导入器忽略未知字段,新导入器对缺失字段回退空数组,双向兼容)。
- 导出:`normalizeSnippets(useStore.getState().snippets)`。
- 导入:合并模式 `mergeSnippets(本地, 导入)`;替换模式直接 `setSnippets(normalizeSnippets(imported))`。
- `clearAllData` 一并清空 snippets。

## 5. 边界与错误处理

- **损坏持久化**:normalize 兜底跳过无效项,不崩溃。
- **数量/长度上限**:创建/编辑时校验,满 200 条时「保存」禁用 + tooltip;content 超长截断拒绝并 toast。
- **片段含通配**:原样插入;提交时 promptExpand 正常展开(>20 既有二次确认兜底)。零新逻辑。
- **删除确认**:走既有 ConfirmDialog(tone: danger);删除不影响已生成 task(snippet 与 task 零关联)。
- **popover 与 textarea 焦点**:插入后 rAF 恢复焦点与光标;popover 打开不清空 selection(浏览器保留失焦 textarea 的 selectionStart)。
- **移动端**:pill 行已 flex-wrap,新 pill 自然换行;popover absolute bottom-full 与现有一致。

## 6. 测试计划

- `promptSnippets.test.ts`(纯函数):normalize(无效项/缺字段/sortOrder 重排/非数组入参)、merge(id 冲突保本地/截断)、insertAtCursor(中间/头尾/全选替换/selStart>selEnd 交换/越界钳制/空文本)。
- store 单测(`store.test.ts` 追加):create/update/delete/move + 满额拒绝 + persist partialize 含 snippets。
- exportImport 单测追加:导出含 snippets;合并/替换导入;旧备份(无 snippets 字段)导入不报错。
- 端到端(Playwright):输入文字 → 片段 pill →「保存当前输入」→ 清空 → 搜索并点击片段 → 文本回到光标处 → 含通配片段提交展开多卡片。
- `tsc` / `eslint` / `vitest` 全绿。

## 7. 非目标(本期)

- 不做变量/占位符表单(`{{subject}}` 之类模板引擎)——通配组已覆盖"多值实验"场景。
- 不做片段分类/标签/文件夹(扁平列表 + fuzzy 搜索,200 条内够用)。
- 不做 `/` inline 触发(v2 评估)。
- 不做使用频次统计/最近使用排序。
- 不改风格预设机制(snippet 是纯文本插入,不做"第二风格层"注入 API prompt)。
- 不做 snippet 与 task 的关联追踪(用了哪个片段不记录)。
- 不做云同步(本地优先原则)。

## 8. 落地顺序

1. `types` + `lib/promptSnippets.ts` 纯函数 + 测试(零风险先行)。
2. store slice(snippets + 5 个 action)+ persist/merge + store 测试。
3. `SnippetPopover.tsx` + PillRow「片段」pill + 插入接线。
4. `exportImport` 集成 + 测试。
5. (可选)命令面板「插入片段」组。
6. Playwright 端到端 + 全量回归。
