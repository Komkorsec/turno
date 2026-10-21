import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { playAudio, isSfxEnabled, setSfxEnabled } from '../utils/audio'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function SectionHeader({ icon, title }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <div className="w-8 h-8 rounded-xl bg-[#eef2f7] flex items-center justify-center shrink-0 text-base leading-none">
        {icon}
      </div>
      <h3 className="text-sm font-bold text-[#1a202c] tracking-tight">{title}</h3>
    </div>
  )
}

function InfoRow({ icon, label, value, href }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-3 py-3 border-b border-[#f0f4f8] last:border-0">
      <span className="text-base leading-none shrink-0 mt-0.5">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold text-[#a0aec0] uppercase tracking-wide mb-0.5">{label}</p>
        {href ? (
          <a href={href}
            className="text-sm text-[#1e3a5f] font-semibold leading-snug underline underline-offset-2
                       active:opacity-70 transition-opacity">
            {value}
          </a>
        ) : (
          <p className="text-sm text-[#1a202c] font-medium leading-snug">{value}</p>
        )}
      </div>
    </div>
  )
}

// ─── Toggle switch ────────────────────────────────────────────────────────────

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
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm
                    transition-transform duration-200
                    ${checked ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  )
}

// ─── Sezione Cambia Password ──────────────────────────────────────────────────

function ChangePasswordForm({ email, onClose }) {
  const [current,  setCurrent]  = useState('')
  const [next,     setNext]     = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')
  const [success,  setSuccess]  = useState(false)

  const [showCurrent, setShowCurrent] = useState(false)
  const [showNext,    setShowNext]    = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!current)                   { setError('Inserisci la password attuale.');        return }
    if (next.length < 8)            { setError('La nuova password deve avere almeno 8 caratteri.'); return }
    if (next !== confirm)           { setError('Le due password non coincidono.');        return }
    if (next === current)           { setError('La nuova password è uguale alla precedente.'); return }

    setSaving(true)

    // Verifica password attuale con re-login silenzioso
    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password: current })
    if (authErr) {
      setError('Password attuale non corretta.')
      setSaving(false)
      return
    }

    // Aggiorna la password
    const { error: updErr } = await supabase.auth.updateUser({ password: next })
    if (updErr) {
      setError('Errore durante l\'aggiornamento. Riprova.')
      setSaving(false)
      return
    }

    setSaving(false)
    setSuccess(true)
    setTimeout(() => { setSuccess(false); onClose() }, 2000)
  }

  const inputCls = `w-full h-11 pl-4 pr-10 rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c] text-sm
    outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 transition-colors`

  function EyeButton({ show, onToggle }) {
    return (
      <button type="button" onClick={onToggle}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a0aec0] active:text-[#718096]">
        {show ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        )}
      </button>
    )
  }

  if (success) {
    return (
      <div className="rounded-2xl bg-green-50 border border-green-200 px-4 py-5 text-center">
        <p className="text-2xl mb-1">✅</p>
        <p className="text-sm font-semibold text-green-800">Password aggiornata!</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-4 p-4 bg-[#f8f9fa] rounded-2xl border border-[#e2e8f0]">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#a0aec0]">Aggiorna password</p>

      {/* Password attuale */}
      <div className="relative">
        <label className="text-xs font-semibold text-[#718096] block mb-1.5">Password attuale</label>
        <input
          type={showCurrent ? 'text' : 'password'}
          value={current}
          onChange={e => setCurrent(e.target.value)}
          autoComplete="current-password"
          className={inputCls}
        />
        <EyeButton show={showCurrent} onToggle={() => setShowCurrent(v => !v)} />
      </div>

      {/* Nuova password */}
      <div className="relative">
        <label className="text-xs font-semibold text-[#718096] block mb-1.5">Nuova password</label>
        <input
          type={showNext ? 'text' : 'password'}
          value={next}
          onChange={e => setNext(e.target.value)}
          autoComplete="new-password"
          className={inputCls}
        />
        <EyeButton show={showNext} onToggle={() => setShowNext(v => !v)} />
        {next.length > 0 && next.length < 8 && (
          <p className="text-[10px] text-amber-600 mt-1">Minimo 8 caratteri</p>
        )}
      </div>

      {/* Conferma */}
      <div>
        <label className="text-xs font-semibold text-[#718096] block mb-1.5">Conferma nuova password</label>
        <input
          type="password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          autoComplete="new-password"
          className={inputCls}
        />
        {confirm.length > 0 && next !== confirm && (
          <p className="text-[10px] text-red-500 mt-1">Le password non coincidono</p>
        )}
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>}

      <div className="flex gap-2 mt-1">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 h-10 rounded-xl border border-[#e2e8f0] text-sm font-semibold text-[#718096]
                     active:bg-[#f0f4f8] transition-colors"
        >
          Annulla
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex-[2] h-10 rounded-xl bg-[#1e3a5f] text-white text-sm font-semibold
                     active:bg-[#152b47] disabled:opacity-60 transition-colors"
        >
          {saving ? 'Salvataggio…' : 'Salva password'}
        </button>
      </div>
    </form>
  )
}

// ─── Componente principale ────────────────────────────────────────────────────

export default function OperatorSettingsPage({ signOut }) {
  const { profile, session, activeStructureId, userStructures } = useAuth()

  const email = session?.user?.email ?? ''

  // ── Struttura ────────────────────────────────────────────────────────────────
  const [structure,      setStructure]      = useState(null)
  const [allStructures,  setAllStructures]  = useState([])   // multi-struttura
  const [manager,        setManager]        = useState(null)
  const [loadingStruct,  setLoadingStruct]  = useState(true)

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [showPwdForm,    setShowPwdForm]    = useState(false)

  // ── Effetti sonori ────────────────────────────────────────────────────────
  const [sfxEnabled, setSfxEnabledState] = useState(() => isSfxEnabled())
  function toggleSfx(val) {
    setSfxEnabled(val)
    setSfxEnabledState(val)
    if (val) playAudio('action')
  }

  // ── Dimensione testo ──────────────────────────────────────────────────────────
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

  // ── Preferenze notifiche (localStorage) ──────────────────────────────────────
  const NOTIF_KEY = `turno_notif_${profile?.id}`
  const [notifShifts,    setNotifShifts]    = useState(() => {
    try { return JSON.parse(localStorage.getItem(NOTIF_KEY))?.shifts   ?? true  } catch { return true }
  })
  const [notifComments,  setNotifComments]  = useState(() => {
    try { return JSON.parse(localStorage.getItem(NOTIF_KEY))?.comments ?? true  } catch { return true }
  })

  function saveNotifPrefs(shifts, comments) {
    localStorage.setItem(NOTIF_KEY, JSON.stringify({ shifts, comments }))
  }

  function toggleShifts(v) {
    setNotifShifts(v)
    saveNotifPrefs(v, notifComments)
  }
  function toggleComments(v) {
    setNotifComments(v)
    saveNotifPrefs(notifShifts, v)
  }

  // ── Fetch struttura/e + manager ───────────────────────────────────────────────
  // Se l'utente ha più strutture mostra sempre TUTTE, indipendentemente da activeStructureId
  const isMulti     = userStructures.length > 1
  const structureId = isMulti ? null : (activeStructureId ?? profile?.structure_id)

  useEffect(() => {
    async function load() {
      setLoadingStruct(true)

      // Caso multi-struttura: carica tutte le strutture con contatti
      if (isMulti) {
        const ids = userStructures.map(s => s.id)
        const { data: rows } = await supabase
          .from('structures')
          .select('id, name, address, email, phone')
          .in('id', ids)
          .order('name')

        setAllStructures(rows ?? [])
        setStructure(null)
        setLoadingStruct(false)
        return
      }

      if (!structureId) { setLoadingStruct(false); return }

      const { data: sData } = await supabase
        .from('structures')
        .select('id, name, address, type, capacity, logo_url, notes_private, organization_id, email, phone')
        .eq('id', structureId)
        .maybeSingle()

      setStructure(sData ?? null)
      setAllStructures([])

      // Cerca il manager per la stessa organizzazione
      if (sData?.organization_id) {
        const { data: mData } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('organization_id', sData.organization_id)
          .eq('role', 'manager')
          .limit(1)
          .maybeSingle()
        setManager(mData ?? null)
      }

      setLoadingStruct(false)
    }

    load()
  }, [isMulti, structureId, userStructures])

  // ── Render ────────────────────────────────────────────────────────────────────

  const initials = profile?.full_name
    ?.split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() ?? '?'

  const roleName = profile?.role === 'operator'
    ? 'Operatore'
    : profile?.role === 'admin_secondary'
      ? 'Coordinatore'
      : profile?.role ?? ''

  return (
    <div className="px-4 py-6 flex flex-col gap-6 pb-24">

      {/* ══ SEZIONE: IL MIO PROFILO ═══════════════════════════════════════════ */}
      <section className="bg-white rounded-2xl border border-[#e2e8f0] p-5 shadow-sm">
        <SectionHeader icon="👤" title="Il mio profilo" />

        {/* Avatar + nome + badge */}
        <div className="flex items-center gap-4 mb-5">
          <div className="w-14 h-14 rounded-2xl bg-[#1e3a5f] flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-xl leading-none">{initials}</span>
          </div>
          <div className="min-w-0">
            <p className="font-bold text-[#1a202c] text-base leading-tight truncate">
              {profile?.full_name ?? '—'}
            </p>
            <span className="inline-block mt-1 text-[10px] font-bold bg-[#eef2f7] text-[#1e3a5f]
                             rounded-full px-2.5 py-0.5 uppercase tracking-wide">
              {roleName}
            </span>
          </div>
        </div>

        {/* Email */}
        <div className="flex flex-col gap-1 mb-5">
          <label className="text-[10px] font-semibold text-[#a0aec0] uppercase tracking-wide">
            Email
          </label>
          <div className="flex items-center gap-2 h-11 px-4 rounded-xl bg-[#f8f9fa] border border-[#e2e8f0]">
            <svg className="w-4 h-4 text-[#a0aec0] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span className="text-sm text-[#718096] truncate">{email || '—'}</span>
          </div>
        </div>

        {/* Pulsante cambia password */}
        {!showPwdForm && (
          <button
            type="button"
            onClick={() => setShowPwdForm(true)}
            className="w-full h-10 rounded-xl border border-[#1e3a5f]/30 text-[#1e3a5f] text-sm font-semibold
                       flex items-center justify-center gap-2 active:bg-[#eef2f7] transition-colors"
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            Cambia password
          </button>
        )}

        {showPwdForm && (
          <ChangePasswordForm email={email} onClose={() => setShowPwdForm(false)} />
        )}
      </section>

      {/* ══ SEZIONE: LA MIA STRUTTURA ═════════════════════════════════════════ */}
      <section className="bg-white rounded-2xl border border-[#e2e8f0] p-5 shadow-sm">
        <SectionHeader icon="🏢" title={allStructures.length > 1 ? 'Le mie strutture' : 'La mia struttura'} />

        {loadingStruct ? (
          <div className="flex flex-col gap-3 animate-pulse">
            <div className="h-5 w-2/3 bg-[#e2e8f0] rounded" />
            <div className="h-4 w-full bg-[#f0f4f8] rounded" />
            <div className="h-4 w-1/2 bg-[#f0f4f8] rounded" />
          </div>
        ) : allStructures.length > 0 ? (
          /* Multi-struttura: lista di tutte le strutture */
          <div className="flex flex-col gap-3">
            {allStructures.map(s => (
              <div key={s.id} className="rounded-xl border border-[#e2e8f0] px-4 py-3.5 bg-[#f8f9fa] flex flex-col gap-2">
                <p className="font-bold text-[#1a202c] text-sm leading-tight">{s.name}</p>
                {s.address && (
                  <div className="flex items-start gap-2">
                    <span className="text-[#a0aec0] shrink-0 mt-0.5">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </span>
                    <p className="text-xs text-[#718096] leading-snug">{s.address}</p>
                  </div>
                )}
                {(s.email || s.phone) && (
                  <div className="flex flex-col gap-1.5 pt-1 border-t border-[#e2e8f0]">
                    {s.email && (
                      <a href={`mailto:${s.email}`} className="flex items-center gap-2 text-xs text-[#1e3a5f] font-semibold active:opacity-70">
                        <svg className="w-3.5 h-3.5 shrink-0 text-[#a0aec0]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        {s.email}
                      </a>
                    )}
                    {s.phone && (
                      <a href={`tel:${s.phone}`} className="flex items-center gap-2 text-xs text-[#1e3a5f] font-semibold active:opacity-70">
                        <svg className="w-3.5 h-3.5 shrink-0 text-[#a0aec0]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                        </svg>
                        {s.phone}
                      </a>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : !structure ? (
          <p className="text-sm text-[#a0aec0] italic">Struttura non trovata.</p>
        ) : (
          <>
            {/* Nome struttura */}
            <p className="text-lg font-bold text-[#1a202c] leading-tight mb-1">
              {structure.name}
            </p>
            {structure.type && (
              <span className="inline-block mb-3 text-[11px] font-semibold rounded-full px-2.5 py-0.5
                               bg-[#eef2f7] text-[#1e3a5f]">
                {structure.type}
              </span>
            )}

            {/* Dettagli */}
            <div className="divide-y divide-[#f0f4f8] border-t border-[#f0f4f8] mt-1">
              <InfoRow icon="📍" label="Indirizzo" value={structure.address} />
              <InfoRow icon="👤" label="Responsabile" value={manager?.full_name} />
              <InfoRow icon="📧" label="Email comunità" value={structure.email}
                href={structure.email ? `mailto:${structure.email}` : undefined} />
              <InfoRow icon="📞" label="Telefono" value={structure.phone}
                href={structure.phone ? `tel:${structure.phone}` : undefined} />
            </div>

            {/* Note di servizio */}
            {structure.notes_private && (
              <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3.5">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-sm leading-none">📋</span>
                  <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wide">
                    Note di servizio
                  </p>
                </div>
                <p className="text-sm text-amber-900 leading-relaxed whitespace-pre-wrap">
                  {structure.notes_private}
                </p>
              </div>
            )}
          </>
        )}
      </section>

      {/* ══ SEZIONE: PREFERENZE NOTIFICHE ════════════════════════════════════ */}
      <section className="bg-white rounded-2xl border border-[#e2e8f0] p-5 shadow-sm">
        <SectionHeader icon="🔔" title="Preferenze notifiche" />

        <div className="flex flex-col gap-0 divide-y divide-[#f0f4f8]">
          {/* Toggle turni */}
          <div className="flex items-center justify-between gap-4 py-3.5">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#1a202c] leading-tight">
                Nuovi turni pubblicati
              </p>
              <p className="text-xs text-[#a0aec0] mt-0.5 leading-snug">
                Ricevi una notifica email quando il manager pubblica i turni settimanali.
              </p>
            </div>
            <Toggle checked={notifShifts} onChange={toggleShifts} />
          </div>

          {/* Toggle commenti */}
          <div className="flex items-center justify-between gap-4 py-3.5">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#1a202c] leading-tight">
                Commenti e diari
              </p>
              <p className="text-xs text-[#a0aec0] mt-0.5 leading-snug">
                Ricevi notifiche per nuovi commenti sui diari di bordo.
              </p>
            </div>
            <Toggle checked={notifComments} onChange={toggleComments} />
          </div>

          {/* Toggle effetti sonori */}
          <div className="flex items-center justify-between gap-4 py-3.5">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#1a202c] leading-tight">
                Effetti sonori
              </p>
              <p className="text-xs text-[#a0aec0] mt-0.5 leading-snug">
                Suoni di feedback per azioni nell'app.
              </p>
            </div>
            <Toggle checked={sfxEnabled} onChange={toggleSfx} />
          </div>
        </div>

        <p className="text-[10px] text-[#a0aec0] mt-3 leading-relaxed">
          Le preferenze sono salvate localmente su questo dispositivo.
        </p>
      </section>

      {/* ══ LOGOUT ════════════════════════════════════════════════════════════ */}
      {/* ══ SEZIONE: ASPETTO ════════════════════════════════════════════════ */}
      <section className="bg-white rounded-2xl border border-[#e2e8f0] p-5 shadow-sm">
        <SectionHeader icon="🔠" title="Aspetto" />
        <p className="text-sm font-semibold text-[#1a202c] mb-3">Dimensione testo</p>
        <div className="flex gap-2">
          {[{ val: 0, label: 'A', desc: 'Normale' }, { val: 1, label: 'A', desc: 'Grande' }, { val: 2, label: 'A', desc: 'Molto grande' }].map(({ val, label, desc }, i) => (
            <button key={val} type="button" onClick={() => applyFontSize(val)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-xl border-2 transition-colors
                ${fontSize === val ? 'border-[#1e3a5f] bg-[#eef2f7]' : 'border-[#e2e8f0] bg-white active:bg-[#f8f9fa]'}`}>
              <span className={`font-bold text-[#1a202c]`} style={{ fontSize: `${14 + i * 4}px` }}>{label}</span>
              <span className="text-[10px] text-[#718096] font-medium">{desc}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <button
          type="button"
          onClick={signOut}
          className="w-full h-12 rounded-2xl border-2 border-red-200 bg-red-50 text-red-600
                     font-semibold text-sm active:bg-red-100 transition-colors
                     flex items-center justify-center gap-2.5"
        >
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Esci dall'account
        </button>
      </section>

    </div>
  )
}
