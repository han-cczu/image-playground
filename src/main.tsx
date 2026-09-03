import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { installMobileViewportGuards } from './lib/image/viewport'
import {
  createServiceWorkerUpdateScheduler,
  unregisterExistingServiceWorkers,
  watchServiceWorkerControllerChange,
} from './lib/serviceWorkerUpdate'
import { useStore } from './store'

installMobileViewportGuards()

// Secure context（HTTPS / localhost）才允许注册 Service Worker。
// HTTP + IP 部署模式下浏览器会 reject 注册 Promise；
// 此处提前 skip，避免 console 红错，并让 InsecureContextBanner 接管用户提示。
if ('serviceWorker' in navigator && window.isSecureContext) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      // 新版本静默接管后旧页面的懒加载 chunk 会 404(见 watchServiceWorkerControllerChange 注释):
      // 只提示、不自动刷新,让用户自己挑在途任务结束后的时机。须在 register 之前挂,首装判定才准确。
      watchServiceWorkerControllerChange(navigator.serviceWorker, () => {
        useStore
          .getState()
          .showToast('应用已发布新版本，请在当前任务完成后刷新页面以加载新内容', 'success')
      })
      navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`)
        .then((registration) => {
          const scheduler = createServiceWorkerUpdateScheduler(registration, {
            onError: (error) => console.error('Service worker update check failed:', error),
          })
          scheduler.check()

          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') scheduler.check()
          })
        })
        .catch((error) => {
          console.error('Service worker registration failed:', error)
        })
    })
  } else {
    void unregisterExistingServiceWorkers(navigator.serviceWorker, {
      onError: (error) => console.error('Service worker cleanup failed:', error),
    })
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
