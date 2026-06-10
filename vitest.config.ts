import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

/**
 * 测试运行器独立配置:此前 vitest 直接消费带 cloudflare() 插件的 vite.config.ts,
 * 测试与部署插件的依赖版本互锁(ws 被迫走 package.json overrides 的 exact-pin 即由此而来),
 * 任一侧安全升级都被另一侧扯住。测试不需要 workers 运行时,只保留 react 插件。
 * define 与主配置对齐:__DEV_PROXY_CONFIG__ 固定 null(测试不读 dev-proxy.config.json,
 * 保证本地有该文件时测试行为与 CI 一致)。
 */
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __DEV_PROXY_CONFIG__: JSON.stringify(null),
  },
})
