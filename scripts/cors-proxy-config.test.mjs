import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

function readCorsProxyConfig() {
  return readFileSync(resolve(root, 'cors-proxy.conf'), 'utf-8')
}

function extractCorsDenyMap(config) {
  const match = config.match(/map\s+\$cors_allow_origin\s+\$cors_deny\s*\{(?<body>[^}]*)\}/s)
  if (!match?.groups?.body) throw new Error('cors_deny map not found')
  return match.groups.body
}

describe('cors-proxy security invariants', () => {
  it('denies requests whose Origin is absent or not in the allowlist', () => {
    const corsDenyMap = extractCorsDenyMap(readCorsProxyConfig())

    expect(corsDenyMap).toMatch(/default\s+0;/)
    expect(corsDenyMap).toMatch(/""\s+1;/)
  })

  it('预检与实际响应两处 Allow-Headers 都放行应用实际发送的请求头(含 Cache-Control / Pragma)', () => {
    // 应用侧 openaiCompatibleImageApi / geminiImageApi / listModels 的请求都带 Cache-Control(部分带 Pragma),
    // 这两个不是 CORS 安全头,预检白名单漏掉任一,经自建代理的所有 API 请求都会在预检阶段被浏览器拒绝。
    // nginx 的 if 块 add_header 不继承外层,预检分支与实际响应必须各写一遍,故断言恰好两处且逐一检查。
    const config = readCorsProxyConfig()
    const lines = config.match(/add_header\s+Access-Control-Allow-Headers\s+"[^"]*"/g) ?? []

    expect(lines).toHaveLength(2)
    for (const line of lines) {
      const allowed = (line.match(/"([^"]*)"/)?.[1] ?? '')
        .split(',')
        .map((name) => name.trim().toLowerCase())
      for (const required of ['authorization', 'content-type', 'x-goog-api-key', 'cache-control', 'pragma']) {
        expect(allowed).toContain(required)
      }
    }
  })

  it('rate-limits proxied upstream requests by client address', () => {
    const config = readCorsProxyConfig()

    expect(config).toMatch(/limit_req_zone\s+\$binary_remote_addr\s+zone=cors_proxy_per_ip:/)
    expect(config).toMatch(/limit_req\s+zone=cors_proxy_per_ip\s+burst=\d+\s+nodelay;/)
    // compose 里经 Caddy 转发,须从 X-Forwarded-For 取回真实客户端 IP,否则整站共享一个限流桶
    expect(config).toMatch(/real_ip_header\s+X-Forwarded-For;/)
    expect(config).toMatch(/set_real_ip_from\s+172\.16\.0\.0\/12;/)
    expect(config).not.toMatch(/real_ip_recursive\s+on/)
  })
})
