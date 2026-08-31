import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { normalizeDevProxyConfig } from './src/lib/api/devProxy'

import { cloudflare } from '@cloudflare/vite-plugin'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

function loadDevProxyConfig() {
  try {
    return normalizeDevProxyConfig(
      JSON.parse(readFileSync('./dev-proxy.config.json', 'utf-8')) as unknown,
    )
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw error
  }
}

export default defineConfig(({ command }) => {
  const devProxyConfig = command === 'serve' ? loadDevProxyConfig() : null

  return {
    plugins: [react(), cloudflare()],
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __DEV_PROXY_CONFIG__: JSON.stringify(devProxyConfig),
    },
    server: {
      host: true,
      proxy: devProxyConfig?.enabled
        ? {
            [devProxyConfig.prefix]: {
              target: devProxyConfig.target,
              changeOrigin: devProxyConfig.changeOrigin,
              secure: devProxyConfig.secure,
              rewrite: (path) =>
                path.replace(
                  new RegExp(`^${devProxyConfig.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
                  '',
                ),
            },
          }
        : undefined,
    },
    build: {
      rollupOptions: {
        output: {
          // 目录组件(SettingsModal/index.tsx 等)懒加载后 facade 名是 index,产物会出现多个
          // 无语义的 index-<hash>.js;取上级目录名命名,便于在 dist/网络面板里对号入座。
          // 入口 chunk 走 entryFileNames,不受影响。
          chunkFileNames(chunkInfo) {
            const facade = chunkInfo.facadeModuleId?.replace(/\\/g, '/')
            if (facade && /\/index\.[jt]sx?$/.test(facade)) {
              const dir = facade.split('/').slice(-2, -1)[0]
              if (dir && dir !== 'src') return `assets/${dir}-[hash].js`
            }
            return 'assets/[name]-[hash].js'
          },
          manualChunks(id) {
            const normalized = id.replace(/\\/g, '/')
            if (!normalized.includes('/node_modules/')) return
            if (normalized.includes('/react/') || normalized.includes('/react-dom/'))
              return 'vendor-react'
            if (normalized.includes('/@dnd-kit/')) return 'vendor-dnd'
            if (normalized.includes('/fflate/')) return 'vendor-fflate'
            if (normalized.includes('/zustand/')) return 'vendor-state'
            return 'vendor'
          },
        },
      },
    },
  }
})
