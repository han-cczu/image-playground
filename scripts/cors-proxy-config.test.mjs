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

  it('rate-limits proxied upstream requests by client address', () => {
    const config = readCorsProxyConfig()

    expect(config).toMatch(/limit_req_zone\s+\$binary_remote_addr\s+zone=cors_proxy_per_ip:/)
    expect(config).toMatch(/limit_req\s+zone=cors_proxy_per_ip\s+burst=\d+\s+nodelay;/)
  })
})
