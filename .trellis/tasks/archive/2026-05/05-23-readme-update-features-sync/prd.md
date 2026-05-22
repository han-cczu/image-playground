# README 同步：补齐近期功能 + 修错误指引

## Goal

README.md 已经落后于最近 1-2 周（约 17 个 session）累积的功能改动：
1. 8 项新功能完全没写（Conversation 对话组织、图库视图、风格预设、底栏一键清空、SW 加固、ErrorBoundary、模型 pill 两段式、分类色板）
2. 2 处明确错误指引（"右上角 ⚙️ 设置"和"Header 一键切换主题"——这些 UI 在 Header 重构后已经迁移到 sidebar 底部）
3. 1 处行为遗漏（图库视图下禁用拖拽这条没提）

让 README 重新可信任，避免新用户照着文档找不到设置入口。

## What I already know

### README 现状（共 280 行）

- 顶部 3 段：标题、一句话介绍、在线访问 + Docker 链接 —— **基本准确**
- L11-43 ✨ 核心特性 4 个子段 —— **过期最严重**（缺新功能 + 1 处错误指引）
- L46-79 🚀 本地开发与构建 —— **准确**
- L82-111 🛠️ API 配置与 URL 传参 —— **L85 一处错误**（设置入口位置）
- L115-122 💻 技术栈 —— **准确**
- L126-279 🐳 Docker 部署 —— **完整 + 准确**（最近一次更新就是这段）

### 缺失功能清单（按近期 commit 倒序）

| 功能 | session / commit | 在 README 里要放哪段 |
|---|---|---|
| **图库视图** | session 17（`6425e2c`） | ✨ 核心特性 → "🗂️ 历史与画廊" |
| **分类色板** | `8631b9a` | ✨ 核心特性 → "🗂️ 历史与画廊" |
| **InputBar 模型 pill 两段式** | `db7edc7` | ✨ 核心特性 → "⚙️ 参数与配置" |
| **底栏一键清空** | session 12（`0e354fd`） | ✨ 核心特性 → "🎨 图像生成与编辑" |
| **Sidebar Logo hover 折叠展开** | session 16 | ✨ 核心特性 → 新增 "🧭 导航与组织" 子段 |
| **风格预设** | session 10（`94c3659`） | ✨ 核心特性 → "🎨 图像生成与编辑" |
| **区域级 Error Boundary** | session 8（`9361f0d`） | ✨ 核心特性 → 新增 "🛡️ 稳定性" 子段（或并入隐私段） |
| **Service Worker kill-switch + 版本化** | session 5（`8b8de26`） | Docker 段已部分提，**也该在产品特性写一句** |
| **Conversation 对话组织 + sidebar** | session 6（`eea442a` `e6a2584`） | ✨ 核心特性 → 新增 "🧭 导航与组织" 子段（与上面 sidebar 合并） |
| **SettingsModal 视觉刷新** | session 7（`74248ea`） | **不写**（视觉刷新对用户无新功能感知） |

### 必须修复的 2 处错误指引

- `L31`："**Header** 一键切换 浅色 / 深色 / 跟随系统" —— Header 现在只剩主题切换是对的，但顺序上要先说 sidebar 底部入口（设置/导出等），再说 Header 主题切换
- `L85`："点击右上角 **⚙️ 设置**" —— **明确错误**，必须改为"点击 **sidebar 底部 ⚙️ 设置**"

### 必须补充的 1 处行为说明

- `L20-23` 历史与画廊段里"拖拽排序"未提**图库视图下禁用拖拽**——可以在图库视图描述里直接说"不可拖拽"，或在拖拽描述里加一行限定

## Assumptions (temporary)

- A1 README 仍保持中文 + 现有结构（不重写排版 / 不加 i18n / 不加截图）
- A2 不动 Docker 部署段（最近一次更新已完整准确）
- A3 不动技术栈段（React/Vite/Tailwind/Zustand 等核心未变）
- A4 不动本地开发与构建段（npm scripts 未变）
- A5 改动仅集中在"✨ 核心特性"段（4 个子段需要重组）+ L85 设置入口指引

## Open Questions

- ~~重组策略~~ → **已锁定：A. 仅在现有子段追加 bullet 点**
- ~~What's New 段~~ → **已锁定：不加**

## Requirements

- R1 修 L85 错误指引（"右上角设置" → "sidebar 底部设置"）
- R2 修 L31 顺序（Header 主题切换 vs sidebar 底部设置入口）
- R3 补 8 项新功能：每项 1-2 句中文，按下表归位

  | 功能 | 落到子段 |
  |---|---|
  | Conversation 对话组织 + sidebar | 🎨 图像生成与编辑（开头补"对话作为创作组织单位"一句） |
  | 图库视图 | 🗂️ 历史与画廊（追加 bullet：跨对话聚合、对话标签、禁用拖拽） |
  | 风格预设（9 选 1） | 🎨 图像生成与编辑（追加 bullet） |
  | 底栏一键清空（X + 重置 pill） | 🎨 图像生成与编辑（追加 bullet） |
  | 分类色板（8 色预设） | 🗂️ 历史与画廊（在收藏/分类相关 bullet 旁补一句） |
  | InputBar 模型 pill 两段式 | ⚙️ 参数与配置（在 profile 描述旁补） |
  | Sidebar Logo hover 折叠展开 | 🎨 图像生成与编辑或在新增导航说明里点一下 |
  | 区域级 Error Boundary + SW kill-switch + 版本化 CACHE_NAME | 🔒 隐私与本地优先（追加 1 句"稳定性"） |

- R4 补"图库视图下禁用拖拽"行为说明（在 L20 拖拽排序 bullet 末加一句"图库视图下不可拖拽，保护各对话内部顺序"）
- R5 不动 Docker / 技术栈 / 本地开发 / 顶部 3 段 / URL 传参表格（除 L85 那一句）

## Decision (ADR-lite)

**Context**: README 已落后 8 项功能 + 含 2 处错误指引，新用户照文档找不到设置入口；但完全重写排版会过度工程。

**Decision**: 走"档 A"——保持 README 现有骨架（顶部介绍 + ✨ 核心特性 5 子段 + 技术栈 + Docker 部署），仅做最小侵入式追加 bullet 点 + 改 2 处错误指引 + 补 1 处行为说明。不加 What's New、不加截图、不加 i18n。

**Consequences**:
- ✅ 改动 < 50 行、可单 commit 落地，git diff 干净
- ✅ 不打破现有读者的阅读习惯（"老用户回来还是熟悉的结构"）
- ⚠️ "🧭 导航与组织"等更现代的分类目前不存在；如未来再加 sidebar 内功能可能 bullet 越积越长，到时再拆段

## Acceptance Criteria (evolving)

- [ ] AC1 README 中再无"右上角设置"的过期指引
- [ ] AC2 8 项新功能各有至少 1 句中文说明
- [ ] AC3 改完后 markdown 渲染无破窗（标题层级 / 列表对齐 / 代码块闭合 OK）
- [ ] AC4 文档语气与现有部分一致（不出现 "yo" "Awesome" 等风格突兀的词）
- [ ] AC5 没引入与代码不符的描述（每一句新加的话能对应到代码中的实际实现）

## Definition of Done

- README 改完 grep 验证 2 处错误指引消失
- 阅读一遍渲染后的 README（GitHub-flavored md）无视觉破窗
- 没引入新依赖、不需要测试代码
- 不需要更新 spec 文件（这是文档而非 contract 沉淀）

## Out of Scope (explicit)

- ❌ 不加截图 / GIF（README 当前没图，本任务保持纯文字）
- ❌ 不加英文版（保持中文，符合项目语言约定）
- ❌ 不加 CHANGELOG.md（commit log 就是事实来源）
- ❌ 不动 Docker / 技术栈 / 本地开发 / URL 传参表
- ❌ 不动 in-app feature 行为（这是 README-only 任务）
- ❌ 不动除 README.md 外的任何文件

## Technical Notes

### 关键文件

- `README.md` —— 唯一改动对象
- 参考代码（不需要改）：
  - `src/components/Sidebar/index.tsx` —— 图库按钮 + 设置入口
  - `src/components/Header.tsx` —— Header 现在只剩主题
  - `src/components/InputBar/index.tsx` —— 风格 pill / 清空按钮 / 重置按钮 / 模型 pill 两段式
  - `src/lib/stylePresets.ts` —— 8 风格定义（写实摄影/胶片/人像/古典油画/文艺水彩/工业设计图/建筑渲染/产品摄影）
  - `src/components/ErrorBoundary.tsx` —— 区域级 boundary
  - `public/sw.js` + `scripts/inject-sw-build-id.mjs` —— SW kill-switch + CACHE_NAME 版本化

### 风险

- README 是 GitHub 仓库首页门面，错字 / 渲染问题 / 风格突兀会影响项目形象
- 写得太长用户读不完，要克制字数（每个新功能 1-2 句即可，长篇大论丢到 in-app feature 里）

## Research References

（README 是文档型改动，无需 trellis-research 调研）
