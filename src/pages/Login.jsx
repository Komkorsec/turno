import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import logo from '../assets/logoblu2.svg'

function EyeIcon({ open }) {
  return open ? (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ) : (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  )
}

export default function Login({ onGoToRegister, onForgotPassword }) {
  const { signIn } = useAuth()
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [showPwd, setShowPwd]     = useState(false)
  const [error, setError]         = useState(null)
  const [loading, setLoading]     = useState(false)

  // ── Magic Link ────────────────────────────────────────────────────────────
  const [magicMode,    setMagicMode]    = useState(false)
  const [magicEmail,   setMagicEmail]   = useState('')
  const [magicLoading, setMagicLoading] = useState(false)
  const [magicSent,    setMagicSent]    = useState(false)
  const [magicError,   setMagicError]   = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signIn(email, password)
    } catch {
      setError('Credenziali non valide. Riprova.')
    } finally {
      setLoading(false)
    }
  }

  function openMagicMode() {
    setMagicEmail(email) // pre-compila se l'utente ha già scritto l'email sopra
    setMagicMode(true)
    setMagicSent(false)
    setMagicError('')
  }

  async function handleSendMagicLink() {
    if (!magicEmail.trim()) { setMagicError('Inserisci la tua email.'); return }
    setMagicLoading(true)
    setMagicError('')

    const { data: exists, error: checkErr } = await supabase
      .rpc('check_email_exists', { p_email: magicEmail.trim() })

    if (checkErr) {
      setMagicLoading(false)
      setMagicError('Errore di connessione. Riprova tra qualche secondo.')
      return
    }
    if (!exists) {
      setMagicLoading(false)
      setMagicError('Nessun account trovato con questa email.')
      return
    }

    const { error: err } = await supabase.auth.signInWithOtp({
      email: magicEmail.trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    setMagicLoading(false)
    if (err) {
      setMagicError('Errore nell\'invio. Riprova tra qualche secondo.')
    } else {
      setMagicSent(true)
    }
  }

  return (
    <div className="min-h-screen flex flex-col justify-center px-6 bg-[#f8f9fa]">

      <div className="mb-10 text-center">
        <img src={logo} alt="Turno" className="h-20 w-auto mx-auto mb-2" />
        <p className="text-[#718096] mt-1 text-sm">Gestione operativa strutture</p>
      </div>

      <div className="w-full max-w-sm mx-auto bg-white rounded-2xl shadow-sm border border-[#e2e8f0] p-8">
        <h2 className="text-xl font-semibold text-[#1a202c] mb-6">Accedi</h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">

          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium text-[#1a202c]">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="nome@email.com"
              className="w-full h-12 px-4 rounded-xl border border-[#e2e8f0] text-[#1a202c] text-base
                         bg-white outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                         transition-colors placeholder:text-[#a0aec0]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium text-[#1a202c]">Password</label>
            <div className="relative">
              <input
                id="password"
                type={showPwd ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full h-12 pl-4 pr-12 rounded-xl border border-[#e2e8f0] text-[#1a202c] text-base
                           bg-white outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                           transition-colors placeholder:text-[#a0aec0]"
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a0aec0] hover:text-[#718096] transition-colors p-1"
                aria-label={showPwd ? 'Nascondi password' : 'Mostra password'}
              >
                <EyeIcon open={showPwd} />
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end -mt-2">
            <button
              type="button"
              onClick={onForgotPassword}
              className="text-sm text-[#1e3a5f] font-medium active:opacity-70 transition-opacity"
            >
              Password dimenticata?
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-xl bg-[#1e3a5f] text-white font-semibold text-base
                       active:bg-[#152b47] disabled:opacity-60 disabled:cursor-not-allowed
                       transition-colors mt-1"
          >
            {loading ? 'Accesso in corso…' : 'Accedi'}
          </button>

        </form>

        {/* ── Divisore ── */}
        <div className="flex items-center gap-3 mt-6">
          <div className="flex-1 h-px bg-[#e2e8f0]" />
          <span className="text-xs text-[#a0aec0] font-medium shrink-0">oppure</span>
          <div className="flex-1 h-px bg-[#e2e8f0]" />
        </div>

        {/* ── Magic Link ── */}
        {!magicMode ? (
          <button
            type="button"
            onClick={openMagicMode}
            className="w-full h-12 mt-4 rounded-xl border-2 border-[#e2e8f0] bg-white
                       text-[#1e3a5f] font-semibold text-sm flex items-center justify-center gap-2
                       active:bg-[#f8f9fa] transition-colors"
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
            Ricevi link di accesso via email
          </button>
        ) : magicSent ? (
          <div className="mt-4 rounded-2xl bg-green-50 border border-green-200 px-5 py-5 text-center">
            <p className="text-2xl mb-2">📬</p>
            <p className="text-sm font-bold text-green-800 leading-snug">Link inviato!</p>
            <p className="text-xs text-green-700 mt-1.5 leading-relaxed">
              Ti abbiamo inviato un link speciale. Controlla la tua posta e cliccalo per entrare senza password!
            </p>
            <button
              type="button"
              onClick={() => { setMagicMode(false); setMagicSent(false) }}
              className="mt-4 text-xs text-[#718096] underline underline-offset-2"
            >
              Torna al login tradizionale
            </button>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[#1a202c]">La tua email</label>
              <input
                type="email"
                autoComplete="email"
                value={magicEmail}
                onChange={e => setMagicEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendMagicLink()}
                placeholder="nome@email.com"
                autoFocus
                className="w-full h-12 px-4 rounded-xl border border-[#e2e8f0] text-[#1a202c] text-base
                           bg-white outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                           transition-colors placeholder:text-[#a0aec0]"
              />
            </div>

            {magicError && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {magicError}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMagicMode(false)}
                className="flex-1 h-11 rounded-xl border border-[#e2e8f0] text-sm font-semibold
                           text-[#718096] active:bg-[#f0f4f8] transition-colors"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={handleSendMagicLink}
                disabled={magicLoading}
                className="flex-[2] h-11 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                           active:bg-[#152b47] disabled:opacity-60 transition-colors"
              >
                {magicLoading ? 'Invio in corso…' : 'Invia Link Magico'}
              </button>
            </div>
          </div>
        )}

        <p className="text-center text-sm text-[#718096] mt-6">
          Non hai un account?{' '}
          <button onClick={onGoToRegister} className="text-[#1e3a5f] font-semibold">
            Registrati
          </button>
        </p>
      </div>

    </div>
  )
}
