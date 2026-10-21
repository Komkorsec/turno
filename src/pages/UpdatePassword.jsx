import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import logo from '../assets/logoblu2.svg'

export default function UpdatePassword({ onDone }) {
  // 'loading' → aspetta che Supabase processi il token dal hash
  // 'ready'   → form attivo
  // 'invalid' → nessun token valido trovato
  // 'success' → password aggiornata
  const [pageState, setPageState] = useState('loading')
  const [slowLoad,  setSlowLoad]  = useState(false)

  const [pwd,     setPwd]     = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [errorMsg,setErrorMsg]= useState('')

  useEffect(() => {
    // Supabase JS v2 processa automaticamente l'hash dell'URL
    // e invia l'evento PASSWORD_RECOVERY via onAuthStateChange
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPageState('ready')
      }
      // Se l'utente arriva già con una sessione valida (es. tab già aperta)
      if (event === 'SIGNED_IN' && session) {
        setPageState('ready')
      }
    })

    // Fallback: controlla se esiste già una sessione attiva
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setPageState('ready')
    })

    // A 5s avvisa che sta impiegando più del solito (connessione lenta)
    const slowTimeout = setTimeout(() => {
      setSlowLoad(prev => prev || true)
    }, 5000)

    // A 12s dichiara il link invalido/scaduto
    const timeout = setTimeout(() => {
      setPageState(prev => prev === 'loading' ? 'invalid' : prev)
    }, 12000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(slowTimeout)
      clearTimeout(timeout)
    }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setErrorMsg('')

    if (pwd.length < 8) {
      setErrorMsg('La password deve contenere almeno 8 caratteri.')
      return
    }
    if (pwd !== confirm) {
      setErrorMsg('Le due password non coincidono.')
      return
    }

    setSaving(true)

    const { error } = await supabase.auth.updateUser({ password: pwd })

    if (error) {
      // Messaggi d'errore localizzati
      if (error.message.toLowerCase().includes('same password')) {
        setErrorMsg('La nuova password deve essere diversa da quella attuale.')
      } else if (error.message.toLowerCase().includes('weak')) {
        setErrorMsg('Password troppo debole. Usa almeno 8 caratteri con lettere e numeri.')
      } else {
        setErrorMsg('Errore durante l\'aggiornamento. Il link potrebbe essere scaduto.')
      }
      setSaving(false)
      return
    }

    setPageState('success')
    // Disconnette la sessione di recovery e torna al login dopo 2s
    setTimeout(async () => {
      await supabase.auth.signOut()
      onDone()
    }, 2000)
  }

  const inputCls = `w-full h-12 pl-4 pr-12 rounded-xl border border-[#e2e8f0] text-[#1a202c] text-base
    bg-white outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
    transition-colors placeholder:text-[#a0aec0]`

  return (
    <div className="min-h-screen flex flex-col justify-center px-6 bg-[#f8f9fa]">

      <div className="mb-10 text-center">
        <img src={logo} alt="Turno" className="h-20 w-auto mx-auto mb-2" />
        <p className="text-[#718096] mt-1 text-sm">Gestione operativa strutture</p>
      </div>

      <div className="w-full max-w-sm mx-auto bg-white rounded-2xl shadow-sm border border-[#e2e8f0] p-8">

        {/* ── Caricamento ── */}
        {pageState === 'loading' && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="w-8 h-8 rounded-full border-2 border-[#1e3a5f] border-t-transparent animate-spin" />
            <p className="text-sm text-[#718096]">Verifica del link in corso…</p>
            {slowLoad && (
              <p className="text-xs text-[#a0aec0] text-center leading-relaxed">
                Connessione lenta — attendi ancora qualche secondo…
              </p>
            )}
          </div>
        )}

        {/* ── Link invalido / scaduto ── */}
        {pageState === 'invalid' && (
          <div className="flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-red-50 border border-red-200
                            flex items-center justify-center text-3xl">
              🔗
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#1a202c]">Link non valido</h2>
              <p className="text-sm text-[#718096] mt-2 leading-relaxed">
                Il link di ripristino è scaduto o non è valido.
                Richiedi un nuovo link dalla pagina di login.
              </p>
            </div>
            <button
              type="button"
              onClick={onDone}
              className="w-full h-11 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                         active:bg-[#152b47] transition-colors"
            >
              Torna al login
            </button>
          </div>
        )}

        {/* ── Form nuova password ── */}
        {pageState === 'ready' && (
          <>
            <h2 className="text-xl font-semibold text-[#1a202c] mb-2">Nuova password</h2>
            <p className="text-sm text-[#718096] mb-6 leading-relaxed">
              Scegli una password sicura di almeno 8 caratteri.
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-5">

              {/* Nuova password */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="pwd" className="text-sm font-medium text-[#1a202c]">
                  Nuova password
                </label>
                <div className="relative">
                  <input
                    id="pwd"
                    type={showPwd ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    value={pwd}
                    onChange={e => setPwd(e.target.value)}
                    placeholder="Minimo 8 caratteri"
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a0aec0]
                               hover:text-[#718096] transition-colors p-1"
                    aria-label={showPwd ? 'Nascondi password' : 'Mostra password'}
                  >
                    {showPwd ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
                {/* Indicatore forza password */}
                {pwd.length > 0 && (
                  <div className="flex gap-1 mt-0.5">
                    {[...Array(3)].map((_, i) => (
                      <div
                        key={i}
                        className={`flex-1 h-1 rounded-full transition-colors
                          ${pwd.length >= 12 ? 'bg-green-500'
                            : pwd.length >= 8  ? (i < 2 ? 'bg-amber-400' : 'bg-[#e2e8f0]')
                            : (i < 1 ? 'bg-red-400' : 'bg-[#e2e8f0]')}`}
                      />
                    ))}
                    <span className="text-[10px] text-[#a0aec0] ml-1 shrink-0">
                      {pwd.length >= 12 ? 'Sicura' : pwd.length >= 8 ? 'Buona' : 'Troppo corta'}
                    </span>
                  </div>
                )}
              </div>

              {/* Conferma password */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="confirm" className="text-sm font-medium text-[#1a202c]">
                  Conferma password
                </label>
                <input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Ripeti la password"
                  className={inputCls}
                />
                {confirm.length > 0 && pwd !== confirm && (
                  <p className="text-xs text-red-500 mt-0.5">Le password non coincidono</p>
                )}
                {confirm.length > 0 && pwd === confirm && pwd.length >= 8 && (
                  <p className="text-xs text-green-600 mt-0.5">✓ Le password coincidono</p>
                )}
              </div>

              {errorMsg && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {errorMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={saving}
                className="w-full h-12 rounded-xl bg-[#1e3a5f] text-white font-semibold text-base
                           active:bg-[#152b47] disabled:opacity-60 disabled:cursor-not-allowed
                           transition-colors mt-1"
              >
                {saving ? 'Salvataggio…' : 'Salva nuova password'}
              </button>
            </form>
          </>
        )}

        {/* ── Successo ── */}
        {pageState === 'success' && (
          <div className="flex flex-col items-center text-center gap-4 py-2">
            <div className="w-16 h-16 rounded-2xl bg-green-50 border border-green-200
                            flex items-center justify-center text-3xl">
              ✅
            </div>
            <div>
              <h2 className="text-lg font-bold text-green-800">Password aggiornata!</h2>
              <p className="text-sm text-[#718096] mt-2 leading-relaxed">
                La tua password è stata cambiata con successo.
                Verrai reindirizzato al login tra un momento…
              </p>
            </div>
            <div className="w-6 h-6 rounded-full border-2 border-green-400 border-t-transparent animate-spin" />
          </div>
        )}

      </div>
    </div>
  )
}
