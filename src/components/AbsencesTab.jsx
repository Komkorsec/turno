import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ─── Costanti ────────────────────────────────────────────────────────────────

const ABSENCE_STATUS_CFG = {
  pending:  { label: 'In attesa',  bg: '#fef3c7', text: '#92400e' },
  approved: { label: 'Approvata',  bg: '#d1fae5', text: '#065f46' },
  rejected: { label: 'Rifiutata',  bg: '#fee2e2', text: '#991b1b' },
}

const SLOT_LABELS = {
  giorno_intero:  'Giorno intero',
  mattina:        'Mattina (06–14)',
  pomeriggio:     'Pomeriggio (14–22)',
  notte:          'Notte (22–06)',
  personalizzata: 'Personalizzata',
}

const SLOT_TIMES = {
  mattina:    { start: '06:00', end: '14:00', nextDay: false },
  pomeriggio: { start: '14:00', end: '22:00', nextDay: false },
  notte:      { start: '22:00', end: '06:00', nextDay: true  },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toISO(date) {
  return date.toISOString().slice(0, 10)
}

function fmtAbsDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtDayShort(iso) {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString('it-IT', {
    weekday: 'short', day: '2-digit', month: 'short',
  })
}

function makeSlot(date = '') {
  return { id: crypto.randomUUID(), date, slotType: 'giorno_intero', customFrom: '09:00', customTo: '13:00' }
}

function nextDayISO(dateISO) {
  if (!dateISO) {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return toISO(d)
  }
  const d = new Date(dateISO + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  return toISO(d)
}

function slotToRecord(slot, reason, userId, groupId) {
  if (slot.slotType === 'giorno_intero') {
    return {
      user_id: userId, start_date: slot.date, end_date: slot.date,
      is_full_day: true, slot_type: 'giorno_intero',
      start_time: null, end_time: null,
      reason: reason || null, status: 'pending', request_group_id: groupId,
    }
  }
  const conf = slot.slotType === 'personalizzata'
    ? { start: slot.customFrom, end: slot.customTo, nextDay: slot.customTo < slot.customFrom }
    : SLOT_TIMES[slot.slotType]
  const endDay = conf.nextDay
    ? toISO(new Date(new Date(slot.date + 'T00:00:00').getTime() + 86400000))
    : slot.date
  return {
    user_id: userId, start_date: slot.date, end_date: endDay,
    is_full_day: false, slot_type: slot.slotType,
    start_time: conf.start, end_time: conf.end,
    reason: reason || null, status: 'pending', request_group_id: groupId,
  }
}

function groupAbsences(absences) {
  const map = new Map()
  for (const abs of absences) {
    const key = abs.request_group_id ?? String(abs.id)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(abs)
  }
  return [...map.values()].sort((a, b) =>
    (b[0].start_date ?? '').localeCompare(a[0].start_date ?? '')
  )
}

function groupStatus(records) {
  if (records.every(r => r.status === 'approved')) return 'approved'
  if (records.some(r => r.status === 'rejected'))  return 'rejected'
  return 'pending'
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function AbsencesTab({ profile }) {
  const [absences,   setAbsences]   = useState([])
  const [loading,    setLoading]    = useState(false)
  const [showForm,   setShowForm]   = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')

  // Form
  const [mode,       setMode]       = useState('range')
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd,   setRangeEnd]   = useState('')
  const [slots,      setSlots]      = useState([makeSlot()])
  const [reason,     setReason]     = useState('')

  const todayISO = toISO(new Date())

  const fetchAbsences = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('absences').select('*')
      .eq('user_id', profile.id).order('start_date', { ascending: false })
    setAbsences(data ?? [])
    setLoading(false)
  }, [profile.id])

  useEffect(() => { fetchAbsences() }, [fetchAbsences])

  // Aggiornamento in tempo reale: ricarica quando il manager approva/rifiuta
  useEffect(() => {
    const channel = supabase
      .channel(`absences-user-${profile.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'absences',
        filter: `user_id=eq.${profile.id}`,
      }, () => fetchAbsences())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile.id, fetchAbsences])

  function resetForm() {
    setMode('range'); setRangeStart(''); setRangeEnd('')
    setSlots([makeSlot()]); setReason(''); setError('')
  }

  function updateSlot(id, field, value) {
    setSlots(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s))
  }

  async function submit() {
    setError('')
    if (mode === 'range') {
      if (!rangeStart || !rangeEnd || rangeEnd < rangeStart) {
        setError('Seleziona data di inizio e fine valide.'); return
      }
      setSaving(true)
      const groupId = crypto.randomUUID()
      const { error: err } = await supabase.from('absences').insert([{
        user_id: profile.id, start_date: rangeStart, end_date: rangeEnd,
        is_full_day: true, slot_type: 'giorno_intero',
        start_time: null, end_time: null,
        reason: reason || null, status: 'pending', request_group_id: groupId,
      }])
      if (err) { setError('Errore nell\'invio.'); setSaving(false); return }
      await supabase.rpc('notify_absence_group', { p_group_id: groupId })
    } else {
      if (slots.length === 0) { setError('Aggiungi almeno uno slot.'); return }
      for (const slot of slots) {
        if (!slot.date) { setError('Inserisci una data per ogni riga.'); return }
        if (slot.slotType === 'personalizzata' && (!slot.customFrom || !slot.customTo)) {
          setError('Inserisci orario personalizzato per tutti gli slot.'); return
        }
      }
      setSaving(true)
      const groupId = crypto.randomUUID()
      const records = slots.map(s => slotToRecord(s, reason, profile.id, groupId))
      const { error: err } = await supabase.from('absences').insert(records)
      if (err) { setError('Errore nell\'invio.'); setSaving(false); return }
      await supabase.rpc('notify_absence_group', { p_group_id: groupId })
    }
    setSaving(false)
    setShowForm(false)
    resetForm()
    fetchAbsences()
  }

  async function cancelGroup(records) {
    const ids = records.map(r => r.id)
    await supabase.from('absences').delete().in('id', ids)
    setAbsences(p => p.filter(a => !ids.includes(a.id)))
  }

  const groups = groupAbsences(absences)

  return (
    <div className="px-4 py-6 flex flex-col gap-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold text-[#718096] uppercase tracking-wider">
            Ferie & Permessi
          </h2>
          <p className="text-[10px] text-[#a0aec0] mt-0.5 leading-relaxed">
            Le richieste vengono inviate al manager per approvazione.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setShowForm(v => !v); if (showForm) resetForm() }}
          className="shrink-0 text-xs font-semibold px-3 py-2 rounded-xl bg-[#1e3a5f] text-white
                     active:bg-[#152b47] transition-colors"
        >
          {showForm ? '× Annulla' : '+ Richiesta'}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-[#e2e8f0] p-4 flex flex-col gap-4 -mt-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#a0aec0]">
            Nuova richiesta
          </p>

          <div className="flex gap-2">
            {[['range', 'Periodo'], ['singoli', 'Giorni singoli']].map(([m, label]) => (
              <button key={m} type="button" onClick={() => { setMode(m); setError('') }}
                className={`flex-1 h-9 rounded-xl text-xs font-semibold transition-colors
                  ${mode === m ? 'bg-[#1e3a5f] text-white' : 'bg-[#f0f4f8] text-[#718096] active:bg-[#e2e8f0]'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'range' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-[#718096] block mb-1.5">
                    Da <span className="text-red-400">*</span>
                  </label>
                  <input type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)}
                    min={todayISO}
                    className="w-full h-11 px-3 rounded-xl border border-[#e2e8f0] bg-white text-sm
                               outline-none focus:border-[#1e3a5f] transition-colors" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-[#718096] block mb-1.5">
                    A <span className="text-red-400">*</span>
                  </label>
                  <input type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)}
                    min={rangeStart || todayISO}
                    className="w-full h-11 px-3 rounded-xl border border-[#e2e8f0] bg-white text-sm
                               outline-none focus:border-[#1e3a5f] transition-colors" />
                </div>
              </div>
              <p className="text-[11px] text-[#718096] -mt-2 flex items-center gap-1.5">
                <span className="inline-block w-4 h-4 rounded-full bg-[#eef2f7] text-center leading-4 text-[#1e3a5f] font-bold text-[9px]">i</span>
                Assenza per giorno intero sull'intero periodo.
              </p>
            </>
          )}

          {mode === 'singoli' && (
            <div className="flex flex-col gap-2">
              {slots.map((slot, idx) => (
                <div key={slot.id} className="bg-[#f8f9fa] rounded-2xl p-3 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-[#a0aec0] uppercase tracking-wide">
                      Slot {idx + 1}
                    </span>
                    {slots.length > 1 && (
                      <button type="button"
                        onClick={() => setSlots(prev => prev.filter(s => s.id !== slot.id))}
                        className="text-[10px] font-semibold text-red-400 active:text-red-600 transition-colors"
                      >
                        × Rimuovi
                      </button>
                    )}
                  </div>
                  <input type="date" value={slot.date}
                    onChange={e => updateSlot(slot.id, 'date', e.target.value)}
                    min={todayISO}
                    className="w-full h-11 px-3 rounded-xl border border-[#e2e8f0] bg-white text-sm
                               outline-none focus:border-[#1e3a5f] transition-colors appearance-auto" />
                  <div className="flex flex-wrap gap-1.5">
                    {['giorno_intero', 'mattina', 'pomeriggio', 'notte', 'personalizzata'].map(s => (
                      <button key={s} type="button"
                        onClick={() => updateSlot(slot.id, 'slotType', s)}
                        className={`h-7 px-2.5 rounded-full text-[11px] font-semibold transition-colors
                          ${slot.slotType === s
                            ? 'bg-[#1e3a5f] text-white'
                            : 'bg-white border border-[#e2e8f0] text-[#718096] active:bg-[#f0f4f8]'}`}
                      >
                        {SLOT_LABELS[s]}
                      </button>
                    ))}
                  </div>
                  {slot.slotType === 'personalizzata' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] font-semibold text-[#718096] block mb-1">Dalle</label>
                        <input type="time" value={slot.customFrom}
                          onChange={e => updateSlot(slot.id, 'customFrom', e.target.value)}
                          className="w-full h-9 px-3 rounded-xl border border-[#e2e8f0] bg-white text-sm
                                     outline-none focus:border-[#1e3a5f] transition-colors" />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-[#718096] block mb-1">Alle</label>
                        <input type="time" value={slot.customTo}
                          onChange={e => updateSlot(slot.id, 'customTo', e.target.value)}
                          className="w-full h-9 px-3 rounded-xl border border-[#e2e8f0] bg-white text-sm
                                     outline-none focus:border-[#1e3a5f] transition-colors" />
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <button type="button"
                onClick={() => {
                  const lastDate = slots[slots.length - 1]?.date
                  setSlots(prev => [...prev, makeSlot(nextDayISO(lastDate))])
                }}
                className="w-full h-10 rounded-xl border-2 border-dashed border-[#cbd5e0]
                           text-xs font-semibold text-[#718096] active:bg-[#f0f4f8] transition-colors"
              >
                + Aggiungi altro giorno
              </button>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-[#718096] block mb-1.5">
              Motivo <span className="font-normal text-[#a0aec0]">(opzionale)</span>
            </label>
            <input type="text" value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Es. Ferie estive, permesso personale…"
              className="w-full h-11 px-3 rounded-xl border border-[#e2e8f0] bg-white text-sm
                         outline-none focus:border-[#1e3a5f] transition-colors placeholder:text-[#a0aec0]" />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button type="button" disabled={saving} onClick={submit}
            className="w-full h-11 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                       active:bg-[#152b47] disabled:opacity-60 transition-colors"
          >
            {saving ? 'Invio in corso…' : 'Invia richiesta'}
          </button>
        </div>
      )}

      {/* Lista richieste */}
      {loading ? (
        <div className="flex flex-col gap-2 animate-pulse">
          {[1, 2].map(i => <div key={i} className="h-16 rounded-2xl bg-[#e2e8f0]" />)}
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center">
          <p className="text-4xl mb-3">🗓</p>
          <p className="font-semibold text-sm text-[#1a202c]">Nessuna richiesta inviata</p>
          <p className="text-xs text-[#a0aec0] mt-1">
            Usa "+ Richiesta" per inviare la tua prima richiesta.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map(records => {
            const sorted    = [...records].sort((a, b) => a.start_date.localeCompare(b.start_date))
            const status    = groupStatus(records)
            const cfg       = ABSENCE_STATUS_CFG[status] ?? ABSENCE_STATUS_CFG.pending
            const isPending = status === 'pending'
            const isFullDay = records[0].is_full_day !== false
            const allSameSlot = records.every(r => r.slot_type === records[0].slot_type)

            return (
              <div key={records[0].request_group_id ?? records[0].id}
                className={`bg-white rounded-2xl border p-4
                  ${isPending ? 'border-amber-200' : status === 'approved' ? 'border-green-200' : 'border-[#e2e8f0]'}`}
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: cfg.bg, color: cfg.text }}>
                        {cfg.label}
                      </span>
                      {isFullDay && (
                        <span className="text-[10px] font-semibold text-[#718096] bg-[#f0f4f8] px-2 py-0.5 rounded-full">
                          Giorno intero · {fmtAbsDate(sorted[0].start_date)}
                          {sorted[0].start_date !== sorted[0].end_date && (
                            <> → {fmtAbsDate(sorted[0].end_date)}</>
                          )}
                        </span>
                      )}
                      {!isFullDay && allSameSlot && (
                        <span className="text-[10px] font-semibold text-[#718096] bg-[#f0f4f8] px-2 py-0.5 rounded-full">
                          {SLOT_LABELS[records[0].slot_type] ?? records[0].slot_type}
                        </span>
                      )}
                      {!isFullDay && !allSameSlot && (
                        <span className="text-[10px] font-semibold text-[#718096] bg-[#f0f4f8] px-2 py-0.5 rounded-full">
                          {records.length} slot
                        </span>
                      )}
                    </div>
                    {!isFullDay && (
                      <div className="flex flex-col gap-1 mt-1">
                        {sorted.map(r => (
                          <p key={r.id} className="text-xs text-[#1a202c]">
                            <span className="font-semibold">{fmtDayShort(r.start_date)}</span>
                            <span className="text-[#718096]"> · {SLOT_LABELS[r.slot_type] ?? r.slot_type}
                              {r.slot_type === 'personalizzata' && r.start_time && r.end_time && (
                                <> ({r.start_time}–{r.end_time})</>
                              )}
                            </span>
                          </p>
                        ))}
                      </div>
                    )}
                    {records[0].reason && (
                      <p className="text-xs text-[#718096] mt-1.5">{records[0].reason}</p>
                    )}
                    {isPending && (
                      <p className="text-[10px] text-amber-600 mt-1">In attesa di risposta dal manager</p>
                    )}
                  </div>
                  {isPending && (
                    <button type="button" onClick={() => cancelGroup(records)}
                      className="shrink-0 text-[10px] font-semibold px-2.5 py-1.5 rounded-xl
                                 border border-[#e2e8f0] text-[#a0aec0]
                                 hover:text-red-400 hover:border-red-200 transition-colors"
                    >
                      Annulla
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
