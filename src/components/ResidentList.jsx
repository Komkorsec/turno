import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import ResidentDetail from './ResidentDetail'
import { COUNTRIES, NATIONALITY_FLAGS } from '../lib/countries'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AVATAR_PALETTE = [
  ['#dbeafe', '#1d4ed8'],
  ['#d1fae5', '#065f46'],
  ['#fce7f3', '#9d174d'],
  ['#fef3c7', '#92400e'],
  ['#ede9fe', '#5b21b6'],
  ['#cffafe', '#164e63'],
  ['#fee2e2', '#991b1b'],
  ['#f3f4f6', '#374151'],
]

function avatarColors(cognome) {
  const code = (cognome || '').charCodeAt(0) || 0
  return AVATAR_PALETTE[code % AVATAR_PALETTE.length]
}

function initials(nome, cognome) {
  return `${(nome || '')[0] || ''}${(cognome || '')[0] || ''}`.toUpperCase()
}

function stayDuration(dataArrivo) {
  if (!dataArrivo) return null
  const now    = new Date()
  const start  = new Date(dataArrivo)
  const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  if (months < 1)  return 'Appena arrivato/a'
  if (months < 12) return `${months} mes${months === 1 ? 'e' : 'i'}`
  const years = Math.floor(months / 12)
  const rem   = months % 12
  if (rem === 0)   return `${years} ann${years === 1 ? 'o' : 'i'}`
  return `${years} ann${years === 1 ? 'o' : 'i'} e ${rem} mes${rem === 1 ? 'e' : 'i'}`
}

const CONTACT_TYPES = ['Tutore', 'Genitore', 'Assistente Sociale', 'Avvocato', 'Educatore', 'Altro']

const IDENTITY_TYPE_LABELS = {
  carta_identita:     "Carta d'Identità",
  passaporto:         'Passaporto',
  permesso_soggiorno: 'Permesso di Soggiorno',
  tessera_sanitaria:  'Tessera Sanitaria',
}

function fmtDateShort(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

function itemLabel(item) {
  if (item.source === 'identity_doc') return IDENTITY_TYPE_LABELS[item.tipo_item] ?? item.tipo_item
  return item.label_item || item.tipo_item
}

function sourceLabel(source) {
  if (source === 'document')     return 'Documento'
  if (source === 'legal_record') return 'Pratica legale'
  if (source === 'identity_doc') return 'Doc. identità'
  return ''
}

// ─── Pannello scadenze ────────────────────────────────────────────────────────

function ScadenzePanel({ items, onGoToResident }) {
  return (
    <div className="mx-4 mb-3 rounded-2xl border border-amber-200 bg-amber-50 overflow-hidden">
      <div className="px-4 pt-3 pb-3 flex flex-col gap-2">
        {items.map((item, i) => {
          const expired = item.days_remaining < 0
          const urgent  = item.days_remaining >= 0 && item.days_remaining <= 7
          const rowCls  = expired ? 'bg-red-50 border-red-100' : urgent ? 'bg-orange-50 border-orange-100' : 'bg-white border-[#e2e8f0]'
          const textCls = expired ? 'text-red-600' : urgent ? 'text-orange-600' : 'text-amber-700'
          const badge   = expired
            ? `Scaduto il ${fmtDateShort(item.data_scadenza)}`
            : item.days_remaining === 0
              ? 'Scade oggi'
              : `${item.days_remaining} giorn${item.days_remaining === 1 ? 'o' : 'i'}`

          return (
            <div key={i} className={`rounded-xl border px-3 py-2.5 flex items-center gap-3 ${rowCls}`}>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-[#1a202c] truncate">
                  {item.resident_nome} {item.resident_cognome}
                </p>
                <p className="text-[10px] text-[#718096] truncate mt-0.5">
                  <span className="font-semibold">{sourceLabel(item.source)}</span>
                  {' · '}{itemLabel(item)}
                </p>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-1.5">
                <span className={`text-[10px] font-bold ${textCls}`}>{badge}</span>
                <button type="button" onClick={() => onGoToResident(item.resident_id)}
                  className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-[#1e3a5f] text-white
                             active:bg-[#152b47] transition-colors whitespace-nowrap">
                  Vai alla scheda
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Card residente ────────────────────────────────────────────────────────────

function ResidentCard({ resident, canWrite, onArchive, onUnarchive, onDelete, onSelect, hasAlert }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [bg, text] = avatarColors(resident.cognome)
  const duration   = stayDuration(resident.data_arrivo)

  return (
    <div className="bg-white rounded-2xl border border-[#e2e8f0] overflow-hidden
                    active:bg-[#f8f9fa] transition-colors">
      {/* Riga principale cliccabile */}
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer"
        onClick={() => onSelect(resident)}>
        {/* Avatar */}
        <div className="relative shrink-0">
          {resident.foto_url ? (
            <img src={resident.foto_url} alt=""
              className="w-10 h-10 rounded-full object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-full flex items-center justify-center
                            font-bold text-sm shrink-0"
              style={{ backgroundColor: bg, color: text }}>
              {initials(resident.nome, resident.cognome)}
            </div>
          )}
          {hasAlert && (
            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500
                             border-2 border-white" />
          )}
        </div>

        {/* Nome + metadati */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[#1a202c] text-sm leading-tight truncate">
            {resident.nome} {resident.cognome}
          </p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {resident.nazionalita && (
              <span className="text-xs text-[#a0aec0]">{resident.nazionalita}</span>
            )}
            {duration && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#eef2f7]
                               text-[#1e3a5f] font-medium">
                📅 {duration}
              </span>
            )}
          </div>
        </div>

        {/* Freccia */}
        <svg className="w-4 h-4 text-[#a0aec0] shrink-0" fill="none" stroke="currentColor"
          strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>

      {/* Azioni archivio — solo per residenti archiviati */}
      {canWrite && resident.is_archived && (
        <div className="border-t border-[#f0f4f8] px-4 py-2">
          <div className="flex gap-2">
            <button type="button"
              onClick={e => { e.stopPropagation(); onUnarchive(resident.id) }}
              className="flex-1 text-xs font-semibold py-1.5 rounded-lg border border-[#e2e8f0]
                         text-[#718096] active:bg-[#f0f4f8] transition-colors">
              ↩ Riattiva
            </button>
            {!confirmDelete ? (
              <button type="button"
                onClick={e => { e.stopPropagation(); setConfirmDelete(true) }}
                className="flex-1 text-xs font-semibold py-1.5 rounded-lg border border-red-200
                           text-red-400 active:bg-red-50 transition-colors">
                🗑 Elimina
              </button>
            ) : (
              <div className="flex gap-1 flex-1" onClick={e => e.stopPropagation()}>
                <button type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 text-xs font-semibold py-1.5 rounded-lg border border-[#e2e8f0]
                             text-[#718096] transition-colors">
                  Annulla
                </button>
                <button type="button"
                  onClick={() => onDelete(resident)}
                  className="flex-1 text-xs font-semibold py-1.5 rounded-lg
                             bg-red-600 text-white active:bg-red-700 transition-colors">
                  Conferma
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Modal aggiunta residente ─────────────────────────────────────────────────

const EMPTY_CONTACT = { tipo: 'Tutore', nome: '', telefono: '', note: '' }

function AddResidentModal({ structureId, onSave, onClose }) {
  const [form, setForm] = useState({
    nome: '', cognome: '', data_nascita: '', nazionalita: '',
    data_arrivo: new Date().toISOString().slice(0, 10), data_partenza: '',
  })
  const [contacts, setContacts] = useState([])
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  function setField(k, v) { setForm(p => ({ ...p, [k]: v })) }
  function addContact()   { setContacts(p => [...p, { ...EMPTY_CONTACT }]) }
  function removeContact(i) { setContacts(p => p.filter((_, j) => j !== i)) }
  function setContact(i, k, v) {
    setContacts(p => p.map((c, j) => j === i ? { ...c, [k]: v } : c))
  }

  async function handleSave() {
    if (!form.nome.trim())    { setError('Il nome è obbligatorio.');    return }
    if (!form.cognome.trim()) { setError('Il cognome è obbligatorio.'); return }
    if (!form.data_arrivo)    { setError('La data di arrivo è obbligatoria.'); return }
    for (const c of contacts) {
      if (!c.nome.trim()) { setError('Inserisci il nome per tutti i contatti.'); return }
    }
    setSaving(true); setError('')

    const { data: resident, error: err } = await supabase
      .from('residents')
      .insert({
        structure_id:  structureId,
        nome:          form.nome.trim(),
        cognome:       form.cognome.trim(),
        data_nascita:  form.data_nascita  || null,
        nazionalita:   form.nazionalita.trim() || null,
        data_arrivo:   form.data_arrivo,
        data_partenza: form.data_partenza || null,
      })
      .select('id')
      .single()

    if (err) { setError('Errore nel salvataggio.'); setSaving(false); return }

    if (contacts.length > 0) {
      const rows = contacts.map(c => ({
        resident_id: resident.id,
        tipo:        c.tipo,
        nome:        c.nome.trim(),
        telefono:    c.telefono.trim() || null,
        note:        c.note.trim()     || null,
      }))
      await supabase.from('resident_contacts').insert(rows)
    }

    setSaving(false)
    onSave()
  }

  const inputCls = `w-full h-11 px-3 rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c] text-sm
    outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 transition-colors`

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl
                      flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0 border-b border-[#f0f4f8]">
          <h3 className="font-bold text-[#1a202c] text-base">Nuovo ragazzo</h3>
          <button type="button" onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#f0f4f8]
                       text-[#718096] text-lg leading-none">×</button>
        </div>

        {/* Body scrollabile */}
        <div className="overflow-y-auto px-6 py-5 flex flex-col gap-5">

          {/* ── Anagrafica ── */}
          <section>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#a0aec0] mb-3">
              Anagrafica
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-[#718096] block mb-1.5">
                  Nome <span className="text-red-400">*</span>
                </label>
                <input type="text" value={form.nome}
                  onChange={e => setField('nome', e.target.value)}
                  placeholder="Mario" className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#718096] block mb-1.5">
                  Cognome <span className="text-red-400">*</span>
                </label>
                <input type="text" value={form.cognome}
                  onChange={e => setField('cognome', e.target.value)}
                  placeholder="Rossi" className={inputCls} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="text-xs font-semibold text-[#718096] block mb-1.5">
                  Data di nascita
                </label>
                <input type="date" value={form.data_nascita}
                  onChange={e => setField('data_nascita', e.target.value)}
                  className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#718096] block mb-1.5">
                  Nazionalità
                </label>
                <div className="relative">
                  <input type="text" list="nazionalita-list" value={form.nazionalita}
                    onChange={e => setField('nazionalita', e.target.value)}
                    placeholder="Italiana"
                    className={`${inputCls} ${NATIONALITY_FLAGS[form.nazionalita] ? 'pr-10' : ''}`}
                    autoComplete="off" />
                  <datalist id="nazionalita-list">
                    {COUNTRIES.map(c => <option key={c} value={c} />)}
                  </datalist>
                  {NATIONALITY_FLAGS[form.nazionalita] && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xl pointer-events-none select-none">
                      {NATIONALITY_FLAGS[form.nazionalita]}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="text-xs font-semibold text-[#718096] block mb-1.5">
                  Data arrivo <span className="text-red-400">*</span>
                </label>
                <input type="date" value={form.data_arrivo}
                  onChange={e => setField('data_arrivo', e.target.value)}
                  className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#718096] block mb-1.5">
                  Data partenza
                </label>
                <input type="date" value={form.data_partenza}
                  onChange={e => setField('data_partenza', e.target.value)}
                  className={inputCls} />
              </div>
            </div>
          </section>

          {/* ── Contatti ── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#a0aec0]">
                Contatti di riferimento
              </p>
              <button type="button" onClick={addContact}
                className="text-xs font-semibold text-[#1e3a5f] hover:text-[#152b47] transition-colors">
                + Aggiungi
              </button>
            </div>
            {contacts.length === 0 ? (
              <p className="text-xs text-[#a0aec0] italic">Nessun contatto aggiunto.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {contacts.map((c, i) => (
                  <div key={i} className="rounded-xl border border-[#e2e8f0] p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <select value={c.tipo}
                        onChange={e => setContact(i, 'tipo', e.target.value)}
                        className="text-xs font-semibold text-[#1e3a5f] bg-transparent outline-none
                                   cursor-pointer">
                        {CONTACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <button type="button" onClick={() => removeContact(i)}
                        className="text-[#a0aec0] hover:text-red-400 transition-colors text-lg leading-none">
                        ×
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" placeholder="Nome *" value={c.nome}
                        onChange={e => setContact(i, 'nome', e.target.value)}
                        className="h-9 px-2.5 text-sm rounded-lg border border-[#e2e8f0] outline-none
                                   focus:border-[#1e3a5f] bg-white text-[#1a202c]" />
                      <input type="tel" placeholder="Telefono" value={c.telefono}
                        onChange={e => setContact(i, 'telefono', e.target.value)}
                        className="h-9 px-2.5 text-sm rounded-lg border border-[#e2e8f0] outline-none
                                   focus:border-[#1e3a5f] bg-white text-[#1a202c]" />
                    </div>
                    <input type="text" placeholder="Note (opzionale)" value={c.note}
                      onChange={e => setContact(i, 'note', e.target.value)}
                      className="h-9 w-full px-2.5 text-sm rounded-lg border border-[#e2e8f0] outline-none
                                 focus:border-[#1e3a5f] bg-white text-[#1a202c]" />
                  </div>
                ))}
              </div>
            )}
          </section>

          {error && <p className="text-xs text-red-500 -mt-1">{error}</p>}

          <button type="button" disabled={saving} onClick={handleSave}
            className="w-full h-12 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                       active:bg-[#152b47] disabled:opacity-60 transition-colors">
            {saving ? 'Salvataggio…' : 'Salva ragazzo'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Componente principale ────────────────────────────────────────────────────

export default function ResidentList({ structures, canWrite, canWriteDetail, defaultStructureId, defaultResidentId, onDeepLinkConsumed }) {
  const [structureId,      setStructureId]      = useState(defaultStructureId ?? structures[0]?.id ?? null)
  const [residents,        setResidents]        = useState([])
  const [loading,          setLoading]          = useState(false)
  const [showArchive,      setShowArchive]      = useState(false)
  const [showAdd,          setShowAdd]          = useState(false)
  const [error,            setError]            = useState('')
  const [selectedResident, setSelectedResident] = useState(null)
  const [expiringItems,    setExpiringItems]    = useState([])
  const [showAlerts,       setShowAlerts]       = useState(false)

  const fetchResidents = useCallback(async () => {
    if (!structureId) return
    setLoading(true); setError('')
    const { data, error: err } = await supabase
      .from('residents')
      .select('*')
      .eq('structure_id', structureId)
      .eq('is_archived', showArchive)
      .order('cognome')
    if (err) setError('Errore nel caricamento.')
    setResidents(data ?? [])
    setLoading(false)
  }, [structureId, showArchive])

  const fetchExpiringItems = useCallback(async () => {
    if (!structureId) return
    const { data } = await supabase.rpc('get_expiring_items', { p_structure_id: structureId })
    setExpiringItems(data ?? [])
  }, [structureId])

  useEffect(() => { fetchResidents() }, [fetchResidents])
  useEffect(() => { fetchExpiringItems() }, [fetchExpiringItems])

  // ── Deep-link: apri residente specifico dopo il caricamento ──────────────────
  useEffect(() => {
    if (!defaultResidentId || residents.length === 0) return
    const resident = residents.find(r => r.id === defaultResidentId)
    if (resident) {
      setSelectedResident(resident)
      onDeepLinkConsumed?.()
    } else {
      // Il residente potrebbe essere archiviato — caricalo direttamente
      supabase.from('residents').select('*').eq('id', defaultResidentId).single()
        .then(({ data }) => {
          if (data) { setSelectedResident(data); onDeepLinkConsumed?.() }
        })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [residents, defaultResidentId])

  const alertResidentIds = useMemo(
    () => new Set(expiringItems.map(i => i.resident_id)),
    [expiringItems]
  )

  async function handleArchive(id) {
    await supabase.from('residents').update({ is_archived: true }).eq('id', id)
    setResidents(p => p.filter(r => r.id !== id))
  }

  async function handleUnarchive(id) {
    await supabase.from('residents').update({ is_archived: false }).eq('id', id)
    setResidents(p => p.filter(r => r.id !== id))
  }

  async function handleDelete(resident) {
    const { data, error } = await supabase.rpc('hard_delete_resident', {
      p_resident_id: String(resident.id),
    })
    if (error || data?.error) {
      console.error('Errore eliminazione residente:', error?.message ?? data?.error)
      return
    }
    // Rimuovi file da Storage (i path vengono restituiti dalla RPC)
    const paths = data?.storage_paths ?? []
    if (paths.length > 0) {
      await supabase.storage.from('resident-documents').remove(paths)
    }
    setResidents(p => p.filter(r => r.id !== resident.id))
  }

  async function handleGoToResident(residentId) {
    let resident = residents.find(r => r.id === residentId)
    if (!resident) {
      const { data } = await supabase.from('residents').select('*').eq('id', residentId).single()
      resident = data
    }
    if (resident) { setShowAlerts(false); setSelectedResident(resident) }
  }

  const structure = structures.find(s => s.id === structureId)

  if (selectedResident) {
    return (
      <ResidentDetail
        resident={selectedResident}
        canWrite={canWriteDetail ?? canWrite}
        onBack={() => setSelectedResident(null)}
        onResidentUpdate={updated => {
          setSelectedResident(updated)
          setResidents(p => p.map(r => r.id === updated.id ? updated : r))
        }}
        onDischarged={() => {
          setSelectedResident(null)
          setShowArchive(true)
        }}
        onTransferred={() => {
          setSelectedResident(null)
          fetchResidents()
        }}
      />
    )
  }

  const expiredCount  = expiringItems.filter(i => i.days_remaining < 0).length
  const alertBadge    = expiringItems.length

  return (
    <div className="flex flex-col gap-0">

      {/* Selettore struttura (solo multi-struttura) */}
      {structures.length > 1 && (
        <div className="px-4 pt-4 pb-2">
          <select value={structureId ?? ''}
            onChange={e => setStructureId(Number(e.target.value))}
            className="w-full h-11 px-3 rounded-xl border border-[#e2e8f0] bg-white text-sm
                       outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                       transition-colors appearance-none text-[#1a202c]">
            {structures.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 px-4 py-4">
        <div>
          <h2 className="font-bold text-[#1a202c] text-base">
            {showArchive ? 'Archivio storico' : 'Residenti in struttura'}
          </h2>
          {!loading && (
            <p className="text-xs text-[#a0aec0] mt-0.5">
              {residents.length} resident{residents.length === 1 ? 'e' : 'i'}
              {structure?.name && structures.length > 1 ? ` · ${structure.name}` : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!showArchive && (
            <button type="button" onClick={() => setShowAlerts(v => !v)}
              className={`relative text-xs font-semibold px-3 py-2 rounded-xl border transition-colors
                ${showAlerts
                  ? 'bg-amber-500 text-white border-amber-500'
                  : alertBadge > 0
                    ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                    : 'bg-white text-[#718096] border-[#e2e8f0] hover:border-[#a0aec0]'}`}>
              ⚠
              <span className={`ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full
                ${showAlerts
                  ? 'bg-white/25 text-white'
                  : alertBadge > 0
                    ? 'bg-amber-200 text-amber-800'
                    : 'bg-[#f0f4f8] text-[#718096]'}`}>
                {alertBadge}
              </span>
              {expiredCount > 0 && !showAlerts && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 border border-white" />
              )}
            </button>
          )}
          <button type="button" onClick={() => setShowArchive(v => !v)}
            className={`text-xs font-semibold px-3 py-2 rounded-xl border transition-colors
              ${showArchive
                ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                : 'bg-white text-[#718096] border-[#e2e8f0] hover:border-[#1e3a5f] hover:text-[#1e3a5f]'}`}>
            {showArchive ? '← Attivi' : '📦 Archivio'}
          </button>
          {canWrite && !showArchive && (
            <button type="button" onClick={() => setShowAdd(true)}
              className="text-xs font-semibold px-3 py-2 rounded-xl bg-[#1e3a5f] text-white
                         active:bg-[#152b47] transition-colors">
              + Aggiungi
            </button>
          )}
        </div>
      </div>

      {/* Pannello scadenze imminenti */}
      {showAlerts && expiringItems.length > 0 && (
        <>
          <div className="mx-4 mb-1 flex items-center gap-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">
              Scadenze imminenti
            </p>
            <div className="flex-1 h-px bg-amber-200" />
            <button type="button" onClick={() => setShowAlerts(false)}
              className="text-[10px] text-[#a0aec0] hover:text-[#718096]">chiudi ×</button>
          </div>
          <ScadenzePanel items={expiringItems} onGoToResident={handleGoToResident} />
        </>
      )}

      {error && (
        <div className="mx-4 mb-2 px-3 py-2 rounded-xl bg-red-50 border border-red-100">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* Griglia */}
      <div className="px-4 pb-8">
        {loading ? (
          <div className="flex flex-col gap-2 animate-pulse">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-[#e2e8f0] rounded-2xl h-16" />
            ))}
          </div>
        ) : residents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-4xl mb-3">{showArchive ? '📦' : '🏠'}</p>
            <p className="font-semibold text-[#1a202c] text-sm">
              {showArchive ? 'Nessun residente archiviato' : 'Nessun residente presente'}
            </p>
            {!showArchive && canWrite && (
              <p className="text-xs text-[#a0aec0] mt-1.5">
                Usa il tasto "+ Aggiungi" per inserire il primo residente.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {residents.map(r => (
              <ResidentCard key={r.id} resident={r} canWrite={canWrite}
                onArchive={handleArchive} onUnarchive={handleUnarchive} onDelete={handleDelete}
                onSelect={setSelectedResident}
                hasAlert={alertResidentIds.has(r.id)} />
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <AddResidentModal
          structureId={structureId}
          onSave={() => { setShowAdd(false); fetchResidents() }}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  )
}
