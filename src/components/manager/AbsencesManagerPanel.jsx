import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function groupAbsences(absences) {
  const map = new Map()
  for (const abs of absences) {
    const key = abs.request_group_id ?? String(abs.absence_id)
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

export default function AbsencesManagerPanel({ profile, structures }) {
  const [absences,     setAbsences]     = useState([])
  const [structMap,    setStructMap]    = useState({})
  const [loading,      setLoading]      = useState(true)
  const [rpcError,     setRpcError]     = useState(null)
  const [filterStatus, setFilterStatus] = useState('pending')
  // groupKey → 'approving' | 'rejecting' | 'deleting' | 'done' | null
  const [groupBusy,    setGroupBusy]    = useState({})
  // Membri org per il selettore: [{ id, full_name, structureNames: string[] }]
  const [orgMembers,   setOrgMembers]   = useState([])
  // Form nuova assenza
  const [showAddForm,  setShowAddForm]  = useState(false)
  const [addForm,      setAddForm]      = useState({ user_id: '', start_date: '', end_date: '', reason: '' })
  const [addSaving,    setAddSaving]    = useState(false)
  const [addError,     setAddError]     = useState('')

  const loadAbsences = useCallback(async () => {
    setLoading(true)
    setRpcError(null)
    const { data, error } = await supabase.rpc('get_org_absences')
    if (error) {
      setRpcError(error.message)
      setAbsences([])
    } else {
      setAbsences(data ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    const sMap = Object.fromEntries(
      (structures ?? []).map(s => [s.id, s.name ?? `Struttura ${s.id}`])
    )
    setStructMap(sMap)
    loadAbsences()

    // Carica tutti i membri di tutte le strutture dell'org
    async function loadOrgMembers() {
      const ids = (structures ?? []).map(s => s.id)
      if (!ids.length) return
      const results = await Promise.all(
        ids.map(sid => supabase.rpc('get_team_members', { p_structure_id: sid }))
      )
      // Deduplica per id, raccogliendo i nomi delle strutture per ciascun membro
      const byId = {}
      results.forEach((res, i) => {
        const structName = sMap[ids[i]] ?? `Struttura ${ids[i]}`
        for (const m of res.data ?? []) {
          if (!byId[m.id]) byId[m.id] = { id: m.id, full_name: m.full_name, structureNames: [] }
          byId[m.id].structureNames.push(structName)
        }
      })
      // Metti il manager per primo, poi gli altri in ordine alfabetico
      const others = Object.values(byId)
        .filter(m => m.id !== profile.id)
        .sort((a, b) => a.full_name.localeCompare(b.full_name))
      setOrgMembers(others)
    }
    loadOrgMembers()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function updateGroupStatus(records, status, groupKey) {
    setGroupBusy(p => ({ ...p, [groupKey]: status === 'approved' ? 'approving' : 'rejecting' }))
    const ids = records.map(r => r.absence_id)
    const { error } = await supabase.rpc('update_absence_status', {
      p_ids:    ids,
      p_status: status,
    })
    if (error) {
      setRpcError('Errore aggiornamento: ' + error.message)
      setGroupBusy(p => ({ ...p, [groupKey]: null }))
      return
    }
    // Conferma visiva breve, poi aggiorna stato locale
    setGroupBusy(p => ({ ...p, [groupKey]: 'done' }))
    setAbsences(prev => prev.map(a => ids.includes(a.absence_id) ? { ...a, status } : a))
    setTimeout(() => setGroupBusy(p => ({ ...p, [groupKey]: null })), 1200)
  }

  async function deleteGroup(records, groupKey) {
    setGroupBusy(p => ({ ...p, [groupKey]: 'deleting' }))
    const ids = records.map(r => r.absence_id)
    const { error } = await supabase.from('absences').delete().in('id', ids)
    if (error) {
      setRpcError('Errore eliminazione: ' + error.message)
      setGroupBusy(p => ({ ...p, [groupKey]: null }))
      return
    }
    setAbsences(prev => prev.filter(a => !ids.includes(a.absence_id)))
    setGroupBusy(p => { const n = { ...p }; delete n[groupKey]; return n })
  }

  async function addManagerAbsence() {
    const targetId = addForm.user_id || profile.id
    if (!addForm.start_date || !addForm.end_date) {
      setAddError('Data inizio e data fine sono obbligatorie.'); return
    }
    if (addForm.end_date < addForm.start_date) {
      setAddError('La data fine non può essere prima della data inizio.'); return
    }
    setAddSaving(true); setAddError('')
    const { error } = await supabase.rpc('manager_add_absence', {
      p_user_id:    targetId,
      p_start_date: addForm.start_date,
      p_end_date:   addForm.end_date,
      p_reason:     addForm.reason.trim() || null,
    })
    if (error) { setAddError('Errore: ' + error.message); setAddSaving(false); return }
    setAddSaving(false)
    setShowAddForm(false)
    setAddForm({ user_id: '', start_date: '', end_date: '', reason: '' })
    loadAbsences()
  }

  const allGroups    = groupAbsences(absences)
  const pendingCount = allGroups.filter(g => groupStatus(g) === 'pending').length

  const visibleGroups = filterStatus === 'pending'
    ? allGroups.filter(g => groupStatus(g) === 'pending')
    : allGroups.filter(g => groupStatus(g) !== 'pending')

  return (
    <div className="flex flex-col gap-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold text-[#718096] uppercase tracking-wider">
            Gestione Ferie
          </h2>
          <p className="text-[10px] text-[#a0aec0] mt-0.5">
            Richieste di tutte le strutture della tua organizzazione.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {pendingCount > 0 && (
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-400 text-white leading-none">
              {pendingCount} in attesa
            </span>
          )}
          <button
            type="button"
            onClick={() => { setShowAddForm(v => !v); setAddError('') }}
            className="h-8 px-3 rounded-xl text-xs font-semibold bg-[#1e3a5f] text-white
                       active:bg-[#152b47] transition-colors"
          >
            {showAddForm ? '× Annulla' : '+ Aggiungi ferie'}
          </button>
        </div>
      </div>

      {/* Form nuova feria manager */}
      {showAddForm && (
        <div className="bg-[#f0f4f8] rounded-2xl p-4 flex flex-col gap-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[#718096]">
            Nuova assenza — approvata direttamente
          </p>
          {/* Selettore membro */}
          <div>
            <label className="text-[11px] font-semibold text-[#718096] block mb-1">Membro</label>
            <select
              value={addForm.user_id || profile.id}
              onChange={e => setAddForm(p => ({ ...p, user_id: e.target.value }))}
              className="w-full h-10 px-3 rounded-xl border border-[#e2e8f0] bg-white
                         text-sm outline-none focus:border-[#1e3a5f] transition-colors"
            >
              <option value={profile.id}>
                {profile.full_name ?? 'Io (Manager)'}
              </option>
              {orgMembers.map(m => (
                <option key={m.id} value={m.id}>
                  {m.full_name}{m.structureNames.length > 0 ? ` — ${m.structureNames.join(', ')}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-semibold text-[#718096] block mb-1">Data inizio</label>
              <input
                type="date"
                value={addForm.start_date}
                onChange={e => setAddForm(p => ({ ...p, start_date: e.target.value }))}
                className="w-full h-10 px-3 rounded-xl border border-[#e2e8f0] bg-white
                           text-sm outline-none focus:border-[#1e3a5f] transition-colors"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-[#718096] block mb-1">Data fine</label>
              <input
                type="date"
                value={addForm.end_date}
                min={addForm.start_date}
                onChange={e => setAddForm(p => ({ ...p, end_date: e.target.value }))}
                className="w-full h-10 px-3 rounded-xl border border-[#e2e8f0] bg-white
                           text-sm outline-none focus:border-[#1e3a5f] transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-[#718096] block mb-1">
              Motivo <span className="font-normal text-[#a0aec0]">(opz.)</span>
            </label>
            <input
              type="text"
              value={addForm.reason}
              onChange={e => setAddForm(p => ({ ...p, reason: e.target.value }))}
              placeholder="Ferie, permesso, malattia…"
              className="w-full h-10 px-3 rounded-xl border border-[#e2e8f0] bg-white
                         text-sm outline-none focus:border-[#1e3a5f] transition-colors
                         placeholder:text-[#a0aec0]"
            />
          </div>
          {addError && <p className="text-xs text-red-600">{addError}</p>}
          <button
            type="button"
            disabled={addSaving}
            onClick={addManagerAbsence}
            className="w-full h-10 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                       active:bg-[#152b47] disabled:opacity-60 transition-colors"
          >
            {addSaving ? 'Salvataggio…' : 'Salva assenza'}
          </button>
        </div>
      )}

      {/* Filter pills */}
      <div className="flex gap-2">
        {[['pending', 'In attesa'], ['history', 'Storico']].map(([val, label]) => (
          <button key={val} type="button" onClick={() => setFilterStatus(val)}
            className={`h-8 px-3 rounded-xl text-xs font-semibold transition-colors
              ${filterStatus === val
                ? 'bg-[#1e3a5f] text-white'
                : 'bg-white border border-[#e2e8f0] text-[#718096] active:bg-[#f0f4f8]'}`}
          >
            {label}
            {val === 'pending' && pendingCount > 0 && (
              <span className="ml-1.5 bg-amber-400 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Errore */}
      {rpcError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700">
          <p className="font-bold mb-0.5">Errore</p>
          <p className="font-mono break-all">{rpcError}</p>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex flex-col gap-2 animate-pulse">
          {[1, 2, 3].map(i => <div key={i} className="h-20 rounded-2xl bg-[#e2e8f0]" />)}
        </div>
      ) : visibleGroups.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center">
          <p className="text-4xl mb-3">🗓</p>
          <p className="font-semibold text-sm text-[#1a202c]">
            {filterStatus === 'pending' ? 'Nessuna richiesta in attesa' : 'Nessuno storico'}
          </p>
          <p className="text-xs text-[#a0aec0] mt-1">
            {filterStatus === 'pending'
              ? 'Tutte le richieste sono state gestite.'
              : 'Le richieste approvate e rifiutate appariranno qui.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visibleGroups.map(records => {
            const sorted    = [...records].sort((a, b) => a.start_date.localeCompare(b.start_date))
            const status    = groupStatus(records)
            const cfg       = ABSENCE_STATUS_CFG[status] ?? ABSENCE_STATUS_CFG.pending
            const isPending = status === 'pending'
            const isFullDay = records[0].is_full_day !== false
            const allSameSlot = records.every(r => r.slot_type === records[0].slot_type)
            const structName = structMap[records[0].primary_structure_id]
            const groupKey  = String(records[0].request_group_id ?? records[0].absence_id)
            const busy      = groupBusy[groupKey]

            return (
              <div key={groupKey}
                className={`bg-white rounded-2xl border p-4 transition-opacity
                  ${busy && busy !== 'done' ? 'opacity-60' : ''}
                  ${isPending ? 'border-amber-200' : status === 'approved' ? 'border-green-200' : 'border-[#e2e8f0]'}`}
              >
                {/* Employee + structure */}
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <p className="text-sm font-semibold text-[#1a202c] leading-tight">
                    {records[0].full_name ?? 'Operatore'}
                  </p>
                  {structName && (
                    <span className="text-[10px] font-semibold text-[#1e3a5f] bg-[#eef2f7] px-2 py-0.5 rounded-full">
                      {structName}
                    </span>
                  )}
                </div>

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
                          <p key={r.absence_id} className="text-xs text-[#1a202c]">
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
                      <p className="text-xs text-[#718096] mt-1.5 italic">"{records[0].reason}"</p>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {busy === 'done' && (
                      <span className="text-[10px] font-bold text-green-600 px-2 py-1">✓ Salvato</span>
                    )}
                    {busy && busy !== 'done' && (
                      <div className="w-5 h-5 rounded-full border-2 border-[#1e3a5f] border-t-transparent animate-spin mx-auto" />
                    )}
                    {!busy && isPending && (
                      <>
                        <button type="button"
                          onClick={() => updateGroupStatus(records, 'approved', groupKey)}
                          className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-lg
                                     bg-green-50 text-green-700 border border-green-200
                                     active:bg-green-100 transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          Approva
                        </button>
                        <button type="button"
                          onClick={() => updateGroupStatus(records, 'rejected', groupKey)}
                          className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-lg
                                     bg-red-50 text-red-600 border border-red-200
                                     active:bg-red-100 transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          Rifiuta
                        </button>
                      </>
                    )}
                    {!busy && !isPending && (
                      <button type="button"
                        onClick={() => deleteGroup(records, groupKey)}
                        className="text-[10px] font-semibold px-2.5 py-1.5 rounded-lg
                                   border border-[#e2e8f0] text-[#a0aec0]
                                   active:bg-[#f0f4f8] transition-colors"
                      >
                        Elimina
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
