import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Brak elementu #root')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Installing the editor is what gets it onto a tablet's home screen, running
// full-screen without browser chrome. Service workers need a secure context,
// which localhost counts as - a plain-IP LAN address does not.
// Only in a built app: in development the worker would serve stale modules
// back over Vite's own hot reload.
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // No service worker simply means no offline shell and no install prompt.
    })
  })
}
