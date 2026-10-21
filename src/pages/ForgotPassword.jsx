import { useState } from 'react'
import { supabase } from '../lib/supabase'
import logo from '../assets/logoblu2.svg'

export default function ForgotPassword({ onBack }) {
  const [email,   setEmail]   = useState('')
  const [status,  setStatus]  = useState('idle') // idle | sending | sent | error
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim()) return

    setStatus('sending')
    setErrorMsg('')

    // Verifica che la mail corrisponda a un profilo registrato
    const { data: exists, error: checkErr } = await supabase
      .rpc('check_email_exists', { p_email: email.trim() })

    if (checkErr) {
      setErrorMsg('Errore di connessione. Riprova tra qualche secondo.')
      setStatus('error')
      return
    }
    if (!exists) {
      setErrorMsg('Nessun account trovato con questa email.')
      setStatus('error')
      return
    }

    const redirectTo = window.location.origin + '/update-password'
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })

    if (error) {
      setErrorMsg('Impossibile inviare l\'email. Controlla la connessione e riprova.')
      setStatus('error')
      return
    }

    setStatus('sent')
  }

  return (
    <div className="min-h-screen flex flex-col justify-center px-6 bg-[#f8f9fa]">

      <div className="mb-10 text-center">
        <img src={logo} alt="Turno" className="h-20 w-auto mx-auto mb-2" />
        <p className="text-[#718096] mt-1 text-sm">Gestione operativa strutture</p>
      </div>

      <div className="w-full max-w-sm mx-auto bg-white rounded-2xl shadow-sm border border-[#e2e8f0] p-8">

        {status === 'sent' ? (
          /* ── Stato: email inviata ── */
          <div className="flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-green-50 border border-green-200
                            flex items-center justify-center text-3xl">
              📬
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#1a202c]">Controlla la tua email</h2>
              <p className="text-sm text-[#718096] mt-2 leading-relaxed">
                Se l'indirizzo <span className="font-semibold text-[#1a202c]">{email}</span> è
                registrato, riceverai un link per reimpostare la password.
              </p>
              <p className="text-xs text-[#a0aec0] mt-3">
                Non trovi l'email? Controlla anche la cartella spam.
              </p>
            </div>
            <button
              type="button"
              onClick={onBack}
              className="w-full h-11 rounded-xl border border-[#e2e8f0] text-sm font-semibold
                         text-[#718096] active:bg-[#f0f4f8] transition-colors mt-2"
            >
              Torna al login
            </button>
          </div>
        ) : (
          /* ── Form ── */
          <>
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 text-sm text-[#718096] mb-5
                         active:text-[#1e3a5f] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Torna al login
            </button>

            <h2 className="text-xl font-semibold text-[#1a202c] mb-2">Password dimenticata</h2>
            <p className="text-sm text-[#718096] mb-6 leading-relaxed">
              Inserisci la tua email. Ti invieremo un link per reimpostare la password.
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="email" className="text-sm font-medium text-[#1a202c]">
                  Email
                </label>
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

              {status === 'error' && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {errorMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={status === 'sending'}
                className="w-full h-12 rounded-xl bg-[#1e3a5f] text-white font-semibold text-base
                           active:bg-[#152b47] disabled:opacity-60 disabled:cursor-not-allowed
                           transition-colors"
              >
                {status === 'sending' ? 'Invio in corso…' : 'Invia link di ripristino'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
