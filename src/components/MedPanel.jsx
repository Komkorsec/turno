import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DUE_WINDOW = 30

function nowMinutes() {
  const n = new Date()
  return n.getHours() * 60 + n.getMinutes()
}
function toMin(t) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// Restituisce 'last' se oggi è l'ultimo giorno, 'soon' se scade entro 48h, null altrimenti
function expiryStatus(endDate) {
  if (!endDate) return null
  const todayISO = new Date().toISOString().slice(0, 10)
  if (endDate < todayISO) return null // già scaduto (filtrato prima)
  if (endDate === todayISO) return 'last'
  const diffDays = Math.round(
    (new Date(endDate + 'T00:00:00') - new Date(todayISO + 'T00:00:00')) / 86400000
  )
  return diffDays <= 2 ? 'soon' : null
}

function slotStatus(slot, logs, medicationId, confirmedKeys) {
  // Controlla prima il set locale delle somministrazioni appena registrate
  if (confirmedKeys.has(`${medicationId}-${slot}`)) {
    return { done: true, logStatus: 'given', notes: null, operator: null }
  }

  const slotMin = toMin(slot)
  const diffMin = nowMinutes() - slotMin

  // Cerca il log del giorno per questo farmaco entro 3 ore dallo slot
  // (finestra larga per coprire somministrazioni in ritardo)
  const log = logs.find(l =>
    l.medication_id === medicationId &&
    Math.abs(
      new Date(l.administered_at).getHours() * 60 +
      new Date(l.administered_at).getMinutes() - slotMin
    ) <= 180
  )

  if (log) return { done: true, logStatus: log.status, notes: log.notes, operator: log.operator?.full_name }
  if (diffMin >  DUE_WINDOW) return { done: false, state: 'overdue'  }
  if (diffMin >= -DUE_WINDOW) return { done: false, state: 'due_now'  }
  return                             { done: false, state: 'upcoming' }
}

// ─── Modal somministrazione pianificata ───────────────────────────────────────

function AdminModal({ item, slot, profile, onDone, onClose }) {
  const [status,         setStatus]         = useState('given')
  const [notes,          setNotes]          = useState('')
  const [saving,         setSaving]         = useState(false)
  const [error,          setError]          = useState('')
  const [showCompletion, setShowCompletion] = useState(false)

  const todayISO  = new Date().toISOString().slice(0, 10)
  const isLastDay = item.end_date === todayISO

  async function handleSave() {
    if (status === 'refused' && !notes.trim()) {
      setError('La nota è obbligatoria per un rifiuto.')
      return
    }
    setSaving(true)
    const administeredAt = new Date().toISOString()
    const { error: err } = await supabase.from('medication_logs').insert({
      medication_id:   item.id,
      operator_id:     profile.id,
      resident_id:     item.resident_id,
      administered_at: administeredAt,
      status,
      notes: notes.trim() || null,
    })
    if (err) { setError(err.message); setSaving(false); return }
    setSaving(false)

    const newLog = {
      medication_id:   item.id,
      resident_id:     item.resident_id,
      administered_at: administeredAt,
      status,
      notes:           notes.trim() || null,
      operator:        { full_name: profile.full_name },
    }

    if (status === 'given' && isLastDay) {
      setShowCompletion(true)
      setTimeout(() => onDone(newLog), 2800)
    } else {
      onDone(newLog)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={!showCompletion ? onClose : undefined} />
      <div className="relative w-full max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl">

        {showCompletion ? (
          /* ── Schermata di completamento terapia ── */
          <div className="px-6 py-10 flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-green-50 flex items-center justify-center text-3xl">
              🎉
            </div>
            <div>
              <p className="font-bold text-green-700 text-base leading-snug">Terapia completata!</p>
              <p className="text-sm text-[#718096] mt-2 leading-relaxed max-w-xs mx-auto">
                Ottimo, terapia completata come da piano terapeutico.
              </p>
            </div>
            <div className="w-full h-1 rounded-full bg-[#f0f4f8] overflow-hidden mt-2">
              <div className="h-full bg-green-400 rounded-full animate-[shrink_2.8s_linear_forwards]" />
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#f0f4f8]">
              <h3 className="font-bold text-[#1a202c] text-base">Registra somministrazione</h3>
              <button onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#f0f4f8] text-[#718096] text-lg">×</button>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4">
              <div className="bg-[#f8f9fa] rounded-xl px-4 py-3">
                <p className="font-bold text-sm text-[#1a202c]">
                  {item.resident.nome} {item.resident.cognome}
                </p>
                <p className="text-xs text-[#718096] mt-0.5">
                  {item.name}{item.dosage ? ` — ${item.dosage}` : ''}
                  <span className="ml-2 text-[#a0aec0]">ore {slot}</span>
                </p>
                {item.instructions && (
                  <p className="text-xs text-[#a0aec0] mt-1 italic">{item.instructions}</p>
                )}
                {/* Badge ultimo giorno nell'header del modal */}
                {isLastDay && (
                  <div className="mt-2 rounded-lg bg-red-50 border border-red-200 px-2.5 py-1.5 flex items-center gap-1.5">
                    <span className="text-xs font-bold text-red-600">⚠ Ultimo giorno di terapia</span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setStatus('given')}
                  className={`h-12 rounded-xl border-2 font-semibold text-sm transition-colors
                    ${status === 'given' ? 'bg-green-50 border-green-500 text-green-700' : 'bg-white border-[#e2e8f0] text-[#718096]'}`}>
                  ✓ Somministrato
                </button>
                <button type="button" onClick={() => setStatus('refused')}
                  className={`h-12 rounded-xl border-2 font-semibold text-sm transition-colors
                    ${status === 'refused' ? 'bg-red-50 border-red-500 text-red-700' : 'bg-white border-[#e2e8f0] text-[#718096]'}`}>
                  ✗ Rifiutato
                </button>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#718096] block mb-1.5">
                  Note {status === 'refused' && <span className="text-red-400">*</span>}
                </label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                  placeholder={status === 'refused' ? 'Motivo del rifiuto (obbligatorio)…' : 'Note aggiuntive opzionali…'}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e2e8f0] bg-white text-sm
                    text-[#1a202c] outline-none focus:border-[#1e3a5f] resize-none transition-colors" />
              </div>

              {error && <p className="text-xs text-red-500">{error}</p>}

              <div className="flex gap-2">
                <button type="button" onClick={onClose}
                  className="flex-1 h-11 rounded-xl border border-[#e2e8f0] text-sm font-semibold text-[#718096] active:bg-[#f8f9fa]">
                  Annulla
                </button>
                <button type="button" disabled={saving} onClick={handleSave}
                  className="flex-1 h-11 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                             active:bg-[#152b47] disabled:opacity-60 transition-colors">
                  {saving ? 'Salvataggio…' : 'Salva'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Modal somministrazione extra (testo libero, multi-riga) ─────────────────

function ExtraModal({ residents, profile, onDone, onClose }) {

  function blankRow() {
    return {
      residentId:  String(residents[0]?.id ?? ''),
      medName:     '',
      quantity:    '',
      notes:       '',
      status:      'given',
    }
  }

  const [rows,   setRows]   = useState([blankRow()])
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  function setField(i, field, value) {
    setRows(prev => prev.map((r, j) => j === i ? { ...r, [field]: value } : r))
  }
  function addRow()     { setRows(p => [...p, blankRow()]) }
  function removeRow(i) { setRows(p => p.filter((_, j) => j !== i)) }

  async function handleSave() {
    setError('')
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (!r.medName.trim())                         { setError(`Riga ${i+1}: inserisci il nome del farmaco.`); return }
      if (r.status === 'refused' && !r.notes.trim()) { setError(`Riga ${i+1}: nota obbligatoria per rifiuto.`); return }
    }
    setSaving(true)

    // Trova il resident_id dal profilo selezionato
    const residentById = residents.reduce((acc, r) => { acc[String(r.id)] = r; return acc }, {})

    for (const r of rows) {
      const parts = []
      if (r.quantity.trim()) parts.push(`Dose: ${r.quantity.trim()}`)
      if (r.notes.trim())    parts.push(r.notes.trim())

      const { error: err } = await supabase.from('medication_logs').insert({
        medication_id:   null,
        medication_name: r.medName.trim(),
        operator_id:     profile.id,
        resident_id:     Number(r.residentId),
        administered_at: new Date().toISOString(),
        status:          r.status,
        notes:           parts.join(' — ') || null,
      })
      if (err) { setError(err.message); setSaving(false); return }
    }

    setSaving(false)
    onDone()
  }

  const sel = `w-full h-10 px-2.5 rounded-xl border border-[#e2e8f0] bg-white text-xs
    text-[#1a202c] outline-none focus:border-[#1e3a5f] appearance-none transition-colors`
  const inp = `w-full h-10 px-2.5 rounded-xl border border-[#e2e8f0] bg-white text-xs
    text-[#1a202c] outline-none focus:border-[#1e3a5f] transition-colors`

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">

        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0 border-b border-[#f0f4f8]">
          <div>
            <h3 className="font-bold text-[#1a202c] text-base">Somministrazione extra</h3>
            <p className="text-xs text-[#a0aec0] mt-0.5">Inserisci liberamente farmaco e dose</p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#f0f4f8] text-[#718096] text-lg">×</button>
        </div>

        <div className="overflow-y-auto px-5 py-4 flex flex-col gap-3">
          {rows.map((r, i) => (
            <div key={i} className="rounded-2xl border border-[#e2e8f0] p-4 flex flex-col gap-3">

              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#a0aec0]">
                  Farmaco {i + 1}
                </span>
                {rows.length > 1 && (
                  <button type="button" onClick={() => removeRow(i)}
                    className="w-6 h-6 flex items-center justify-center rounded-lg
                               bg-[#fee2e2] text-red-500 text-sm font-bold leading-none">
                    ×
                  </button>
                )}
              </div>

              {/* Residente */}
              <div>
                <label className="text-[10px] font-semibold text-[#718096] block mb-1">Residente</label>
                <select value={r.residentId} onChange={e => setField(i, 'residentId', e.target.value)}
                  className={sel}>
                  {residents.map(res => (
                    <option key={res.id} value={res.id}>{res.nome} {res.cognome}</option>
                  ))}
                </select>
              </div>

              {/* Farmaco + Dose */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-semibold text-[#718096] block mb-1">
                    Nome farmaco <span className="text-red-400">*</span>
                  </label>
                  <input type="text" value={r.medName}
                    onChange={e => setField(i, 'medName', e.target.value)}
                    placeholder="es. Tachipirina" className={inp} />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-[#718096] block mb-1">Dose / Quantità</label>
                  <input type="text" value={r.quantity}
                    onChange={e => setField(i, 'quantity', e.target.value)}
                    placeholder="es. 500mg 2cp" className={inp} />
                </div>
              </div>

              {/* Esito */}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setField(i, 'status', 'given')}
                  className={`h-10 rounded-xl border-2 text-xs font-bold transition-colors
                    ${r.status === 'given'
                      ? 'bg-green-50 border-green-500 text-green-700'
                      : 'bg-white border-[#e2e8f0] text-[#718096]'}`}>
                  ✓ Somministrato
                </button>
                <button type="button" onClick={() => setField(i, 'status', 'refused')}
                  className={`h-10 rounded-xl border-2 text-xs font-bold transition-colors
                    ${r.status === 'refused'
                      ? 'bg-red-50 border-red-500 text-red-700'
                      : 'bg-white border-[#e2e8f0] text-[#718096]'}`}>
                  ✗ Rifiutato
                </button>
              </div>

              {/* Note */}
              <div>
                <label className="text-[10px] font-semibold text-[#718096] block mb-1">
                  Note {r.status === 'refused' && <span className="text-red-400">*</span>}
                </label>
                <input type="text" value={r.notes}
                  onChange={e => setField(i, 'notes', e.target.value)}
                  placeholder={r.status === 'refused' ? 'Motivo del rifiuto (obbligatorio)…' : 'Opzionali…'}
                  className={inp} />
              </div>
            </div>
          ))}

          <button type="button" onClick={addRow}
            className="w-full h-11 rounded-2xl border-2 border-dashed border-[#e2e8f0] text-sm
                       font-semibold text-[#718096] active:border-[#1e3a5f] active:text-[#1e3a5f] transition-colors">
            + Aggiungi farmaco
          </button>

          {error && <p className="text-xs text-red-500 px-1">{error}</p>}
        </div>

        <div className="shrink-0 px-5 py-4 border-t border-[#f0f4f8] flex gap-2">
          <button type="button" onClick={onClose}
            className="flex-1 h-11 rounded-xl border border-[#e2e8f0] text-sm font-semibold
                       text-[#718096] active:bg-[#f8f9fa] transition-colors">
            Annulla
          </button>
          <button type="button" disabled={saving} onClick={handleSave}
            className="flex-1 h-11 rounded-xl bg-[#065f46] text-white font-semibold text-sm
                       active:bg-[#064e3b] disabled:opacity-60 transition-colors">
            {saving ? 'Salvataggio…' : `Registra${rows.length > 1 ? ` (${rows.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Riga singolo farmaco ─────────────────────────────────────────────────────

function MedRow({ med, slot, st, onConfirm }) {
  const isGiven   = st.done && st.logStatus === 'given'
  const isRefused = st.done && st.logStatus === 'refused'
  const isPending = !st.done

  const rowBase = `flex items-center gap-3 px-4 py-3 transition-colors`
  const rowCls  = isGiven   ? `${rowBase} bg-green-50/50`
                : isRefused ? `${rowBase} bg-red-50/40`
                : `${rowBase} bg-orange-50/40 active:bg-orange-100/60 cursor-pointer`

  const iconCls = isGiven   ? 'bg-green-100 text-green-700'
                : isRefused ? 'bg-red-100 text-red-600'
                : 'bg-orange-100 text-orange-600'

  const iconChar = isGiven ? '✓' : isRefused ? '✗' : '!'

  return (
    <div
      className={rowCls}
      onClick={isPending ? () => onConfirm(med, slot) : undefined}
      role={isPending ? 'button' : undefined}
    >
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${iconCls}`}>
        {iconChar}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-[#1a202c] truncate">
          {med.resident.nome} {med.resident.cognome}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-xs text-[#718096] truncate">
            {med.name}{med.dosage ? ` — ${med.dosage}` : ''}
          </p>
          {expiryStatus(med.end_date) === 'last' && (
            <span className="shrink-0 text-[9px] font-bold bg-red-100 text-red-600
                             px-1.5 py-0.5 rounded-full leading-none whitespace-nowrap">
              Ultimo giorno
            </span>
          )}
          {expiryStatus(med.end_date) === 'soon' && (
            <span className="shrink-0 text-[9px] font-bold bg-orange-100 text-orange-600
                             px-1.5 py-0.5 rounded-full leading-none whitespace-nowrap">
              In scadenza
            </span>
          )}
        </div>
        {st.done && (st.operator || st.notes) && (
          <p className="text-[10px] text-[#a0aec0] mt-0.5 truncate">
            {st.operator && `Op: ${st.operator}`}{st.notes && ` · ${st.notes}`}
          </p>
        )}
      </div>

      {/* Badge stato — destra */}
      {isGiven && (
        <span className="shrink-0 text-[11px] font-bold text-green-700 bg-green-100
                         px-2.5 py-1 rounded-full leading-none whitespace-nowrap">
          ✓ Somministrato
        </span>
      )}
      {isRefused && (
        <span className="shrink-0 text-[11px] font-bold text-red-600 bg-red-100
                         px-2.5 py-1 rounded-full leading-none whitespace-nowrap">
          ✗ Rifiutato
        </span>
      )}
      {isPending && (
        <span className="shrink-0 text-[11px] font-bold text-orange-600 bg-orange-100
                         px-2.5 py-1 rounded-full leading-none whitespace-nowrap">
          Clicca per somministrare
        </span>
      )}
    </div>
  )
}

// ─── Pannello principale ──────────────────────────────────────────────────────

export default function MedPanel({ profile, onDiaryCreated }) {
  const [allMeds,    setAllMeds]    = useState([])
  const [residents,  setResidents]  = useState([])
  const [todayLogs,  setTodayLogs]  = useState([])
  const [loading,    setLoading]    = useState(true)
  const [confirming,    setConfirming]    = useState(null)
  const [showExtra,     setShowExtra]     = useState(false)
  const [collapsed,     setCollapsed]     = useState(false)
  const todayKey = `medConfirmed_${new Date().toISOString().slice(0, 10)}`
  const [confirmedKeys, setConfirmedKeys] = useState(() => {
    try {
      const stored = localStorage.getItem(todayKey)
      return stored ? new Set(JSON.parse(stored)) : new Set()
    } catch { return new Set() }
  })

  const load = useCallback(async () => {
    if (!profile?.structure_id) return
    setLoading(true)

    const { data: resData } = await supabase
      .from('residents')
      .select('id, nome, cognome')
      .eq('structure_id', profile.structure_id)
      .eq('is_archived', false)

    const resIds = (resData ?? []).map(r => r.id)
    setResidents(resData ?? [])
    if (!resIds.length) { setAllMeds([]); setLoading(false); return }

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const todayISO = new Date().toISOString().slice(0, 10)

    const [{ data: meds }, { data: logs }] = await Promise.all([
      supabase
        .from('resident_medications')
        .select('*, resident:residents!resident_id(id, nome, cognome)')
        .in('resident_id', resIds)
        .eq('is_active', true)
        .or(`end_date.is.null,end_date.gte.${todayISO}`),
      supabase
        .from('medication_logs')
        .select('*, operator:profiles!operator_id(full_name), resident:residents!resident_id(id, nome, cognome)')
        .in('resident_id', resIds)
        .gte('administered_at', todayStart.toISOString()),
    ])

    setAllMeds(meds ?? [])
    setTodayLogs(logs ?? [])
    setLoading(false)
  }, [profile?.structure_id])

  useEffect(() => { load() }, [load])

  // Realtime: aggiorna immediatamente quando qualsiasi operatore/coordinatore/manager
  // registra o modifica una somministrazione per questa struttura
  useEffect(() => {
    if (!profile?.structure_id) return
    const channel = supabase
      .channel(`med_logs_struct_${profile.structure_id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'medication_logs',
      }, () => {
        load().catch(() => {})
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile?.structure_id, load])

  // Polling di fallback ogni 5 minuti (copertura per eventi persi)
  useEffect(() => {
    const t = setInterval(() => {
      load().catch(() => {})
    }, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [load])

  if (loading) return null

  // Costruisce mappa slot → items (solo terapie pianificate)
  const slotMap = {}
  for (const med of allMeds) {
    for (const slot of (med.frequency ?? [])) {
      if (!slotMap[slot]) slotMap[slot] = []
      slotMap[slot].push({ med, st: slotStatus(slot, todayLogs, med.id, confirmedKeys) })
    }
  }
  const sortedSlots = Object.keys(slotMap).sort()

  const allItems     = Object.values(slotMap).flat()
  const doneCount    = allItems.filter(x => x.st.done).length
  const pendingCount = allItems.filter(x => !x.st.done && x.st.state !== 'upcoming').length

  // Log extra di oggi (farmaci non in terapia, aggiunti manualmente con +)
  const extraLogs = todayLogs.filter(l => l.medication_id === null)

  return (
    <div className="rounded-2xl overflow-hidden border border-[#e2e8f0] bg-white">

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-[#f8f9fa] border-b border-[#f0f4f8]">
        <button type="button" onClick={() => setCollapsed(v => !v)}
          className="flex-1 flex items-center gap-2.5 text-left">
          <span className="text-base leading-none">💊</span>
          <p className="text-sm font-bold text-[#1a202c]">Farmaci del giorno</p>
          {pendingCount > 0 && (
            <span className="text-[10px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded-full leading-none">
              {pendingCount} da fare
            </span>
          )}
          {pendingCount === 0 && doneCount > 0 && (
            <span className="text-[10px] font-bold bg-green-500 text-white px-1.5 py-0.5 rounded-full leading-none">
              ✓ Tutto fatto
            </span>
          )}
          <span className="text-[10px] text-[#a0aec0] font-medium">
            {doneCount}/{allItems.length}
            {extraLogs.length > 0 && ` · +${extraLogs.length} extra`}
          </span>
        </button>

        {/* Tasto + somministrazione extra */}
        <button type="button" onClick={() => setShowExtra(true)}
          className="w-7 h-7 flex items-center justify-center rounded-lg bg-[#eef2f7]
                     text-[#1e3a5f] text-base font-bold leading-none active:bg-[#e2e8f0] transition-colors shrink-0"
          title="Somministrazione extra">
          +
        </button>

        <svg onClick={() => setCollapsed(v => !v)}
          className={`w-4 h-4 text-[#718096] transition-transform cursor-pointer shrink-0 ${collapsed ? '' : 'rotate-180'}`}
          fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {!collapsed && (
        <div>
          {sortedSlots.length === 0 && (
            <div className="px-4 py-5 text-center">
              <p className="text-sm text-[#718096]">Nessuna terapia attiva.</p>
              <p className="text-xs text-[#a0aec0] mt-1">
                Usa <span className="font-bold text-[#1e3a5f]">+</span> per registrare una somministrazione non prevista.
              </p>
            </div>
          )}
          {sortedSlots.map(slot => {
            const items   = slotMap[slot]
            const diffMin = nowMinutes() - toMin(slot)
            const isNow   = Math.abs(diffMin) <= DUE_WINDOW
            const isPast  = diffMin > DUE_WINDOW

            return (
              <div key={slot} className="border-t border-[#f0f4f8]">
                <div className={`flex items-center gap-2 px-4 py-1.5 ${isNow ? 'bg-blue-50' : 'bg-[#fafafa]'}`}>
                  <span className={`text-xs font-black
                    ${isNow ? 'text-blue-700' : isPast ? 'text-[#718096]' : 'text-[#a0aec0]'}`}>
                    {slot}
                  </span>
                  {isNow && (
                    <span className="text-[9px] font-bold bg-blue-500 text-white px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                      Ora
                    </span>
                  )}
                  {isPast && !isNow && (
                    <span className="text-[9px] text-[#a0aec0] font-medium">Passato</span>
                  )}
                </div>

                <div className="divide-y divide-[#f8f9fa]">
                  {items.map(({ med, st }) => (
                    <MedRow key={`${med.id}-${slot}`} med={med} slot={slot} st={st}
                      onConfirm={(m, s) => setConfirming({ med: m, slot: s })} />
                  ))}
                </div>
              </div>
            )
          })}

          {/* ── Somministrazioni extra di oggi (farmaci non in terapia) ── */}
          {extraLogs.length > 0 && (
            <div className="border-t border-[#f0f4f8]">
              <div className="flex items-center gap-2 px-4 py-1.5 bg-[#fafafa]">
                <span className="text-xs font-black text-[#718096]">Extra</span>
                <span className="text-[9px] font-bold bg-purple-100 text-purple-700
                                 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                  Aggiunti manualmente
                </span>
              </div>
              <div className="divide-y divide-[#f8f9fa]">
                {extraLogs.map(log => {
                  const isGiven   = log.status === 'given'
                  const resName   = log.resident
                    ? `${log.resident.nome} ${log.resident.cognome}`
                    : '—'
                  const adminTime = new Date(log.administered_at)
                    .toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
                  return (
                    <div key={log.id} className={`flex items-center gap-3 px-4 py-3
                      ${isGiven ? 'bg-green-50/50' : 'bg-red-50/40'}`}>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center
                        shrink-0 text-xs font-bold
                        ${isGiven ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {isGiven ? '✓' : '✗'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-[#1a202c] truncate">{resName}</p>
                        <p className="text-xs text-[#718096] truncate">
                          {log.medication_name ?? '—'}
                          {log.notes ? ` — ${log.notes}` : ''}
                        </p>
                        <p className="text-[10px] text-[#a0aec0] mt-0.5">
                          {adminTime}
                          {log.operator?.full_name ? ` · ${log.operator.full_name}` : ''}
                        </p>
                      </div>
                      <span className={`shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full leading-none whitespace-nowrap
                        ${isGiven
                          ? 'text-green-700 bg-green-100'
                          : 'text-red-600 bg-red-100'}`}>
                        {isGiven ? '✓ Somministrato' : '✗ Rifiutato'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {confirming && (
        <AdminModal
          item={confirming.med}
          slot={confirming.slot}
          profile={profile}
          onDone={(newLog) => {
            setConfirming(null)
            // Segna immediatamente come somministrato nel Set locale
            setConfirmedKeys(prev => {
              const next = new Set([...prev, `${newLog.medication_id}-${confirming.slot}`])
              try { localStorage.setItem(todayKey, JSON.stringify([...next])) } catch {}
              return next
            })
            // Aggiorna anche todayLogs per coerenza
            setTodayLogs(prev => [...prev, newLog])
          }}
          onClose={() => setConfirming(null)}
        />
      )}

      {showExtra && (
        <ExtraModal
          residents={residents}
          profile={profile}
          onDone={() => { setShowExtra(false); load() }}
          onClose={() => setShowExtra(false)}
        />
      )}
    </div>
  )
}
