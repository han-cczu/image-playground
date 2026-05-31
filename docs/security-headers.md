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
default-src 'self'; script-src 'self' 'sha256-ceZQVieuEu3wrVZesSAxmbWRpR45TuEEt523Sm1QRJs='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; worker-src 'self'; manifest-src 'self'
```

### 关键设计(经核实的必要妥协,非疏漏)

- **`connect-src 'self' https:`**:API baseUrl 用户完全可配(`apiProfiles.ts`),且 `imageApiShared.ts` 的 `fetchImageUrlAsDataUrl` 会拉取任意远程图片 URL。CSP 只能做框架级收紧,**绝不能做 host 白名单**,否则直接打断生图。
- **`img-src ... data: blob: https:`**:Lightbox / TaskCard 用 `data:` / `blob:` 显示图片。
- **`style-src 'self' 'unsafe-inline'`**:dnd-kit 拖拽用内联 `transform` style,Tailwind 注入样式,需要 `unsafe-inline`。
- **`script-src 'self' 'sha256-...'`**:纯静态 SPA 无 nonce 注入能力;`index.html` 有一段稳定的内联主题引导脚本,用其 SHA-256 hash 放行,而非 `'unsafe-inline'`。

### ⚠️ 内联脚本 hash 维护与上线流程

上方 `sha256-` 是对 **`index.html`** 内联 `<script>` 文本(**LF**,由 `.gitattributes` 的 `index.html text eol=lf` 固定)算出的。

> **为何必须固定 LF**:hash 对换行符敏感。Windows(`core.autocrlf=true`)工作树是 CRLF、Linux/Docker/CI 检出是 LF,二者算出的 hash 不同。`.gitattributes` 把 `index.html` 锁为 LF 后,所有平台构建产物字节一致,hash 唯一。改动该脚本后请用下方命令重算并同步四处配置(`nginx-security-headers.inc` / `Caddyfile` / `Caddyfile.lan` / `public/_headers`)。

**构建守卫(已自动化)**:`npm run build` 末尾会跑 `scripts/verify-csp-hash.mjs`,从 `dist/index.html` 重算内联脚本 hash 并与四处配置比对,**不一致即 `exit 1`**——把「强制 CSP 后白屏」从运行期事故前移为构建期硬失败。Vite 逐字透传换行符不归一化,故 LF 源 → LF 产物。

手动重算命令(应得 `sha256-ceZQVieuEu3wrVZesSAxmbWRpR45TuEEt523Sm1QRJs=`):
```bash
node -e 'const fs=require("fs"),c=require("crypto");const h=fs.readFileSync("dist/index.html","utf8").replace(/\r\n/g,"\n");const a=h.indexOf("<script>"),g=h.indexOf(">",a),z=h.indexOf("</script>",g);console.log("sha256-"+c.createHash("sha256").update(h.slice(g+1,z),"utf8").digest("base64"))'
```

上线流程:

1. `npm run build`(守卫通过即代表四处配置 hash 与产物一致)。
2. 部署后用 Report-Only 观察浏览器控制台无 CSP 违规(真实跑一遍 生图 + 反推 + 远程图 URL 导入)。
3. 确认无违规后,把四处的 `Content-Security-Policy-Report-Only` 改为 `Content-Security-Policy`(强制)。

> 改动 `index.html` 内联脚本后,构建守卫会强制你同步四处 hash,否则 build 失败——无需再靠人工记得。
