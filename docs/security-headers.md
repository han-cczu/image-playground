# 安全响应头基线(单一真源)

> 三处部署配置 **逐字复用同一策略**,避免漂移:
> - `nginx-security-headers.inc`(Docker / nginx 自托管,经 `Dockerfile` COPY,在 `nginx.conf` 各 location include)
> - `Caddyfile` / `Caddyfile.lan`(Caddy 反代)
> - `public/_headers`(Cloudflare Workers 静态资产,Vite 原样拷到 `dist/_headers`)

## 强制下发(安全、无破坏风险)

```
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: SAMEORIGIN
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cross-Origin-Opener-Policy: same-origin
```

## Content-Security-Policy(先 Report-Only,验证后再强制)

当前以 **`Content-Security-Policy-Report-Only`** 形式下发,只上报不拦截,确保不破坏线上功能。策略字符串:

```
default-src 'self'; script-src 'self' 'sha256-3RSlfpoi9mvBe/mSqzp5IGBDwU6ltj+1Eozow0zhThg='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; worker-src 'self'; manifest-src 'self'
```

### 关键设计(经核实的必要妥协,非疏漏)

- **`connect-src 'self' https:`**:API baseUrl 用户完全可配(`apiProfiles.ts`),且 `imageApiShared.ts` 的 `fetchImageUrlAsDataUrl` 会拉取任意远程图片 URL。CSP 只能做框架级收紧,**绝不能做 host 白名单**,否则直接打断生图。
- **`img-src ... data: blob: https:`**:Lightbox / TaskCard 用 `data:` / `blob:` 显示图片。
- **`style-src 'self' 'unsafe-inline'`**:dnd-kit 拖拽用内联 `transform` style,Tailwind 注入样式,需要 `unsafe-inline`。
- **`script-src 'self' 'sha256-...'`**:纯静态 SPA 无 nonce 注入能力;`index.html` 有一段稳定的内联主题引导脚本,用其 SHA-256 hash 放行,而非 `'unsafe-inline'`。

### ⚠️ 内联脚本 hash 维护与上线流程

上方 `sha256-` 是对 **源码 `index.html`** 内联 `<script>` 文本(CRLF)算出的。**Vite 构建可能改写 `index.html`(行尾/缩进),hash 可能漂移**。上线前务必:

1. `npm run build`
2. 从 `dist/index.html` 提取内联 `<script>` 的精确文本,重算 hash:
   ```bash
   node -e 'const fs=require("fs"),c=require("crypto");const h=fs.readFileSync("dist/index.html","utf8");const a=h.indexOf("<script>"),g=h.indexOf(">",a),z=h.indexOf("</script>",g);console.log("sha256-"+c.createHash("sha256").update(h.slice(g+1,z),"utf8").digest("base64"))'
   ```
3. 若与上方不一致,更新三处配置里的 hash。
4. 部署后用 Report-Only 观察浏览器控制台无 CSP 违规(真实跑一遍 生图 + 反推 + 远程图 URL 导入)。
5. 确认无违规后,把三处的 `Content-Security-Policy-Report-Only` 改为 `Content-Security-Policy`(强制)。

> 任何人改动 `index.html` 内联脚本后都必须重复 1-3 步,否则强制 CSP 下主题引导脚本会被拦截(首屏闪烁 / dark 失效)。
