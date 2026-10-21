import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ─── Speech-to-Text ───────────────────────────────────────────────────────────

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition || null)
  : null

function MicButton({ value, onChange }) {
  const [state, setState] = useState('idle') // idle | listening | error
  const recRef  = useRef(null)
  const baseRef  = useRef('')   // testo al momento dell'avvio
  const finalRef = useRef('')   // trascrizioni finalizzate durante la sessione

  if (!SR) return null          // browser non supporta SpeechRecognition

  function start() {
    baseRef.current  = value ?? ''
    finalRef.current = ''

    const rec = new SR()
    rec.lang           = 'it-IT'
    rec.continuous     = true
    rec.interimResults = true

    rec.onstart = () => setState('listening')

    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) {
          finalRef.current += (finalRef.current ? ' ' : '') + t.trim()
        } else {
          interim = t
        }
      }
      const base = baseRef.current
      const sep  = base && (finalRef.current || interim) ? ' ' : ''
      const live = base + sep + finalRef.current + (interim ? ' ' + interim : '')
      onChange(live.trimStart())
    }

    rec.onend = () => {
      // Finalizza il testo senza interim residui
      const base = baseRef.current
      const sep  = base && finalRef.current ? ' ' : ''
      onChange((base + sep + finalRef.current).trim())
      setState('idle')
    }

    rec.onerror = (ev) => {
      // 'aborted' = stop manuale, non è un errore
      if (ev.error !== 'aborted') setState('error')
      setTimeout(() => setState('idle'), 2000)
    }

    rec.start()
    recRef.current = rec
  }

  function stop() {
    recRef.current?.stop()
    recRef.current = null
  }

  function toggle() {
    if (state === 'listening') stop()
    else start()
  }

  // Cleanup all'unmount
  useEffect(() => () => recRef.current?.abort(), [])

  const isListening = state === 'listening'
  const isError     = state === 'error'

  return (
    <button
      type="button"
      onClick={toggle}
      title={isListening ? 'Ferma dettatura' : 'Dettatura vocale'}
      className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors shrink-0
        ${isListening
          ? 'bg-red-500 text-white'
          : isError
            ? 'bg-red-100 text-red-400'
            : 'bg-[#eef2f7] text-[#718096] active:bg-[#e2e8f0]'}`}
    >
      {isListening ? (
        /* Mic attivo: icona con animazione pulse */
        <svg className="w-4 h-4 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm-1 16.93V20H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.07A8.001 8.001 0 0 0 20 11a1 1 0 0 0-2 0 6 6 0 0 1-12 0 1 1 0 0 0-2 0 8.001 8.001 0 0 0 7 7.93z"/>
        </svg>
      ) : (
        /* Mic inattivo */
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4z"/>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M19 11a7 7 0 0 1-14 0M12 19v4M8 23h8"/>
        </svg>
      )}
    </button>
  )
}

// ─── Costanti ────────────────────────────────────────────────────────────────

const MOOD_OPTIONS = [
  { value: 1, emoji: '😔', label: 'Molto difficile' },
  { value: 2, emoji: '😕', label: 'Difficile'       },
  { value: 3, emoji: '😐', label: 'Nella norma'     },
  { value: 4, emoji: '🙂', label: 'Buono'           },
  { value: 5, emoji: '😊', label: 'Ottimo'          },
]

const MOOD_ACTIVE_COLORS = {
  1: 'bg-red-500    border-red-500    text-white',
  2: 'bg-orange-500 border-orange-500 text-white',
  3: 'bg-amber-500  border-amber-500  text-white',
  4: 'bg-lime-500   border-lime-500   text-white',
  5: 'bg-green-500  border-green-500  text-white',
}

const INCIDENT_TYPES = [
  { value: 'conflitto_ragazzi', label: 'Conflitto tra ragazzi' },
  { value: 'fuga',              label: 'Fuga'                  },
  { value: 'problema_esterno',  label: 'Problema esterno'      },
  { value: 'altro',             label: 'Altro'                 },
]

const EMPTY_FORM = {
  mood:          null,
  hasIncident:   null,
  incidentType:  '',
  incidentNotes: '',
  handoverNotes: '',
  managerNotes:  '',
  shiftStart:    '',
  shiftEnd:      '',
  isUrgent:      false,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isNetworkError(error) {
  if (!navigator.onLine) return true
  const msg = (error?.message ?? '').toLowerCase()
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror')    ||
    msg.includes('network request failed') ||
    msg.includes('load failed')
  )
}

function buildPayload(form, profile) {
  return {
    structure_id:   profile.structure_id,
    operator_id:    profile.id,
    mood:           form.mood,
    has_incident:   form.hasIncident,
    incident_type:  form.hasIncident ? form.incidentType  : null,
    incident_notes: form.hasIncident && form.incidentNotes.trim() ? form.incidentNotes.trim() : null,
    handover_notes: form.handoverNotes.trim() || null,
    manager_notes:  form.managerNotes.trim()  || null,
    shift_start:    form.shiftStart || null,
    shift_end:      form.shiftEnd   || null,
    is_urgent:      form.isUrgent ?? false,
  }
}

function formHasContent(f) {
  return f.mood !== null || f.hasIncident !== null ||
    f.handoverNotes || f.managerNotes || f.incidentNotes ||
    f.shiftStart || f.shiftEnd
}

// ─── Componente ──────────────────────────────────────────────────────────────

export default function DiaryForm({ profile, onSubmitted }) {
  const DRAFT_KEY   = `turno_draft_${profile.id}`
  const PENDING_KEY = `turno_pending_${profile.id}`

  // Ripristina bozza da localStorage (lazy initializer — eseguito una volta sola)
  const [form, setForm] = useState(() => {
    try {
      const saved = localStorage.getItem(`turno_draft_${profile.id}`)
      return saved ? JSON.parse(saved) : EMPTY_FORM
    } catch { return EMPTY_FORM }
  })

  const [status, setStatus]     = useState('idle') // idle | submitting | success | offline | error
  const [errorMsg, setErrorMsg] = useState('')

  // Bozza trovata al primo caricamento
  const [hasDraft] = useState(() => {
    try {
      const saved = localStorage.getItem(`turno_draft_${profile.id}`)
      if (!saved) return false
      return formHasContent(JSON.parse(saved))
    } catch { return false }
  })

  // Numero report in coda offline
  const [pendingCount, setPendingCount] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(`turno_pending_${profile.id}`) ?? '[]').length
    } catch { return 0 }
  })

  const [retrying, setRetrying] = useState(false)
  const draftTimer = useRef(null)

  const [operativeNotes, setOperativeNotes] = useState([]) // [{ nome, cognome, operative_notes }]

  useEffect(() => {
    if (!profile.structure_id) return
    supabase.from('residents')
      .select('nome, cognome, operative_notes')
      .eq('structure_id', profile.structure_id)
      .eq('is_archived', false)
      .not('operative_notes', 'is', null)
      .then(({ data }) => setOperativeNotes(data ?? []))
  }, [profile.structure_id])

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  // ── Auto-save bozza (debounced 400 ms) ─────────────────────────────────────
  useEffect(() => {
    clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(() => {
      if (formHasContent(form)) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(form))
      }
    }, 400)
    return () => clearTimeout(draftTimer.current)
  }, [form, DRAFT_KEY])

  // ── Retry report in sospeso ─────────────────────────────────────────────────
  const retryPending = useCallback(async () => {
    let pending
    try { pending = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]') }
    catch { return }
    if (pending.length === 0) return

    setRetrying(true)
    const remaining = []
    let sent = 0

    for (const item of pending) {
      // eslint-disable-next-line no-unused-vars
      const { _id, _savedAt, ...payload } = item
      const { error } = await supabase.from('diaries').insert(payload)
      if (error) {
        if (isNetworkError(error)) remaining.push(item) // ancora offline: rimetti in coda
        // altrimenti: scarta (errore non recuperabile, es. duplicato)
      } else {
        sent++
      }
    }

    localStorage.setItem(PENDING_KEY, JSON.stringify(remaining))
    setPendingCount(remaining.length)
    if (sent > 0) onSubmitted()
    setRetrying(false)
  }, [PENDING_KEY, onSubmitted])

  // Avvia retry al mount (se online) e ogni volta che torna la rete
  useEffect(() => {
    if (navigator.onLine) retryPending()
    window.addEventListener('online', retryPending)
    return () => window.removeEventListener('online', retryPending)
  }, [retryPending])

  // ── Validazione ─────────────────────────────────────────────────────────────
  function validate() {
    if (form.mood === null)       return 'Seleziona l\'umore del turno.'
    if (form.hasIncident === null) return 'Indica se ci sono stati episodi critici.'
    if (form.hasIncident && !form.incidentType) return 'Seleziona la categoria dell\'episodio.'
    return null
  }

  // ── Salva in coda offline ───────────────────────────────────────────────────
  function queueOffline(payload) {
    let pending
    try { pending = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]') }
    catch { pending = [] }
    pending.push({ _id: Date.now(), _savedAt: new Date().toISOString(), ...payload })
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
    clearTimeout(draftTimer.current)
    localStorage.removeItem(DRAFT_KEY)
    setPendingCount(pending.length)
    setForm(EMPTY_FORM)
    setStatus('offline')
    setTimeout(() => setStatus('idle'), 6000)
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault()
    const err = validate()
    if (err) { setErrorMsg(err); return }

    setErrorMsg('')
    setStatus('submitting')

    const payload = buildPayload(form, profile)

    if (!navigator.onLine) {
      queueOffline(payload)
      return
    }

    const { error } = await supabase.from('diaries').insert(payload)

    if (error) {
      if (isNetworkError(error)) {
        queueOffline(payload)
      } else {
        console.error(error)
        setErrorMsg('Errore durante il salvataggio. Riprova.')
        setStatus('error')
      }
      return
    }

    clearTimeout(draftTimer.current)
    localStorage.removeItem(DRAFT_KEY)
    setStatus('success')
    setForm(EMPTY_FORM)
    onSubmitted()
    setTimeout(() => setStatus('idle'), 3000)
  }

  // ── Schermate stato ─────────────────────────────────────────────────────────
  if (status === 'success') {
    return (
      <div className="rounded-2xl bg-green-50 border border-green-200 p-8 text-center">
        <div className="text-4xl mb-3">✅</div>
        <p className="font-semibold text-green-800 text-lg">Diario salvato!</p>
        <p className="text-green-700 text-sm mt-1">Il turno è stato consegnato con successo.</p>
      </div>
    )
  }

  if (status === 'offline') {
    return (
      <div className="rounded-2xl bg-amber-50 border border-amber-200 p-8 text-center">
        <div className="text-4xl mb-3">📡</div>
        <p className="font-semibold text-amber-800 text-lg">Report salvato localmente</p>
        <p className="text-amber-700 text-sm mt-2 leading-relaxed">
          Connessione assente. Il report è stato salvato localmente
          e verrà inviato automaticamente appena tornerai online.
        </p>
      </div>
    )
  }

  // ── Form ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">

      {/* Banner: report in attesa di invio */}
      {pendingCount > 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-center gap-3">
          <span className="text-lg shrink-0">📤</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800">
              {pendingCount === 1 ? '1 report in attesa' : `${pendingCount} report in attesa`}
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              {retrying ? 'Invio in corso…' : 'Sarà inviato automaticamente quando tornerai online.'}
            </p>
          </div>
          {retrying && (
            <div className="w-4 h-4 rounded-full border-2 border-amber-500 border-t-transparent animate-spin shrink-0" />
          )}
        </div>
      )}

      {/* Banner note operative residenti */}
      {operativeNotes.length > 0 && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-base shrink-0">⚠️</span>
            <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">Note operative</p>
          </div>
          {operativeNotes.map((r, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              <p className="text-xs font-semibold text-amber-900">{r.nome} {r.cognome}</p>
              <p className="text-xs text-amber-800 leading-relaxed">{r.operative_notes}</p>
            </div>
          ))}
        </div>
      )}

      {/* Badge bozza ripristinata */}
      {hasDraft && (
        <div className="flex items-center gap-2 px-1">
          <span className="text-xs text-[#718096] bg-[#eef2f7] rounded-full px-3 py-1">
            Bozza ripristinata dall'ultima sessione
          </span>
          <button
            type="button"
            onClick={() => { setForm(EMPTY_FORM); localStorage.removeItem(DRAFT_KEY) }}
            className="text-xs text-[#a0aec0] underline"
          >
            Cancella
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-7">

        {/* ORARIO TURNO */}
        <div>
          <label className="block text-sm font-semibold text-[#1a202c] mb-3">
            Orario del turno
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-[#718096] font-medium">Inizio</span>
              <input
                type="time"
                value={form.shiftStart}
                onChange={e => set('shiftStart', e.target.value)}
                className="w-full h-14 px-4 rounded-xl border border-[#e2e8f0] bg-white
                           text-[#1a202c] text-lg font-semibold text-center
                           outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                           transition-colors"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-[#718096] font-medium">Fine</span>
              <input
                type="time"
                value={form.shiftEnd}
                onChange={e => set('shiftEnd', e.target.value)}
                className="w-full h-14 px-4 rounded-xl border border-[#e2e8f0] bg-white
                           text-[#1a202c] text-lg font-semibold text-center
                           outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                           transition-colors"
              />
            </div>
          </div>
        </div>

        {/* UMORE */}
        <div>
          <label className="block text-sm font-semibold text-[#1a202c] mb-3">
            Com'è andato il turno? <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-5 gap-2">
            {MOOD_OPTIONS.map(opt => {
              const isActive = form.mood === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => set('mood', opt.value)}
                  className={`
                    flex flex-col items-center justify-center gap-1 rounded-xl border-2 py-3
                    transition-all active:scale-95 cursor-pointer
                    ${isActive ? MOOD_ACTIVE_COLORS[opt.value] : 'bg-white border-[#e2e8f0] text-[#1a202c]'}
                  `}
                >
                  <span className="text-2xl leading-none">{opt.emoji}</span>
                  <span className="text-[10px] font-medium leading-tight text-center px-0.5 hidden sm:block">
                    {opt.label}
                  </span>
                  <span className="text-xs font-bold">{opt.value}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* EPISODI CRITICI */}
        <div>
          <label className="block text-sm font-semibold text-[#1a202c] mb-3">
            Ci sono stati episodi critici? <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            {[
              { value: false, label: 'No', icon: '✓' },
              { value: true,  label: 'Sì', icon: '!' },
            ].map(opt => {
              const isActive    = form.hasIncident === opt.value
              const activeClass = opt.value
                ? 'bg-red-500 border-red-500 text-white'
                : 'bg-[#1e3a5f] border-[#1e3a5f] text-white'
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => {
                    set('hasIncident', opt.value)
                    if (!opt.value) { set('incidentType', ''); set('incidentNotes', '') }
                  }}
                  className={`
                    h-14 rounded-xl border-2 font-semibold text-base
                    transition-all active:scale-95 cursor-pointer
                    ${isActive ? activeClass : 'bg-white border-[#e2e8f0] text-[#1a202c]'}
                  `}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* TIPO EPISODIO */}
        {form.hasIncident === true && (
          <div className="flex flex-col gap-4 rounded-2xl bg-red-50 border border-red-100 p-4">
            <div>
              <label htmlFor="incidentType" className="block text-sm font-semibold text-[#1a202c] mb-2">
                Categoria episodio <span className="text-red-500">*</span>
              </label>
              <select
                id="incidentType"
                value={form.incidentType}
                onChange={e => set('incidentType', e.target.value)}
                className="w-full h-12 px-4 rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c] text-base
                           outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                           transition-colors appearance-none"
              >
                <option value="">Seleziona…</option>
                {INCIDENT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="incidentNotes" className="text-sm font-semibold text-[#1a202c]">
                  Descrizione episodio
                </label>
                <MicButton value={form.incidentNotes} onChange={v => set('incidentNotes', v)} />
              </div>
              <textarea
                id="incidentNotes"
                rows={3}
                value={form.incidentNotes}
                onChange={e => set('incidentNotes', e.target.value)}
                placeholder="Descrivi brevemente cosa è successo…"
                className="w-full px-4 py-3 rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c] text-base
                           outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                           transition-colors resize-none placeholder:text-[#a0aec0]"
              />
            </div>
          </div>
        )}

        {/* PASSAGGIO DI CONSEGNE */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="handoverNotes" className="text-sm font-semibold text-[#1a202c]">
              Passaggio di consegne
            </label>
            <MicButton value={form.handoverNotes} onChange={v => set('handoverNotes', v)} />
          </div>
          <p className="text-xs text-[#718096] mb-2">Cosa deve sapere il turno successivo?</p>
          <textarea
            id="handoverNotes"
            rows={4}
            value={form.handoverNotes}
            onChange={e => set('handoverNotes', e.target.value)}
            placeholder="Es. Mario ha avuto difficoltà a dormire, da monitorare…"
            className="w-full px-4 py-3 rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c] text-base
                       outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                       transition-colors resize-none placeholder:text-[#a0aec0]"
          />
        </div>

        {/* NOTE PER LA RESPONSABILE */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="managerNotes" className="text-sm font-semibold text-[#1a202c]">
              Note per la responsabile
            </label>
            <MicButton value={form.managerNotes} onChange={v => set('managerNotes', v)} />
          </div>
          <p className="text-xs text-[#718096] mb-2">Informazioni riservate per il management.</p>
          <textarea
            id="managerNotes"
            rows={3}
            value={form.managerNotes}
            onChange={e => set('managerNotes', e.target.value)}
            placeholder="Es. Colloquio con i genitori di…"
            className="w-full px-4 py-3 rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c] text-base
                       outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                       transition-colors resize-none placeholder:text-[#a0aec0]"
          />
        </div>

        {/* ERRORE */}
        {(errorMsg || status === 'error') && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {errorMsg || 'Errore durante il salvataggio. Riprova.'}
          </div>
        )}

        {/* URGENZA */}
        <button
          type="button"
          onClick={() => set('isUrgent', !form.isUrgent)}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-colors text-left
            ${form.isUrgent
              ? 'bg-red-50 border-red-400 text-red-700'
              : 'bg-white border-[#e2e8f0] text-[#718096]'}`}
        >
          <span className="text-xl shrink-0">{form.isUrgent ? '🚨' : '⚪'}</span>
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${form.isUrgent ? 'text-red-700' : 'text-[#1a202c]'}`}>
              Segnala come urgente
            </p>
            <p className="text-xs text-[#a0aec0] leading-tight">
              Notifica immediata a tutti i colleghi della struttura
            </p>
          </div>
          <span className={`ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0
            ${form.isUrgent ? 'bg-red-500 border-red-500' : 'border-[#cbd5e0]'}`}>
            {form.isUrgent && (
              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            )}
          </span>
        </button>

        {/* SUBMIT */}
        <button
          type="submit"
          disabled={status === 'submitting'}
          className={`w-full h-14 rounded-xl font-semibold text-base transition-colors
            disabled:opacity-60 disabled:cursor-not-allowed
            ${form.isUrgent
              ? 'bg-red-600 text-white active:bg-red-700'
              : 'bg-[#1e3a5f] text-white active:bg-[#152b47]'}`}
        >
          {status === 'submitting' ? 'Salvataggio…' : form.isUrgent ? '🚨 Consegna turno — Urgente' : 'Consegna il turno'}
        </button>

      </form>
    </div>
  )
}
