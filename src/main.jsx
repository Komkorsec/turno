import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.jsx'

Sentry.init({
  dsn: 'https://bb2d3add212dfbf068a441b4440c4d67@o4511474233507840.ingest.de.sentry.io/4511474235736144',
  environment: import.meta.env.MODE,
  sendDefaultPii: false,
})

// ── Dimensione testo: applica classe subito (evita flash) ────────────────────
try {
  const size = localStorage.getItem('turno_font_size') ?? '0'
  if (size === '1') document.documentElement.classList.add('font-large')
  if (size === '2') document.documentElement.classList.add('font-xlarge')
} catch {}

// ── Service Worker (PWA) ──────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW non critico: l'app funziona normalmente senza di esso
    })
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
