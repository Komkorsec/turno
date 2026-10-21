import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { playAudio, isSfxEnabled, setSfxEnabled } from '../../utils/audio'

const ROLE_LABEL = {
  manager:         'Responsabile',
  operator:        'Operatore',
  admin_secondary: 'Coordinatore',
}

function EyeIcon({ open }) {
  return open ? (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ) : (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  )
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0
        ${checked ? 'bg-[#1e3a5f]' : 'bg-[#cbd5e0]'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow
                        transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}

const DEFAULT_PREFS = { expiry_docs: true, new_diaries: true, new_files: true, absence_reply: true }

export default function SettingsPage({ profile, session, signOut, onGoToAdmin, adminEmail }) {
  const role = profile?.role

  // ── Password ───────────────────────────────────────────────────────────────
  const [showPwdForm,    setShowPwdForm]    = useState(false)
  const [pwdCurrent,     setPwdCurrent]     = useState('')
  const [pwdNew,         setPwdNew]         = useState('')
  const [pwdConfirm,     setPwdConfirm]     = useState('')
  const [showCurrent,    setShowCurrent]    = useState(false)
  const [showNew,        setShowNew]        = useState(false)
  const [pwdLoading,     setPwdLoading]     = useState(false)
  const [pwdError,       setPwdError]       = useState('')
  const [pwdSaved,       setPwdSaved]       = useState(false)

  // ── Dimensione testo ─────────────────────────────────────────────────────
  const [fontSize, setFontSize] = useState(() => {
    try { return Number(localStorage.getItem('turno_font_size') ?? '0') } catch { return 0 }
  })

  function applyFontSize(val) {
    setFontSize(val)
    document.documentElement.classList.remove('font-large', 'font-xlarge')
    if (val === 1) document.documentElement.classList.add('font-large')
    if (val === 2) document.documentElement.classList.add('font-xlarge')
    try { localStorage.setItem('turno_font_size', String(val)) } catch {}
  }

  // ── Effetti sonori ────────────────────────────────────────────────────────
  const [sfxEnabled,     setSfxEnabledState] = useState(() => isSfxEnabled())

  function toggleSfx(val) {
    setSfxEnabled(val)
    setSfxEnabledState(val)
    if (val) playAudio('action')
  }

  // ── Preferenze notifiche ───────────────────────────────────────────────────
  const [prefs,          setPrefs]          = useState(DEFAULT_PREFS)
  const [loadingPrefs,   setLoadingPrefs]   = useState(true)
  const [savingPrefs,    setSavingPrefs]    = useState(false)
  const [prefsSaved,     setPrefsSaved]     = useState(false)

  useEffect(() => {
    if (!profile?.id) return
    supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', profile.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setPrefs({ expiry_docs: data.expiry_docs, new_diaries: data.new_diaries,
                             new_files: data.new_files, absence_reply: data.absence_reply })
        setLoadingPrefs(false)
      })
  }, [profile?.id])

  async function handleChangePassword() {
    if (!pwdCurrent)              { setPwdError('Inserisci la password attuale.'); return }
    if (pwdNew.length < 6)        { setPwdError('La nuova password deve avere almeno 6 caratteri.'); return }
    if (pwdNew !== pwdConfirm)    { setPwdError('Le nuove password non coincidono.'); return }

    setPwdLoading(true); setPwdError('')

    // Re-autenticazione per verificare la password attuale
    const { error: reAuthErr } = await supabase.auth.signInWithPassword({
      email: session?.user?.email,
      password: pwdCurrent,
    })
    if (reAuthErr) {
      setPwdError('Password attuale non corretta.')
      setPwdLoading(false)
      return
    }

    const { error: updateErr } = await supabase.auth.updateUser({ password: pwdNew })
    if (updateErr) {
      setPwdError('Errore nel cambio password: ' + updateErr.message)
      setPwdLoading(false)
      return
    }

    playAudio('success')
    setPwdLoading(false)
    setPwdSaved(true)
    setPwdCurrent(''); setPwdNew(''); setPwdConfirm('')
    setShowPwdForm(false)
    setTimeout(() => setPwdSaved(false), 3000)
  }

  async function savePrefs() {
    setSavingPrefs(true)
    await supabase.from('notification_preferences').upsert(
      { user_id: profile.id, ...prefs, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    playAudio('success')
    setSavingPrefs(false)
    setPrefsSaved(true)
    setTimeout(() => setPrefsSaved(false), 2500)
  }

  function togglePref(key) {
    setPrefs(p => ({ ...p, [key]: !p[key] }))
  }

  // Notifiche visibili per ruolo
  const notifItems = [
    role === 'manager' && {
      key: 'expiry_docs',
      label: 'Alert Scadenze Documenti',
      desc: 'Avviso quando un documento sta per scadere',
    },
    {
      key: 'new_diaries',
      label: 'Nuovi Diari di Bordo',
      desc: 'Notifica quando un operatore invia un nuovo report',
    },
    {
      key: 'new_files',
      label: 'Nuovi File e PEI',
      desc: 'Avviso quando viene caricato un documento per un residente',
    },
    (role === 'operator' || role === 'admin_secondary') && {
      key: 'absence_reply',
      label: 'Risposta alle Richieste Ferie',
      desc: 'Notifica quando una tua richiesta viene approvata o rifiutata',
    },
  ].filter(Boolean)

  return (
    <div className="flex flex-col gap-5 pb-12">

      {/* ── Toast password salvata ── */}
      {pwdSaved && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50
                        bg-green-600 text-white text-sm font-semibold
                        px-5 py-2.5 rounded-2xl shadow-lg pointer-events-none">
          Password aggiornata
        </div>
      )}

      {/* ── 1. Profilo ── */}
      <div className="bg-white rounded-2xl border border-[#e2e8f0] shadow-sm overflow-hidden">
        {/* Avatar + dati */}
        <div className="px-5 py-5 flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[#eef2f7] flex items-center justify-center shrink-0">
            <span className="text-[#1e3a5f] font-bold text-xl leading-none">
              {profile?.full_name?.charAt(0).toUpperCase() ?? '?'}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-[#1a202c] text-base truncate">{profile?.full_name}</p>
            <p className="text-xs text-[#718096] mt-0.5">
              {ROLE_LABEL[role] ?? role}
            </p>
            <p className="text-xs text-[#a0aec0] mt-0.5 truncate">{session?.user?.email}</p>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-[#f0f4f8]" />

        {/* Cambio password */}
        <div className="px-5 py-4">
          <button
            type="button"
            onClick={() => { setShowPwdForm(v => !v); setPwdError('') }}
            className="flex items-center gap-2 text-sm font-semibold text-[#1e3a5f]
                       active:opacity-70 transition-opacity"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            {showPwdForm ? 'Annulla cambio password' : 'Cambia password'}
          </button>

          {showPwdForm && (
            <div className="mt-4 flex flex-col gap-3">
              {/* Password attuale */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-[#718096] uppercase tracking-wide">
                  Password attuale
                </label>
                <div className="relative">
                  <input
                    type={showCurrent ? 'text' : 'password'}
                    value={pwdCurrent}
                    onChange={e => setPwdCurrent(e.target.value)}
                    placeholder="••••••••"
                    className="w-full h-11 pl-4 pr-11 rounded-xl border border-[#e2e8f0] text-sm
                               text-[#1a202c] bg-white outline-none focus:border-[#1e3a5f]
                               focus:ring-2 focus:ring-[#1e3a5f]/20 transition-colors"
                  />
                  <button type="button" onClick={() => setShowCurrent(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a0aec0]">
                    <EyeIcon open={showCurrent} />
                  </button>
                </div>
              </div>

              {/* Nuova password */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-[#718096] uppercase tracking-wide">
                  Nuova password
                </label>
                <div className="relative">
                  <input
                    type={showNew ? 'text' : 'password'}
                    value={pwdNew}
                    onChange={e => setPwdNew(e.target.value)}
                    placeholder="Minimo 6 caratteri"
                    className="w-full h-11 pl-4 pr-11 rounded-xl border border-[#e2e8f0] text-sm
                               text-[#1a202c] bg-white outline-none focus:border-[#1e3a5f]
                               focus:ring-2 focus:ring-[#1e3a5f]/20 transition-colors"
                  />
                  <button type="button" onClick={() => setShowNew(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a0aec0]">
                    <EyeIcon open={showNew} />
                  </button>
                </div>
              </div>

              {/* Conferma */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-[#718096] uppercase tracking-wide">
                  Conferma nuova password
                </label>
                <input
                  type="password"
                  value={pwdConfirm}
                  onChange={e => setPwdConfirm(e.target.value)}
                  placeholder="Ripeti la password"
                  className="w-full h-11 px-4 rounded-xl border border-[#e2e8f0] text-sm
                             text-[#1a202c] bg-white outline-none focus:border-[#1e3a5f]
                             focus:ring-2 focus:ring-[#1e3a5f]/20 transition-colors"
                />
              </div>

              {pwdError && (
                <p className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2">{pwdError}</p>
              )}

              <button
                type="button"
                onClick={handleChangePassword}
                disabled={pwdLoading}
                className="w-full h-11 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                           active:bg-[#152b47] disabled:opacity-60 transition-colors"
              >
                {pwdLoading ? 'Aggiornamento…' : 'Aggiorna password'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── 2. Preferenze Notifiche ── */}
      <div className="bg-white rounded-2xl border border-[#e2e8f0] shadow-sm">
        <div className="px-5 pt-5 pb-2">
          <p className="text-sm font-bold text-[#1a202c]">Preferenze Notifiche</p>
          <p className="text-xs text-[#718096] mt-0.5">
            Scegli quali notifiche ricevere nella tua inbox.
          </p>
        </div>

        <div className="px-5 py-3 flex flex-col divide-y divide-[#f0f4f8]">
          {loadingPrefs ? (
            <div className="flex flex-col gap-3 py-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-10 rounded-xl bg-[#f0f4f8] animate-pulse" />
              ))}
            </div>
          ) : notifItems.map(item => (
            <div key={item.key} className="flex items-center justify-between gap-4 py-3.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#1a202c]">{item.label}</p>
                <p className="text-xs text-[#a0aec0] mt-0.5">{item.desc}</p>
              </div>
              <Toggle
                checked={prefs[item.key]}
                onChange={() => togglePref(item.key)}
              />
            </div>
          ))}
        </div>

        <div className="px-5 pb-5">
          <button
            type="button"
            onClick={savePrefs}
            disabled={savingPrefs}
            className={`w-full h-11 rounded-xl font-semibold text-sm transition-colors
              ${prefsSaved
                ? 'bg-green-500 text-white'
                : 'bg-[#1e3a5f] text-white active:bg-[#152b47] disabled:opacity-60'}`}
          >
            {savingPrefs ? 'Salvataggio…' : prefsSaved ? '✓ Preferenze salvate' : 'Salva preferenze'}
          </button>
        </div>
      </div>

      {/* ── 3. Preferenze App ── */}
      <div className="bg-white rounded-2xl border border-[#e2e8f0] shadow-sm px-5 py-4">
        <p className="text-sm font-bold text-[#1a202c] mb-1">Preferenze App</p>
        <div className="flex items-center justify-between gap-4 pt-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[#1a202c]">Effetti sonori</p>
            <p className="text-xs text-[#a0aec0] mt-0.5">Suoni di feedback per azioni nell'app</p>
          </div>
          <Toggle checked={sfxEnabled} onChange={toggleSfx} />
        </div>
        <div className="h-px bg-[#f0f4f8] my-2" />
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-[#1a202c]">Dimensione testo</p>
          <div className="flex gap-2">
            {[{ val: 0, label: 'A', desc: 'Normale' }, { val: 1, label: 'A', desc: 'Grande' }, { val: 2, label: 'A', desc: 'Molto grande' }].map(({ val, label, desc }, i) => (
              <button key={val} type="button" onClick={() => applyFontSize(val)}
                className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-xl border-2 transition-colors
                  ${fontSize === val ? 'border-[#1e3a5f] bg-[#eef2f7]' : 'border-[#e2e8f0] bg-white active:bg-[#f8f9fa]'}`}>
                <span className="font-bold text-[#1a202c]" style={{ fontSize: `${14 + i * 4}px` }}>{label}</span>
                <span className="text-[10px] text-[#718096] font-medium">{desc}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Admin panel (solo per email admin) ── */}
      {session?.user?.email === adminEmail && (
        <button
          type="button"
          onClick={onGoToAdmin}
          className="w-full h-12 rounded-2xl border border-[#e2e8f0] bg-white text-[#1a202c]
                     font-semibold text-sm active:bg-[#f8f9fa] transition-colors
                     flex items-center justify-center gap-2 shadow-sm"
        >
          <svg className="w-4 h-4 text-[#718096]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          Pannello Admin
        </button>
      )}

      {/* ── 3. Logout ── */}
      <div className="bg-red-50 rounded-2xl border-2 border-red-200 px-5 py-5 flex flex-col gap-3">
        <div>
          <p className="text-sm font-bold text-red-700">Esci dall'account</p>
          <p className="text-xs text-red-400 mt-0.5">
            Verrai reindirizzato alla schermata di accesso.
          </p>
        </div>
        <button
          type="button"
          onClick={signOut}
          className="w-full h-11 rounded-xl border-2 border-red-300 bg-white text-red-600
                     font-semibold text-sm active:bg-red-50 transition-colors
                     flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Esci dall'account
        </button>
      </div>

    </div>
  )
}
