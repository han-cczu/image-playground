import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { installMobileViewportGuards } from './lib/image/viewport'

installMobileViewportGuards()

// Secure context（HTTPS / localhost）才允许注册 Service Worker。
// HTTP + IP 部署模式下浏览器会 reject 注册 Promise；
// 此处提前 skip，避免 console 红错，并让 InsecureContextBanner 接管用户提示。
if ('serviceWorker' in navigator && window.isSecureContext) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
        console.error('Service worker registration failed:', error)
      })
    })
  } else {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister())
    })
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
