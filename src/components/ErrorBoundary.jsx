import { Component } from 'react'

const WA_NUMBER = '393455936841'

function buildWaLink(message, info) {
  const now = new Date()
  const time = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  const date = now.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const text = [
    '🔴 Crash applicazione Turno',
    `📍 Sezione: ${window.location.pathname || 'sconosciuta'}`,
    `❌ Errore: ${message}`,
    info ? `📋 Dettaglio: ${info.componentStack?.split('\n')[1]?.trim() || ''}` : '',
    `🕐 ${time} del ${date}`,
  ].filter(Boolean).join('\n')
  return `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    const msg = this.state.error?.message || String(this.state.error)
    const waLink = buildWaLink(msg, this.state.info)

    return (
      <div className="min-h-screen bg-[#f8f9fa] flex flex-col items-center justify-center px-6 text-center">
        <span className="text-5xl mb-5">⚠️</span>
        <h1 className="text-xl font-bold text-[#1a202c] mb-2">
          Qualcosa è andato storto
        </h1>
        <p className="text-sm text-[#718096] max-w-xs leading-relaxed mb-8">
          L'applicazione ha incontrato un errore imprevisto.
          Ricarica la pagina per riprendere. Se il problema persiste, segnalalo.
        </p>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full h-12 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                       active:bg-[#152b47] transition-colors">
            Ricarica l'app
          </button>
          <a
            href={waLink}
            target="_blank"
            rel="noreferrer"
            className="w-full h-12 rounded-xl bg-[#25D366] text-white font-semibold text-sm
                       flex items-center justify-center gap-2 active:bg-[#1ebe5d] transition-colors">
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            Segnala su WhatsApp
          </a>
        </div>
        {import.meta.env.DEV && (
          <details className="mt-8 text-left w-full max-w-xs">
            <summary className="text-xs text-[#a0aec0] cursor-pointer">Dettagli tecnici</summary>
            <pre className="mt-2 text-[10px] text-red-500 bg-red-50 rounded-xl p-3 overflow-auto max-h-40">
              {msg}{'\n\n'}{this.state.info?.componentStack}
            </pre>
          </details>
        )}
      </div>
    )
  }
}
