import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import * as Sentry from '@sentry/react'

const WA_NUMBER = '393455936841'

function buildWaLink(message, context) {
  const now = new Date()
  const time = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  const date = now.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const text = [
    '🔴 Errore in Turno',
    `📍 Sezione: ${context || window.location.pathname || 'sconosciuta'}`,
    `❌ Errore: ${message}`,
    `🕐 ${time} del ${date}`,
  ].join('\n')
  return `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`
}

const ErrorContext = createContext(null)

export function ErrorProvider({ children }) {
  const [toast, setToast] = useState(null) // { message, context }
  const timerRef = useRef(null)

  const reportError = useCallback((message, context) => {
    clearTimeout(timerRef.current)
    setToast({ message: String(message), context: context || '' })
    timerRef.current = setTimeout(() => setToast(null), 10000)
    Sentry.captureMessage(String(message), { level: 'error', extra: { context } })
  }, [])

  const dismiss = useCallback(() => {
    clearTimeout(timerRef.current)
    setToast(null)
  }, [])

  // Cattura errori JS globali non gestiti
  useEffect(() => {
    function onError(event) {
      reportError(event.message || 'Errore JavaScript imprevisto', 'globale')
    }
    function onUnhandledRejection(event) {
      const msg = event.reason?.message || String(event.reason) || 'Promise rifiutata'
      reportError(msg, 'operazione asincrona')
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [reportError])

  return (
    <ErrorContext.Provider value={{ reportError }}>
      {children}
      {toast && (
        <div className="fixed bottom-6 left-4 right-4 z-[9999] flex justify-center pointer-events-none">
          <div className="w-full max-w-sm bg-[#1a202c] rounded-2xl shadow-2xl px-4 py-3.5
                          flex flex-col gap-3 pointer-events-auto
                          animate-[slideUp_0.25s_ease-out]">
            <div className="flex items-start gap-3">
              <span className="text-lg shrink-0 mt-0.5">⚠️</span>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-semibold leading-tight">
                  Qualcosa è andato storto
                </p>
                <p className="text-white/60 text-xs mt-1 leading-relaxed line-clamp-2">
                  {toast.message}
                </p>
              </div>
              <button type="button" onClick={dismiss}
                className="text-white/40 text-lg leading-none shrink-0 -mt-0.5 hover:text-white/70">
                ×
              </button>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={dismiss}
                className="flex-1 h-9 rounded-xl bg-white/10 text-white/70 text-xs font-semibold
                           active:bg-white/20 transition-colors">
                Chiudi
              </button>
              <a href={buildWaLink(toast.message, toast.context)}
                target="_blank" rel="noreferrer"
                className="flex-1 h-9 rounded-xl bg-[#25D366] text-white text-xs font-bold
                           flex items-center justify-center gap-1.5 active:bg-[#1ebe5d] transition-colors">
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                Segnala su WhatsApp
              </a>
            </div>
          </div>
        </div>
      )}
    </ErrorContext.Provider>
  )
}

export function useError() {
  return useContext(ErrorContext)
}
