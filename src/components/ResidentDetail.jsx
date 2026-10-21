import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { COUNTRIES, NATIONALITY_FLAGS } from '../lib/countries'

// ─── Helper download mobile-safe ─────────────────────────────────────────────
// window.open dopo await viene bloccato su Safari/Chrome mobile come popup.
// Soluzione: fetch del blob + <a download> creato programmaticamente.
async function mobileDownload(signedUrl, filename) {
  try {
    const res  = await fetch(signedUrl)
    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = filename || 'documento'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  } catch {
    // fallback: apri direttamente la signed URL
    window.open(signedUrl, '_blank', 'noopener')
  }
}

// ─── Costanti ──────────────────────────────────────────────────────────────────

// Tab 2 — Percorso Educativo
const DOC_CATEGORIES = [
  'Affido',
  'Documenti istituzionali',
  'Area sanitaria',
  'Area scolastica',
  'Area sportiva',
  'Relazioni e PEI',
  'Documenti personali',
  'Varie',
]

const CAT_COLORS = {
  'Affido':                  ['#fef3c7', '#92400e'],
  'Documenti istituzionali': ['#dbeafe', '#1d4ed8'],
  'Area sanitaria':          ['#fce7f3', '#9d174d'],
  'Area scolastica':         ['#d1fae5', '#065f46'],
  'Area sportiva':           ['#cffafe', '#164e63'],
  'Relazioni e PEI':         ['#ede9fe', '#5b21b6'],
  'Documenti personali':     ['#fee2e2', '#991b1b'],
  'Varie':                   ['#f3f4f6', '#374151'],
}

const FOLDERS = [
  { id: 'all',           icon: '📂', label: 'Tutti',               categories: null },
  { id: 'affido',        icon: '🏠', label: 'Affido',               categories: ['Affido'] },
  { id: 'istituzionali', icon: '🏛️', label: 'Doc. istituzionali',   categories: ['Documenti istituzionali'] },
  { id: 'sanitaria',     icon: '🏥', label: 'Area sanitaria',       categories: ['Area sanitaria'] },
  { id: 'scolastica',    icon: '🏫', label: 'Area scolastica',      categories: ['Area scolastica'] },
  { id: 'sportiva',      icon: '⚽', label: 'Area sportiva',        categories: ['Area sportiva'] },
  { id: 'relazioni',     icon: '📋', label: 'Relazioni e PEI',      categories: ['Relazioni e PEI'] },
  { id: 'personali',     icon: '👤', label: 'Doc. personali',       categories: ['Documenti personali'] },
  { id: 'varie',         icon: '📌', label: 'Varie',                categories: ['Varie'] },
]

const FOLDER_DEFAULT_CAT = {
  all: 'Varie', affido: 'Affido', istituzionali: 'Documenti istituzionali',
  sanitaria: 'Area sanitaria', scolastica: 'Area scolastica', sportiva: 'Area sportiva',
  relazioni: 'Relazioni e PEI', personali: 'Documenti personali', varie: 'Varie',
}

// Tab 3 — Documenti d'identità
const IDENTITY_TYPES = [
  { id: 'carta_identita',     label: "Carta d'Identità",     icon: '🪪', accent: '#1e3a5f' },
  { id: 'passaporto',         label: 'Passaporto',            icon: '📘', accent: '#5b21b6' },
  { id: 'permesso_soggiorno', label: 'Permesso di Soggiorno', icon: '📄', accent: '#065f46' },
  { id: 'tessera_sanitaria',  label: 'Tessera Sanitaria',     icon: '💳', accent: '#991b1b' },
]

// Tab 3 — Pratiche legali
const LEGAL_TYPES = [
  'Permesso di Soggiorno', 'Decreto del Tribunale', 'Affido Familiare',
  'Richiesta Asilo', 'Procedimento Penale', 'Tutela Legale',
  'Decreto di Espulsione', 'Altro',
]

const STATO_CFG = {
  in_corso:   { label: 'In corso',   bg: '#dbeafe', text: '#1d4ed8', dot: '#3b82f6' },
  completata: { label: 'Completata', bg: '#d1fae5', text: '#065f46', dot: '#22c55e' },
  urgente:    { label: '⚠ Urgente',  bg: '#fee2e2', text: '#991b1b', dot: '#ef4444' },
}

const AVATAR_PALETTE = [
  ['#dbeafe','#1d4ed8'],['#d1fae5','#065f46'],['#fce7f3','#9d174d'],
  ['#fef3c7','#92400e'],['#ede9fe','#5b21b6'],['#cffafe','#164e63'],
  ['#fee2e2','#991b1b'],['#f3f4f6','#374151'],
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

const avatarColors = c => AVATAR_PALETTE[(((c||'').charCodeAt(0))||0) % AVATAR_PALETTE.length]
const initials = (n,c) => `${(n||'')[0]||''}${(c||'')[0]||''}`.toUpperCase()

function calcAge(d) {
  if (!d) return null
  const t = new Date(), b = new Date(d)
  let a = t.getFullYear() - b.getFullYear()
  if (t.getMonth()-b.getMonth() < 0 || (t.getMonth()===b.getMonth() && t.getDate()<b.getDate())) a--
  return a
}
function fmtDate(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('it-IT', { day:'2-digit', month:'long', year:'numeric' })
}
function fmtDateShort(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('it-IT', { day:'2-digit', month:'short', year:'numeric' })
}
function fmtFileSize(b) {
  if (!b) return ''
  if (b<1024) return `${b} B`
  if (b<1048576) return `${Math.round(b/1024)} KB`
  return `${(b/1048576).toFixed(1)} MB`
}
function fileIcon(name='') {
  const e = name.split('.').pop().toLowerCase()
  if (e==='pdf') return '📄'
  if (['doc','docx'].includes(e)) return '📝'
  if (['jpg','jpeg','png','gif','webp'].includes(e)) return '🖼️'
  if (['xls','xlsx','csv'].includes(e)) return '📊'
  return '📎'
}
function daysToExpiry(dateStr) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000)
}

const inputCls = `w-full h-11 px-3 rounded-xl border border-[#e2e8f0] bg-white text-sm
  text-[#1a202c] outline-none focus:border-[#1e3a5f] appearance-none transition-colors`

// ─── UploadModal (documenti generali + allegati pratiche) ─────────────────────

function UploadModal({ resident, defaultCategoria='Altro', legalRecordId=null, onUploaded, onClose }) {
  const [file, setFile]               = useState(null)
  const [docName, setDocName]         = useState('')
  const [categoria, setCategoria]     = useState(defaultCategoria)
  const [dataScadenza, setDataScadenza] = useState('')
  const [uploading, setUploading]     = useState(false)
  const [error, setError]             = useState('')
  const inputRef          = useRef(null)
  const blockBackdropRef  = useRef(false)
  const safetyTimerRef    = useRef(null)

  function openFilePicker() {
    blockBackdropRef.current = true
    clearTimeout(safetyTimerRef.current)
    safetyTimerRef.current = setTimeout(() => { blockBackdropRef.current = false }, 5000)
    inputRef.current?.click()
  }

  function handleFileChange(e) {
    setFile(e.target.files?.[0] ?? null)
    setError('')
    clearTimeout(safetyTimerRef.current)
    setTimeout(() => { blockBackdropRef.current = false }, 500)
  }

  async function handleUpload() {
    if (!file) { setError('Seleziona un file.'); return }
    setUploading(true); setError('')
    const ext  = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
    const path = `${resident.structure_id}/${resident.id}/${crypto.randomUUID()}.${ext}`
    const { error: sErr } = await supabase.storage
      .from('resident-documents').upload(path, file, { upsert: false })
    if (sErr) { setError('Errore upload: ' + sErr.message); setUploading(false); return }
    const { data: { user } } = await supabase.auth.getUser()
    const displayName = docName.trim() || file.name
    const { error: dErr } = await supabase.from('resident_documents').insert({
      resident_id: resident.id, storage_path: path,
      original_name: displayName, categoria: legalRecordId ? 'Altro' : categoria,
      file_size: file.size, uploaded_by: user?.id ?? null, legal_record_id: legalRecordId,
      data_scadenza: dataScadenza || null,
    })
    if (dErr) {
      await supabase.storage.from('resident-documents').remove([path])
      setError('Errore salvataggio.'); setUploading(false); return
    }
    setUploading(false); onUploaded()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={() => { if (!blockBackdropRef.current) onClose() }} />
      <div className="relative w-full max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-[#1a202c] text-base">
            {legalRecordId ? 'Allega alla pratica' : 'Carica documento'}
          </h3>
          <button type="button" onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#f0f4f8] text-[#718096] text-lg">×</button>
        </div>
        <div>
          <input ref={inputRef} type="file" className="hidden"
            onChange={handleFileChange} />
          <button type="button" onClick={openFilePicker}
            className={`w-full rounded-xl border-2 border-dashed py-6 flex flex-col items-center gap-2 transition-colors
              ${file ? 'border-[#1e3a5f] bg-[#eef2f7]' : 'border-[#e2e8f0] hover:border-[#1e3a5f] bg-[#f8f9fa]'}`}>
            <span className="text-3xl">{file ? fileIcon(file.name) : '📎'}</span>
            <span className="text-sm font-medium text-[#1a202c] text-center px-4 break-all">
              {file ? file.name : 'Tocca per scegliere un file'}
            </span>
            {file && <span className="text-xs text-[#a0aec0]">{fmtFileSize(file.size)}</span>}
          </button>
        </div>
        <div>
          <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">
            Nome documento <span className="font-normal normal-case text-[#a0aec0]">(opzionale)</span>
          </label>
          <input
            type="text"
            value={docName}
            onChange={e => setDocName(e.target.value)}
            placeholder={file ? file.name : 'Es. PEI 2025-2026'}
            className={inputCls}
          />
        </div>
        {!legalRecordId && (
          <div>
            <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">Categoria</label>
            <select value={categoria} onChange={e => setCategoria(e.target.value)} className={inputCls}>
              {DOC_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">
            Data di scadenza <span className="font-normal normal-case text-[#a0aec0]">(opzionale)</span>
          </label>
          <input type="date" value={dataScadenza} onChange={e => setDataScadenza(e.target.value)}
            className={inputCls} />
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <button type="button" disabled={uploading||!file} onClick={handleUpload}
          className="w-full h-12 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                     active:bg-[#152b47] disabled:opacity-60 transition-colors">
          {uploading ? 'Caricamento…' : 'Carica documento'}
        </button>
      </div>
    </div>
  )
}

// ─── DocRow (riga file condivisa tra tab) ─────────────────────────────────────

function DocRow({ doc, canWrite, onDelete }) {
  const [downloading, setDownloading] = useState(false)
  const [downloadErr, setDownloadErr] = useState(false)
  const [catBg, catText] = CAT_COLORS[doc.categoria] ?? CAT_COLORS['Altro']
  async function handleDownload() {
    setDownloading(true)
    setDownloadErr(false)
    try {
      const { data, error } = await supabase.storage
        .from('resident-documents').createSignedUrl(doc.storage_path, 120)
      if (error || !data?.signedUrl) { setDownloadErr(true); return }
      await mobileDownload(data.signedUrl, doc.original_name)
    } catch {
      setDownloadErr(true)
    } finally {
      setDownloading(false)
    }
  }
  return (
    <div className="bg-white rounded-xl border border-[#e2e8f0] px-3 py-2.5 flex items-center gap-2.5">
      <span className="text-xl shrink-0 leading-none">{fileIcon(doc.original_name)}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-[#1a202c] truncate">{doc.original_name}</p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {!doc.legal_record_id && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: catBg, color: catText }}>{doc.categoria}</span>
          )}
          <span className="text-[9px] text-[#a0aec0]">
            {fmtDateShort(doc.created_at)}
            {doc.uploader?.full_name ? ` · ${doc.uploader.full_name}` : ''}
            {doc.file_size ? ` · ${fmtFileSize(doc.file_size)}` : ''}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button type="button" disabled={downloading} onClick={handleDownload} title={downloadErr ? 'Errore download — riprova' : 'Scarica'}
          className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors disabled:opacity-50
                     ${downloadErr ? 'bg-red-50 text-red-500 active:bg-red-100' : 'bg-[#eef2f7] text-[#1e3a5f] active:bg-[#dbeafe]'}`}>
          {downloading
            ? <span className="text-[9px] font-bold">…</span>
            : downloadErr
              ? <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>}
        </button>
        {canWrite && (
          <button type="button" onClick={() => onDelete(doc)} title="Elimina"
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-50
                       text-red-400 active:bg-red-100 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Phone button (shared) ────────────────────────────────────────────────────

function PhoneButton({ number }) {
  if (!number) return null
  return (
    <a href={`tel:${number}`}
      className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#eef2f7]
                 text-[#1e3a5f] text-xs font-semibold active:bg-[#dbeafe] transition-colors">
      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 7V5z" />
      </svg>
      {number}
    </a>
  )
}

// ─── Tab Profilo ───────────────────────────────────────────────────────────────

function ProfiloTab({ resident: residentProp, canWrite, onResidentUpdate, onDischarged, onTransferred }) {
  const { profile } = useAuth()
  const [resident,         setResident]         = useState(residentProp)
  const [contacts,         setContacts]         = useState([])
  const [contactsLoading,  setContactsLoading]  = useState(false)
  const [editing,          setEditing]          = useState(false)
  const [saving,           setSaving]           = useState(false)
  const [confirmDischarge, setConfirmDischarge] = useState(false)
  const [discharging,      setDischarging]      = useState(false)
  const [draft,            setDraft]            = useState({})
  const [draftContacts,    setDraftContacts]    = useState([])

  const [operativeNote,      setOperativeNote]      = useState(residentProp.operative_notes ?? '')
  const [operativeNoteSaving, setOperativeNoteSaving] = useState(false)
  const [operativeNoteSaved,  setOperativeNoteSaved]  = useState(false)

  // Trasferimento
  const canTransfer     = (profile?.role === 'manager' || profile?.role === 'admin_secondary') && !residentProp.is_archived
  const [showTransfer,    setShowTransfer]    = useState(false)
  const [orgStructures,   setOrgStructures]   = useState([])
  const [loadingStructs,  setLoadingStructs]  = useState(false)
  const [targetStructId,  setTargetStructId]  = useState('')
  const [transferring,    setTransferring]    = useState(false)

  // Sync local copy when parent passes a fresh resident (e.g. after archive toggle)
  useEffect(() => {
    setResident(residentProp)
    setOperativeNote(residentProp.operative_notes ?? '')
  }, [residentProp])

  const loadContacts = useCallback(async () => {
    setContactsLoading(true)
    const { data } = await supabase.from('resident_contacts').select('*')
      .eq('resident_id', residentProp.id).order('tipo')
    setContacts(data ?? [])
    setContactsLoading(false)
  }, [residentProp.id])

  useEffect(() => { loadContacts() }, [loadContacts])

  function startEdit() {
    setDraft({
      data_nascita:        resident.data_nascita        ?? '',
      nazionalita:         resident.nazionalita         ?? '',
      data_arrivo:         resident.data_arrivo         ?? '',
      telefono_residente:  resident.telefono_residente  ?? '',
    })
    setDraftContacts(contacts.map(c => ({ ...c })))
    setEditing(true)
  }

  async function handleSave() {
    setSaving(true)
    const updates = {
      data_nascita:       draft.data_nascita      || null,
      nazionalita:        draft.nazionalita        || null,
      data_arrivo:        draft.data_arrivo        || null,
      telefono_residente: draft.telefono_residente || null,
    }
    await supabase.from('residents').update(updates).eq('id', resident.id)

    // Contacts: delete removed, upsert remaining
    const originalIds = new Set(contacts.map(c => c.id))
    const keptIds     = new Set(draftContacts.filter(c => c.id).map(c => c.id))
    for (const id of originalIds) {
      if (!keptIds.has(id)) await supabase.from('resident_contacts').delete().eq('id', id)
    }
    for (const c of draftContacts) {
      const payload = { nome: c.nome || '', tipo: c.tipo || '', telefono: c.telefono || null, note: c.note || null }
      if (c.id) {
        await supabase.from('resident_contacts').update(payload).eq('id', c.id)
      } else {
        await supabase.from('resident_contacts').insert({ ...payload, resident_id: resident.id })
      }
    }

    const updated = { ...resident, ...updates }
    setResident(updated)
    onResidentUpdate?.(updated)
    await loadContacts()
    setSaving(false)
    setEditing(false)
  }

  async function handleSaveOperativeNote() {
    setOperativeNoteSaving(true)
    await supabase.from('residents').update({ operative_notes: operativeNote || null }).eq('id', resident.id)
    setOperativeNoteSaving(false)
    setOperativeNoteSaved(true)
    setTimeout(() => setOperativeNoteSaved(false), 2000)
  }

  async function handleDischarge() {
    setDischarging(true)
    const today = new Date().toISOString().slice(0, 10)
    await supabase.from('residents').update({ data_partenza: today, is_archived: true }).eq('id', resident.id)
    setDischarging(false)
    setConfirmDischarge(false)
    onDischarged?.()
  }

  async function openTransferPopup() {
    setShowTransfer(true)
    setTargetStructId('')
    setLoadingStructs(true)
    const { data } = await supabase
      .from('structures')
      .select('id, name')
      .eq('organization_id', profile.organization_id)
      .order('name')
    setOrgStructures(data ?? [])
    setLoadingStructs(false)
  }

  async function handleTransfer() {
    if (!targetStructId) return
    setTransferring(true)
    await supabase.from('residents')
      .update({ structure_id: Number(targetStructId) })
      .eq('id', resident.id)
    setTransferring(false)
    setShowTransfer(false)
    onTransferred?.()
  }

  const age = calcAge(resident.data_nascita)

  // ── Edit mode ──────────────────────────────────────────────────────────────
  if (editing) {
    return (
      <div className="flex flex-col gap-5 px-4 py-5">

        <section>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#a0aec0] mb-3">Anagrafica</p>
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs text-[#718096] mb-1 block">Data di nascita</label>
              <input type="date" value={draft.data_nascita}
                onChange={e => setDraft(d => ({ ...d, data_nascita: e.target.value }))}
                className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-[#718096] mb-1 block">Nazionalità</label>
              <div className="relative">
                <input type="text" list="nazionalita-list" value={draft.nazionalita}
                  onChange={e => setDraft(d => ({ ...d, nazionalita: e.target.value }))}
                  placeholder="es. Italiana"
                  className={`${inputCls} ${NATIONALITY_FLAGS[draft.nazionalita] ? 'pr-10' : ''}`}
                  autoComplete="off" />
                <datalist id="nazionalita-list">
                  {COUNTRIES.map(c => <option key={c} value={c} />)}
                </datalist>
                {NATIONALITY_FLAGS[draft.nazionalita] && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xl pointer-events-none select-none">
                    {NATIONALITY_FLAGS[draft.nazionalita]}
                  </span>
                )}
              </div>
            </div>
            <div>
              <label className="text-xs text-[#718096] mb-1 block">Data di arrivo</label>
              <input type="date" value={draft.data_arrivo}
                onChange={e => setDraft(d => ({ ...d, data_arrivo: e.target.value }))}
                className={inputCls} />
            </div>
          </div>
        </section>

        <section>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#a0aec0] mb-3">Contatto del Ragazzo</p>
          <div>
            <label className="text-xs text-[#718096] mb-1 block">Telefono Residente</label>
            <input type="tel" value={draft.telefono_residente}
              onChange={e => setDraft(d => ({ ...d, telefono_residente: e.target.value }))}
              placeholder="es. +39 333 1234567" className={inputCls} />
          </div>
        </section>

        <section>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#a0aec0] mb-3">Contatti di Riferimento (Tutore)</p>
          <div className="flex flex-col gap-3">
            {draftContacts.map((c, i) => (
              <div key={c.id ?? `new-${i}`} className="bg-white rounded-2xl border border-[#e2e8f0] p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-[#1e3a5f]">Contatto {i + 1}</p>
                  <button type="button"
                    onClick={() => setDraftContacts(d => d.filter((_, j) => j !== i))}
                    className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-1 rounded-lg active:bg-red-100">
                    Rimuovi
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  <input type="text" placeholder="Nome e cognome *" value={c.nome || ''}
                    onChange={e => setDraftContacts(d => d.map((x, j) => j === i ? { ...x, nome: e.target.value } : x))}
                    className={inputCls} />
                  <input type="text" placeholder="Tipo (es. Tutore, Genitore…)" value={c.tipo || ''}
                    onChange={e => setDraftContacts(d => d.map((x, j) => j === i ? { ...x, tipo: e.target.value } : x))}
                    className={inputCls} />
                  <input type="tel" placeholder="Telefono" value={c.telefono || ''}
                    onChange={e => setDraftContacts(d => d.map((x, j) => j === i ? { ...x, telefono: e.target.value } : x))}
                    className={inputCls} />
                  <input type="text" placeholder="Note" value={c.note || ''}
                    onChange={e => setDraftContacts(d => d.map((x, j) => j === i ? { ...x, note: e.target.value } : x))}
                    className={inputCls} />
                </div>
              </div>
            ))}
            <button type="button"
              onClick={() => setDraftContacts(d => [...d, { nome: '', tipo: '', telefono: '', note: '' }])}
              className="flex items-center justify-center gap-2 py-3 rounded-2xl border border-dashed
                         border-[#cbd5e0] text-sm font-semibold text-[#718096] active:bg-[#f0f4f8]">
              + Aggiungi contatto
            </button>
          </div>
        </section>

        <div className="flex gap-3 pb-4">
          <button type="button" onClick={() => setEditing(false)} disabled={saving}
            className="flex-1 h-11 rounded-xl border border-[#e2e8f0] bg-white text-sm font-semibold
                       text-[#718096] active:bg-[#f0f4f8] disabled:opacity-50 transition-colors">
            Annulla
          </button>
          <button type="button" onClick={handleSave} disabled={saving}
            className="flex-1 h-11 rounded-xl bg-[#1e3a5f] text-white text-sm font-semibold
                       active:bg-[#152b47] disabled:opacity-50 transition-colors">
            {saving ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </div>
    )
  }

  // ── View mode ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6 px-4 py-5">

      {/* Anagrafica */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#a0aec0]">Anagrafica</p>
          {canWrite && !resident.is_archived && (
            <button type="button" onClick={startEdit}
              className="text-[10px] font-bold text-[#1e3a5f] bg-[#eef2f7] px-2.5 py-1 rounded-lg
                         active:bg-[#dbeafe] transition-colors">
              Modifica
            </button>
          )}
        </div>
        <div className="bg-white rounded-2xl border border-[#e2e8f0] overflow-hidden divide-y divide-[#f0f4f8]">
          {[
            { label: 'Data di nascita',  value: resident.data_nascita ? `${fmtDate(resident.data_nascita)}${age !== null ? `  (${age} anni)` : ''}` : null },
            { label: 'Nazionalità',      value: resident.nazionalita ? `${NATIONALITY_FLAGS[resident.nazionalita] ?? ''} ${resident.nazionalita}`.trim() : null },
            { label: 'Data di arrivo',   value: fmtDate(resident.data_arrivo) },
            { label: 'Data di partenza', value: resident.data_partenza ? fmtDate(resident.data_partenza) : null, fallback: 'Ancora in struttura' },
          ].map(({ label, value, fallback }) => (
            <div key={label} className="flex items-start justify-between gap-4 px-4 py-3">
              <p className="text-xs text-[#718096] shrink-0 w-32">{label}</p>
              <p className={`text-xs font-medium text-right min-w-0 ${value ? 'text-[#1a202c]' : 'text-[#a0aec0] italic'}`}>
                {value || fallback || '—'}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Contatto del Ragazzo */}
      <section>
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#a0aec0] mb-3">Contatto del Ragazzo</p>
        <div className="bg-white rounded-2xl border border-[#e2e8f0] px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-[#718096] shrink-0">Telefono Residente</p>
          {resident.telefono_residente
            ? <PhoneButton number={resident.telefono_residente} />
            : <p className="text-xs text-[#a0aec0] italic">Non registrato</p>
          }
        </div>
      </section>

      {/* Contatti di Riferimento (Tutore) */}
      <section>
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#a0aec0] mb-3">
          Contatti di Riferimento (Tutore)
        </p>
        {contactsLoading ? (
          <div className="flex flex-col gap-2 animate-pulse">
            {[1, 2].map(i => <div key={i} className="h-16 rounded-2xl bg-[#e2e8f0]" />)}
          </div>
        ) : contacts.length === 0 ? (
          <p className="text-xs text-[#a0aec0] italic">Nessun contatto registrato.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {contacts.map(c => (
              <div key={c.id} className="bg-white rounded-2xl border border-[#e2e8f0] px-4 py-3
                                         flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-[#1e3a5f]
                                   bg-[#eef2f7] px-2 py-0.5 rounded-full">
                    {c.tipo}
                  </span>
                  <p className="font-semibold text-sm text-[#1a202c] mt-1.5 truncate">{c.nome}</p>
                  {c.note && <p className="text-xs text-[#718096] mt-0.5 truncate">{c.note}</p>}
                </div>
                <PhoneButton number={c.telefono} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Note operative */}
      <section>
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#a0aec0] mb-3">
          Note operative
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col gap-3">
          <p className="text-xs text-amber-700 leading-relaxed">
            Visibili a tutti gli operatori nel diario di bordo. Usa questo campo per indicare attenzioni quotidiane (igiene, alimentazione, comportamento, ecc.)
          </p>
          <textarea
            value={operativeNote}
            onChange={e => setOperativeNote(e.target.value)}
            readOnly={!canWrite}
            rows={3}
            placeholder={canWrite ? 'Es. Ricordare doccia serale dopo cena…' : 'Nessuna nota operativa.'}
            className="w-full text-sm text-[#1a202c] bg-white rounded-xl px-3 py-2.5
                       border border-amber-200 resize-none outline-none
                       focus:border-amber-400 focus:ring-2 focus:ring-amber-200
                       placeholder:text-[#a0aec0] leading-relaxed"
          />
          {canWrite && (
            <button onClick={handleSaveOperativeNote} disabled={operativeNoteSaving}
              className={`self-end text-xs font-semibold px-4 py-2 rounded-xl transition-colors
                ${operativeNoteSaved
                  ? 'bg-green-500 text-white'
                  : 'bg-amber-500 text-white active:bg-amber-600 disabled:opacity-60'}`}>
              {operativeNoteSaving ? 'Salvataggio…' : operativeNoteSaved ? '✓ Salvato' : 'Salva nota'}
            </button>
          )}
        </div>
      </section>

      {/* Trasferimento — solo coordinatore e manager */}
      {canTransfer && (
        <section className="pb-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#a0aec0] mb-3">
            Trasferimento
          </p>
          <button type="button" onClick={openTransferPopup}
            className="w-full h-11 rounded-xl border border-[#1e3a5f]/30 bg-[#eef2f7] text-[#1e3a5f]
                       text-sm font-semibold active:bg-[#dbeafe] transition-colors">
            Trasferisci ragazzo
          </button>
        </section>
      )}

      {/* Modale trasferimento */}
      {showTransfer && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40"
            onClick={() => { if (!transferring) setShowTransfer(false) }} />
          <div className="relative w-full max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl
                          px-5 pt-5 pb-8 flex flex-col gap-4" style={{ maxHeight: '85vh', overflowY: 'auto' }}>

            {/* Header */}
            <div className="flex items-center justify-between">
              <p className="text-base font-bold text-[#1a202c]">Trasferisci ragazzo</p>
              {!transferring && (
                <button type="button" onClick={() => setShowTransfer(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#f0f4f8]
                             text-[#718096] text-lg active:bg-[#e2e8f0] transition-colors">×</button>
              )}
            </div>

            {loadingStructs ? (
              <p className="text-sm text-[#a0aec0] text-center py-6">Caricamento strutture…</p>
            ) : orgStructures.length <= 1 ? (
              /* Scenario A: una sola struttura — azione bloccata */
              <>
                <div className="rounded-2xl bg-[#f8f9fa] border border-[#e2e8f0] px-4 py-4 flex flex-col gap-2">
                  <p className="text-sm font-semibold text-[#1a202c]">Trasferimento non disponibile</p>
                  <p className="text-xs text-[#718096] leading-relaxed">
                    Il trasferimento permette di spostare il profilo completo di un ragazzo — documenti,
                    pratiche, farmacologia e note — in un'altra comunità della stessa cooperativa,
                    mantenendo tutto intatto.
                  </p>
                  <p className="text-xs text-[#718096] leading-relaxed">
                    La tua cooperativa ha al momento una sola comunità attiva. Per effettuare un
                    trasferimento sono necessarie almeno due comunità attive.
                  </p>
                </div>
                <button type="button" onClick={() => setShowTransfer(false)}
                  className="w-full h-11 rounded-xl bg-[#1e3a5f] text-white text-sm font-semibold
                             active:bg-[#152b47] transition-colors">
                  Chiudi
                </button>
              </>
            ) : (
              /* Scenario B: più strutture — azione disponibile */
              <>
                <div className="rounded-2xl bg-[#f8f9fa] border border-[#e2e8f0] px-4 py-4 flex flex-col gap-2">
                  <p className="text-sm font-semibold text-[#1a202c]">Come funziona il trasferimento</p>
                  <p className="text-xs text-[#718096] leading-relaxed">
                    Stai per trasferire <strong className="text-[#1a202c]">{resident.nome} {resident.cognome}</strong> in
                    un'altra comunità. Tutti i dati — documenti, pratiche, farmacologia e note — verranno
                    mantenuti intatti. La comunità di provenienza non vedrà più il profilo.
                  </p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">
                    Struttura di destinazione
                  </label>
                  <select value={targetStructId} onChange={e => setTargetStructId(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl border border-[#e2e8f0] bg-white text-sm
                               outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                               transition-colors appearance-none text-[#1a202c]">
                    <option value="">Seleziona una struttura…</option>
                    {orgStructures
                      .filter(s => s.id !== resident.structure_id)
                      .map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>

                <div className="flex gap-2">
                  <button type="button" disabled={transferring} onClick={() => setShowTransfer(false)}
                    className="flex-1 h-11 rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c]
                               text-sm font-semibold active:bg-[#f0f4f8] disabled:opacity-50 transition-colors">
                    Annulla
                  </button>
                  <button type="button" disabled={transferring || !targetStructId} onClick={handleTransfer}
                    className="flex-1 h-11 rounded-xl bg-[#1e3a5f] text-white text-sm font-semibold
                               active:bg-[#152b47] disabled:opacity-50 transition-colors">
                    {transferring ? 'Trasferimento…' : 'Conferma'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Dimissioni */}
      {canWrite && !resident.is_archived && (
        <section className="pb-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#a0aec0] mb-3">
            Uscita dalla Struttura
          </p>
          {!confirmDischarge ? (
            <button type="button" onClick={() => setConfirmDischarge(true)}
              className="w-full h-11 rounded-xl border border-red-200 bg-red-50 text-red-600
                         text-sm font-semibold active:bg-red-100 transition-colors">
              Registra Partenza
            </button>
          ) : (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 flex flex-col gap-3">
              <p className="text-sm font-semibold text-red-700">
                Confermi la dimissione di {resident.nome}?
              </p>
              <p className="text-xs text-red-500 leading-relaxed">
                La data di partenza sarà impostata ad oggi e il residente verrà spostato
                nell'archivio. Puoi annullare l'azione dall'archivio.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirmDischarge(false)} disabled={discharging}
                  className="flex-1 h-10 rounded-xl border border-red-200 bg-white text-red-600
                             text-sm font-semibold active:bg-red-50 disabled:opacity-50 transition-colors">
                  Annulla
                </button>
                <button type="button" onClick={handleDischarge} disabled={discharging}
                  className="flex-1 h-10 rounded-xl bg-red-600 text-white text-sm font-semibold
                             active:bg-red-700 disabled:opacity-50 transition-colors">
                  {discharging ? 'Attendere…' : 'Conferma Partenza'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

// ─── Tab Percorso Educativo ────────────────────────────────────────────────────

function PercorsoEducativoTab({ resident, canWrite }) {
  const [folder, setFolder]       = useState('all')
  const [allDocs, setAllDocs]     = useState([])
  const [loading, setLoading]     = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [error, setError]         = useState('')

  // Note residente
  const [note, setNote]           = useState(resident.notes ?? '')
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteSaved, setNoteSaved] = useState(false)

  async function handleSaveNote() {
    setNoteSaving(true)
    await supabase.from('residents').update({ notes: note }).eq('id', resident.id)
    setNoteSaving(false)
    setNoteSaved(true)
    setTimeout(() => setNoteSaved(false), 2000)
  }

  const fetchDocs = useCallback(async () => {
    setLoading(true); setError('')
    const { data, error: err } = await supabase
      .from('resident_documents')
      .select('*, uploader:profiles!uploaded_by(full_name)')
      .eq('resident_id', resident.id)
      .is('legal_record_id', null)
      .order('created_at', { ascending: false })
    if (err) setError('Errore nel caricamento.')
    setAllDocs(data ?? [])
    setLoading(false)
  }, [resident.id])

  useEffect(() => { fetchDocs() }, [fetchDocs])

  async function handleDelete(doc) {
    await supabase.storage.from('resident-documents').remove([doc.storage_path])
    await supabase.from('resident_documents').delete().eq('id', doc.id)
    setAllDocs(p => p.filter(d => d.id !== doc.id))
  }

  const currentFolder = FOLDERS.find(f => f.id === folder)
  const filtered = currentFolder?.categories
    ? allDocs.filter(d => currentFolder.categories.includes(d.categoria))
    : allDocs

  return (
    <div className="flex flex-col gap-4 px-4 py-5">

      {/* Note residente */}
      <div className="bg-white rounded-2xl border border-[#e2e8f0] shadow-sm p-4 flex flex-col gap-3">
        <p className="text-xs font-bold text-[#1e3a5f] uppercase tracking-wide">Note residente</p>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          readOnly={!canWrite}
          rows={4}
          placeholder={canWrite ? 'Aggiungi note rapide su questo ragazzo...' : 'Nessuna nota.'}
          className="w-full text-sm text-[#1a202c] bg-[#f8f9fa] rounded-xl px-3 py-2.5
                     border border-[#e2e8f0] resize-none outline-none
                     focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/10
                     placeholder:text-[#a0aec0] leading-relaxed"
        />
        {canWrite && (
          <button onClick={handleSaveNote} disabled={noteSaving}
            className={`self-end text-xs font-semibold px-4 py-2 rounded-xl transition-colors
              ${noteSaved
                ? 'bg-green-500 text-white'
                : 'bg-[#1e3a5f] text-white active:bg-[#152b47]'}`}>
            {noteSaving ? 'Salvataggio…' : noteSaved ? 'Salvato!' : 'Salva note'}
          </button>
        )}
      </div>

      {/* Cartelle */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {FOLDERS.map(f => {
          const count = f.categories ? allDocs.filter(d => f.categories.includes(d.categoria)).length : allDocs.length
          return (
            <button key={f.id} type="button" onClick={() => setFolder(f.id)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold
                border transition-colors
                ${folder===f.id
                  ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                  : 'bg-white text-[#718096] border-[#e2e8f0] hover:border-[#1e3a5f] hover:text-[#1e3a5f]'}`}>
              <span>{f.icon}</span>
              {f.label}
              <span className={`text-[9px] font-bold px-1 rounded-full
                ${folder===f.id ? 'bg-white/20 text-white' : 'bg-[#f0f4f8] text-[#718096]'}`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-[#a0aec0]">
          {loading ? '…' : `${filtered.length} document${filtered.length===1?'o':'i'}`}
        </p>
        {canWrite && (
          <button type="button" onClick={() => setShowUpload(true)}
            className="text-xs font-semibold px-3 py-2 rounded-xl bg-[#1e3a5f] text-white
                       active:bg-[#152b47] transition-colors">
            + Carica
          </button>
        )}
      </div>

      {error && <div className="px-3 py-2 rounded-xl bg-red-50 border border-red-100">
        <p className="text-xs text-red-600">{error}</p></div>}

      {loading ? (
        <div className="flex flex-col gap-2 animate-pulse">
          {[1,2,3].map(i => <div key={i} className="h-14 rounded-xl bg-[#e2e8f0]" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center">
          <p className="text-3xl mb-2">{currentFolder?.icon ?? '📂'}</p>
          <p className="font-semibold text-sm text-[#1a202c]">
            Nessun documento{currentFolder?.categories ? ` in ${currentFolder.label}` : ''}
          </p>
          {canWrite && <p className="text-xs text-[#a0aec0] mt-1">Usa "+ Carica" per aggiungere il primo file.</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map(doc => (
            <DocRow key={doc.id} doc={doc} canWrite={canWrite} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {showUpload && (
        <UploadModal resident={resident} defaultCategoria={FOLDER_DEFAULT_CAT[folder]}
          onUploaded={() => { setShowUpload(false); fetchDocs() }}
          onClose={() => setShowUpload(false)} />
      )}
    </div>
  )
}

// ─── Modal documento identità ─────────────────────────────────────────────────

function IdentityDocModal({ resident, tipo, onSaved, onClose }) {
  const typeCfg = IDENTITY_TYPES.find(t => t.id === tipo)
  const [file,          setFile]          = useState(null)
  const [dataScadenza,  setDataScadenza]  = useState('')
  const [note,          setNote]          = useState('')
  const [uploading,     setUploading]     = useState(false)
  const [error,         setError]         = useState('')
  const inputRef = useRef(null)

  async function handleSave() {
    if (!file && !dataScadenza) {
      setError('Carica un file o inserisci almeno la data di scadenza.')
      return
    }
    setUploading(true); setError('')

    let storagePath = null
    let originalName = null
    let fileSize = null

    if (file) {
      const ext  = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
      const path = `${resident.structure_id}/${resident.id}/identity/${crypto.randomUUID()}.${ext}`
      const { error: sErr } = await supabase.storage
        .from('resident-documents').upload(path, file, { upsert: false })
      if (sErr) { setError('Errore upload: ' + sErr.message); setUploading(false); return }
      storagePath  = path
      originalName = file.name
      fileSize     = file.size
    }

    const { data: { user } } = await supabase.auth.getUser()
    const { error: dErr } = await supabase.from('resident_identity_docs').insert({
      resident_id:   resident.id,
      tipo,
      data_scadenza: dataScadenza || null,
      storage_path:  storagePath,
      original_name: originalName,
      file_size:     fileSize,
      note:          note.trim() || null,
      uploaded_by:   user?.id ?? null,
    })

    if (dErr) {
      if (storagePath) await supabase.storage.from('resident-documents').remove([storagePath])
      setError('Errore salvataggio.'); setUploading(false); return
    }
    setUploading(false); onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-[#1a202c] text-base">
            {typeCfg?.icon} {typeCfg?.label}
          </h3>
          <button type="button" onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#f0f4f8] text-[#718096] text-lg">×</button>
        </div>

        {/* File picker */}
        <div>
          <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">
            File (scansione / foto)
          </label>
          <input ref={inputRef} type="file" className="hidden"
            onChange={e => { setFile(e.target.files?.[0]??null); setError('') }} />
          <button type="button" onClick={() => inputRef.current?.click()}
            className={`w-full rounded-xl border-2 border-dashed py-5 flex flex-col items-center gap-1.5 transition-colors
              ${file ? 'border-[#1e3a5f] bg-[#eef2f7]' : 'border-[#e2e8f0] hover:border-[#1e3a5f] bg-[#f8f9fa]'}`}>
            <span className="text-2xl">{file ? fileIcon(file.name) : '📎'}</span>
            <span className="text-sm font-medium text-[#1a202c] text-center px-4 break-all">
              {file ? file.name : 'Tocca per scegliere un file'}
            </span>
            {file && <span className="text-xs text-[#a0aec0]">{fmtFileSize(file.size)}</span>}
          </button>
        </div>

        {/* Data scadenza */}
        <div>
          <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">
            Data di scadenza
          </label>
          <input type="date" value={dataScadenza} onChange={e => setDataScadenza(e.target.value)}
            className={inputCls} />
        </div>

        {/* Note */}
        <div>
          <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">
            Note (opzionale)
          </label>
          <input type="text" value={note} onChange={e => setNote(e.target.value)}
            placeholder="Es. In rinnovo, numero documento…" className={inputCls} />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <button type="button" disabled={uploading||(!file&&!dataScadenza)} onClick={handleSave}
          className="w-full h-12 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                     active:bg-[#152b47] disabled:opacity-60 transition-colors">
          {uploading ? 'Salvataggio…' : 'Salva documento'}
        </button>
      </div>
    </div>
  )
}

// ─── Card documento identità ──────────────────────────────────────────────────

function IdentityDocCard({ typeCfg, docs, canWrite, resident, onRefresh }) {
  const [showModal, setShowModal]     = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadErr, setDownloadErr] = useState(false)
  const latest = docs[0] ?? null
  const days   = daysToExpiry(latest?.data_scadenza)
  const expired     = days !== null && days < 0
  const expiringSoon = days !== null && days >= 0 && days <= 30

  async function handleDownload() {
    if (!latest?.storage_path) return
    setDownloading(true)
    setDownloadErr(false)
    try {
      const { data, error } = await supabase.storage
        .from('resident-documents').createSignedUrl(latest.storage_path, 120)
      if (error || !data?.signedUrl) { setDownloadErr(true); return }
      await mobileDownload(data.signedUrl, latest.original_name ?? latest.storage_path.split('/').pop())
    } catch {
      setDownloadErr(true)
    } finally {
      setDownloading(false)
    }
  }

  async function handleDeleteLatest() {
    if (!latest) return
    if (latest.storage_path)
      await supabase.storage.from('resident-documents').remove([latest.storage_path])
    await supabase.from('resident_identity_docs').delete().eq('id', latest.id)
    onRefresh()
  }

  // Status bar color
  const statusBar = expired ? 'bg-red-500'
    : expiringSoon           ? 'bg-amber-400'
    : latest                 ? 'bg-green-400'
    :                          'bg-[#e2e8f0]'

  return (
    <div className={`bg-white rounded-2xl border overflow-hidden
      ${expired ? 'border-red-200' : expiringSoon ? 'border-amber-200' : 'border-[#e2e8f0]'}`}>
      {/* Status accent line */}
      <div className={`h-1 w-full ${statusBar}`} />

      <div className="p-3 flex flex-col gap-2">
        {/* Header */}
        <div className="flex items-center gap-2">
          <span className="text-lg leading-none">{typeCfg.icon}</span>
          <p className="text-xs font-bold text-[#1a202c] leading-tight">{typeCfg.label}</p>
        </div>

        {/* Status */}
        {!latest ? (
          <p className="text-[10px] text-[#a0aec0] italic">Non registrato</p>
        ) : (
          <div className="flex flex-col gap-1">
            {/* Expiry */}
            {latest.data_scadenza && (
              <div className={`flex items-center gap-1 text-[10px] font-semibold rounded-lg px-2 py-1
                ${expired ? 'bg-red-50 text-red-600'
                  : expiringSoon ? 'bg-amber-50 text-amber-700'
                  : 'bg-[#f0fdf4] text-green-700'}`}>
                {expired   ? '⚠ Scaduto il '
                  : expiringSoon ? `⚠ Scade in ${days} giorn${days===1?'o':'i'} — `
                  : '✓ Scadenza: '}
                {fmtDateShort(latest.data_scadenza)}
              </div>
            )}
            {/* Note */}
            {latest.note && (
              <p className="text-[10px] text-[#718096] truncate">{latest.note}</p>
            )}
            {/* File */}
            {latest.storage_path && (
              <p className="text-[10px] text-[#a0aec0] truncate">
                {fileIcon(latest.original_name)} {latest.original_name}
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1.5 pt-1 border-t border-[#f0f4f8]">
          {latest?.storage_path && (
            <button type="button" disabled={downloading} onClick={handleDownload}
              className={`flex-1 flex items-center justify-center gap-1 text-[10px] font-semibold
                         py-1.5 rounded-lg transition-colors disabled:opacity-50
                         ${downloadErr ? 'bg-red-50 text-red-500 active:bg-red-100' : 'bg-[#eef2f7] text-[#1e3a5f] active:bg-[#dbeafe]'}`}>
              {downloading ? '…' : downloadErr ? <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                Errore
              </> : <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Scarica
              </>}
            </button>
          )}
          {canWrite && (
            <>
              <button type="button" onClick={() => setShowModal(true)}
                className="flex-1 text-[10px] font-semibold py-1.5 rounded-lg
                           bg-[#1e3a5f] text-white active:bg-[#152b47] transition-colors">
                {latest ? 'Aggiorna' : '+ Aggiungi'}
              </button>
              {latest && (
                <button type="button" onClick={handleDeleteLatest}
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-50
                             text-red-400 active:bg-red-100 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {showModal && (
        <IdentityDocModal resident={resident} tipo={typeCfg.id}
          onSaved={() => { setShowModal(false); onRefresh() }}
          onClose={() => setShowModal(false)} />
      )}
    </div>
  )
}

// ─── Modal pratica legale ──────────────────────────────────────────────────────

function LegalRecordModal({ resident, record, onSave, onClose }) {
  const isEdit = !!record
  const [form, setForm] = useState({
    tipo_pratica:  record?.tipo_pratica  ?? '',
    data_apertura: record?.data_apertura ?? new Date().toISOString().slice(0, 10),
    stato:         record?.stato         ?? 'in_corso',
    data_scadenza: record?.data_scadenza ?? '',
    note:          record?.note          ?? '',
  })
  const [customTipo, setCustomTipo] = useState(
    record?.tipo_pratica && !LEGAL_TYPES.includes(record.tipo_pratica) ? record.tipo_pratica : ''
  )
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const set = (k,v) => setForm(p=>({...p,[k]:v}))

  async function handleSave() {
    const tipo = form.tipo_pratica==='custom' ? customTipo.trim() : form.tipo_pratica
    if (!tipo)             { setError('Seleziona o inserisci il tipo di pratica.'); return }
    if (!form.data_apertura) { setError('Inserisci la data di apertura.'); return }
    setSaving(true); setError('')
    const payload = {
      tipo_pratica: tipo, data_apertura: form.data_apertura,
      stato: form.stato, note: form.note.trim()||null,
      data_scadenza: form.data_scadenza || null,
    }
    if (isEdit) {
      const { error: err } = await supabase.from('resident_legal_records').update(payload).eq('id', record.id)
      if (err) { setError('Errore nel salvataggio.'); setSaving(false); return }
    } else {
      const { data: { user } } = await supabase.auth.getUser()
      const { error: err } = await supabase.from('resident_legal_records')
        .insert({ ...payload, resident_id: resident.id, created_by: user?.id??null })
      if (err) { setError('Errore nel salvataggio.'); setSaving(false); return }
    }
    setSaving(false); onSave()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0 border-b border-[#f0f4f8]">
          <h3 className="font-bold text-[#1a202c] text-base">{isEdit ? 'Modifica pratica' : 'Nuova pratica legale'}</h3>
          <button type="button" onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#f0f4f8] text-[#718096] text-lg">×</button>
        </div>
        <div className="overflow-y-auto px-6 py-5 flex flex-col gap-4">
          <div>
            <label className="text-xs font-semibold text-[#718096] block mb-1.5">Tipo di pratica</label>
            <select
              value={LEGAL_TYPES.includes(form.tipo_pratica) ? form.tipo_pratica : (form.tipo_pratica?'custom':'')}
              onChange={e => e.target.value==='custom' ? set('tipo_pratica','custom') : set('tipo_pratica',e.target.value)}
              className={inputCls}>
              <option value="">Seleziona…</option>
              {LEGAL_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
              <option value="custom">Altro (personalizzato)</option>
            </select>
          </div>
          {(form.tipo_pratica==='custom'||(!LEGAL_TYPES.includes(form.tipo_pratica)&&form.tipo_pratica)) && (
            <div>
              <label className="text-xs font-semibold text-[#718096] block mb-1.5">Descrizione</label>
              <input type="text" value={customTipo} onChange={e=>setCustomTipo(e.target.value)}
                placeholder="Es. Ricongiungimento familiare…" className={inputCls} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#718096] block mb-1.5">Data apertura</label>
              <input type="date" value={form.data_apertura} onChange={e=>set('data_apertura',e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#718096] block mb-1.5">Stato</label>
              <select value={form.stato} onChange={e=>set('stato',e.target.value)} className={inputCls}>
                {Object.entries(STATO_CFG).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-[#718096] block mb-1.5">
              Data di scadenza <span className="font-normal text-[#a0aec0]">(opzionale)</span>
            </label>
            <input type="date" value={form.data_scadenza} onChange={e=>set('data_scadenza',e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#718096] block mb-1.5">Note</label>
            <textarea value={form.note} onChange={e=>set('note',e.target.value)}
              placeholder="Scadenze, riferimenti, aggiornamenti…" rows={3}
              className="w-full px-3 py-2.5 rounded-xl border border-[#e2e8f0] bg-white text-sm
                         text-[#1a202c] outline-none focus:border-[#1e3a5f] resize-none transition-colors" />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button type="button" disabled={saving} onClick={handleSave}
            className="w-full h-12 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                       active:bg-[#152b47] disabled:opacity-60 transition-colors">
            {saving ? 'Salvataggio…' : isEdit ? 'Salva modifiche' : 'Crea pratica'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Card pratica legale ──────────────────────────────────────────────────────

function LegalRecordCard({ record, canWrite, resident, onEdit, onDelete, onDocDeleted, onDocUploaded }) {
  const stato = STATO_CFG[record.stato] ?? STATO_CFG.in_corso
  const [showAttach, setShowAttach] = useState(false)

  async function handleDocDelete(doc) {
    if (doc.storage_path) await supabase.storage.from('resident-documents').remove([doc.storage_path])
    await supabase.from('resident_documents').delete().eq('id', doc.id)
    onDocDeleted(record.id, doc.id)
  }

  return (
    <div className="bg-white rounded-2xl border border-[#e2e8f0] p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-[#1a202c] text-sm leading-snug">{record.tipo_pratica}</p>
          <p className="text-xs text-[#a0aec0] mt-0.5">Aperto il {fmtDateShort(record.data_apertura)}</p>
          {record.creator?.full_name && (
            <p className="text-[10px] text-[#a0aec0] mt-0.5">
              Inserito da {record.creator.full_name}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: stato.bg, color: stato.text }}>{stato.label}</span>
          {canWrite && (
            <>
              <button type="button" onClick={() => onEdit(record)}
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-[#f0f4f8]
                           text-[#718096] active:bg-[#e2e8f0] transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button type="button" onClick={() => onDelete(record)}
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-50
                           text-red-400 active:bg-red-100 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>
      {record.note && (
        <p className="text-xs text-[#718096] bg-[#f8f9fa] rounded-xl px-3 py-2 leading-relaxed">{record.note}</p>
      )}
      {(record.documents?.length > 0 || canWrite) && (
        <div className="border-t border-[#f0f4f8] pt-3 flex flex-col gap-2">
          {record.documents?.map(doc => (
            <DocRow key={doc.id} doc={doc} canWrite={canWrite} onDelete={() => handleDocDelete(doc)} />
          ))}
          {canWrite && (
            <button type="button" onClick={() => setShowAttach(true)}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-[#1e3a5f]
                         hover:text-[#152b47] transition-colors self-start">
              <span className="text-base leading-none">📎</span>Allega documento
            </button>
          )}
        </div>
      )}
      {showAttach && (
        <UploadModal resident={resident} legalRecordId={record.id}
          onUploaded={() => { setShowAttach(false); onDocUploaded() }}
          onClose={() => setShowAttach(false)} />
      )}
    </div>
  )
}

// ─── Tab Documenti e Pratiche Legali ──────────────────────────────────────────

function DocumPraticheTab({ resident, canWrite }) {
  // ── Documenti identità ──────────────────────────────────────────────────────
  const [identityDocs, setIdentityDocs] = useState([])
  const [idLoading,    setIdLoading]    = useState(false)

  const fetchIdentityDocs = useCallback(async () => {
    setIdLoading(true)
    const { data } = await supabase
      .from('resident_identity_docs')
      .select('*')
      .eq('resident_id', resident.id)
      .order('created_at', { ascending: false })
    setIdentityDocs(data ?? [])
    setIdLoading(false)
  }, [resident.id])

  useEffect(() => { fetchIdentityDocs() }, [fetchIdentityDocs])

  // Per ogni tipo: lista di docs ordinata per data desc
  function docsForType(tipoId) {
    return identityDocs.filter(d => d.tipo === tipoId)
  }

  // Alert: almeno un doc in scadenza o scaduto?
  const alertCount = IDENTITY_TYPES.filter(t => {
    const latest = docsForType(t.id)[0]
    if (!latest?.data_scadenza) return false
    const d = daysToExpiry(latest.data_scadenza)
    return d !== null && d <= 30
  }).length

  // ── Pratiche legali ─────────────────────────────────────────────────────────
  const [records,    setRecords]    = useState([])
  const [legLoading, setLegLoading] = useState(false)
  const [editRecord, setEditRecord] = useState(undefined)
  const [legError,   setLegError]   = useState('')

  const fetchRecords = useCallback(async () => {
    setLegLoading(true); setLegError('')
    const { data, error: err } = await supabase
      .from('resident_legal_records')
      .select(`*, creator:profiles!created_by(full_name), documents:resident_documents(*, uploader:profiles!uploaded_by(full_name))`)
      .eq('resident_id', resident.id)
      .order('data_apertura', { ascending: false })
    if (err) setLegError('Errore nel caricamento pratiche.')
    setRecords(data ?? [])
    setLegLoading(false)
  }, [resident.id])

  useEffect(() => { fetchRecords() }, [fetchRecords])

  async function handleDeleteRecord(record) {
    const paths = (record.documents ?? []).map(d => d.storage_path).filter(Boolean)
    if (paths.length) await supabase.storage.from('resident-documents').remove(paths)
    await supabase.from('resident_legal_records').delete().eq('id', record.id)
    setRecords(p => p.filter(r => r.id !== record.id))
  }

  function handleDocDeleted(recordId, docId) {
    setRecords(p => p.map(r =>
      r.id===recordId ? { ...r, documents: r.documents.filter(d=>d.id!==docId) } : r
    ))
  }

  const statoGroups = [
    { stato: 'urgente',    recs: records.filter(r=>r.stato==='urgente') },
    { stato: 'in_corso',   recs: records.filter(r=>r.stato==='in_corso') },
    { stato: 'completata', recs: records.filter(r=>r.stato==='completata') },
  ].filter(g => g.recs.length > 0)

  return (
    <div className="flex flex-col gap-0">

      {/* ── Sezione documenti identità ─────────────────────────────────── */}
      <div className="px-4 pt-5 pb-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#a0aec0]">
            Documenti d'Identità
          </p>
          {alertCount > 0 && (
            <span className="text-[10px] font-bold bg-red-50 text-red-600 px-2 py-0.5 rounded-full">
              ⚠ {alertCount} in scadenza
            </span>
          )}
        </div>
        {idLoading ? (
          <div className="grid grid-cols-2 gap-2 animate-pulse">
            {[1,2,3,4].map(i=><div key={i} className="h-28 rounded-2xl bg-[#e2e8f0]" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {IDENTITY_TYPES.map(t => (
              <IdentityDocCard key={t.id} typeCfg={t} docs={docsForType(t.id)}
                canWrite={canWrite} resident={resident} onRefresh={fetchIdentityDocs} />
            ))}
          </div>
        )}
      </div>

      {/* Divisore */}
      <div className="mx-4 border-t border-[#e2e8f0] my-2" />

      {/* ── Sezione pratiche legali ────────────────────────────────────── */}
      <div className="px-4 pb-8 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#a0aec0]">
            Pratiche Legali
          </p>
          {canWrite && (
            <button type="button" onClick={() => setEditRecord(null)}
              className="text-xs font-semibold px-3 py-2 rounded-xl bg-[#1e3a5f] text-white
                         active:bg-[#152b47] transition-colors">
              + Nuova pratica
            </button>
          )}
        </div>

        {legError && (
          <div className="px-3 py-2 rounded-xl bg-red-50 border border-red-100">
            <p className="text-xs text-red-600">{legError}</p>
          </div>
        )}

        {legLoading ? (
          <div className="flex flex-col gap-3 animate-pulse">
            {[1,2].map(i=><div key={i} className="h-28 rounded-2xl bg-[#e2e8f0]" />)}
          </div>
        ) : records.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center">
            <p className="text-3xl mb-2">⚖️</p>
            <p className="font-semibold text-sm text-[#1a202c]">Nessuna pratica registrata</p>
            {canWrite && <p className="text-xs text-[#a0aec0] mt-1">Usa "+ Nuova pratica" per aggiungerne una.</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {statoGroups.map(({ stato, recs }) => {
              const cfg = STATO_CFG[stato]
              return (
                <div key={stato}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cfg.dot }} />
                    <p className="text-xs font-bold uppercase tracking-wide" style={{ color: cfg.text }}>{cfg.label}</p>
                    <div className="flex-1 h-px bg-[#e2e8f0]" />
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: cfg.bg, color: cfg.text }}>{recs.length}</span>
                  </div>
                  <div className="relative pl-5">
                    <div className="absolute left-[4px] top-2 bottom-2 w-0.5 bg-[#e2e8f0]" />
                    <div className="flex flex-col gap-3">
                      {recs.map(record => (
                        <div key={record.id} className="relative">
                          <div className="absolute -left-5 top-4 w-2.5 h-2.5 rounded-full border-2 border-white"
                            style={{ backgroundColor: cfg.dot }} />
                          <LegalRecordCard record={record} canWrite={canWrite} resident={resident}
                            onEdit={r => setEditRecord(r)} onDelete={handleDeleteRecord}
                            onDocDeleted={handleDocDeleted} onDocUploaded={fetchRecords} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {editRecord !== undefined && (
        <LegalRecordModal resident={resident} record={editRecord}
          onSave={() => { setEditRecord(undefined); fetchRecords() }}
          onClose={() => setEditRecord(undefined)} />
      )}
    </div>
  )
}

// ─── Tab Farmacologia ────────────────────────────────────────────────────────

const LOG_STATUS = {
  given:   { label: 'Somministrato', bg: '#d1fae5', text: '#065f46' },
  refused: { label: 'Rifiutato',     bg: '#fee2e2', text: '#991b1b' },
}

// ─── Input orari multipli ──────────────────────────────────────────────────

function FrequencyInput({ value, onChange }) {
  function add()         { onChange([...value, '08:00']) }
  function remove(i)     { onChange(value.filter((_, j) => j !== i)) }
  function setSlot(i, v) { onChange(value.map((t, j) => j === i ? v : t)) }

  return (
    <div className="flex flex-col gap-2">
      {value.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <input type="time" value={t} onChange={e => setSlot(i, e.target.value)}
            className="h-10 px-3 rounded-xl border border-[#e2e8f0] bg-white text-sm
              text-[#1a202c] outline-none focus:border-[#1e3a5f] flex-1 transition-colors" />
          <button type="button" onClick={() => remove(i)}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#fee2e2]
                       text-red-500 text-sm font-bold leading-none shrink-0">
            ×
          </button>
        </div>
      ))}
      <button type="button" onClick={add}
        className="self-start text-xs font-semibold text-[#1e3a5f] px-3 py-1.5 rounded-lg
                   bg-[#eef2f7] active:bg-[#e2e8f0] transition-colors">
        + Aggiungi orario
      </button>
    </div>
  )
}

// ─── Modal aggiunta/modifica farmaco ──────────────────────────────────────────

function MedFormModal({ resident, med, onSaved, onClose }) {
  const { profile } = useAuth()
  const isNew = !med

  const initDurationMode = med?.end_date ? 'data_fine' : 'cronica'

  const [form, setForm] = useState({
    name:          med?.name         ?? '',
    dosage:        med?.dosage       ?? '',
    frequency:     med?.frequency    ?? ['08:00'],
    instructions:  med?.instructions ?? '',
    is_active:     med?.is_active    ?? true,
    durationMode:  initDurationMode,
    end_date:      med?.end_date     ?? '',
  })
  const [prescFile, setPrescFile] = useState(null)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')

  function setF(k, v) { setForm(p => ({ ...p, [k]: v })) }

  async function handleSave() {
    if (!form.name.trim()) { setError('Il nome è obbligatorio.'); return }
    if (!form.frequency.length) { setError('Inserisci almeno un orario.'); return }
    if (form.durationMode === 'data_fine' && !form.end_date) {
      setError('Inserisci la data di fine terapia.'); return
    }
    setSaving(true); setError('')

    let prescription_url = med?.prescription_url ?? null

    if (prescFile) {
      const ext  = prescFile.name.split('.').pop()
      const path = `${resident.id}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('prescriptions')
        .upload(path, prescFile, { upsert: true })
      if (upErr) { setError('Errore upload ricetta.'); setSaving(false); return }
      const { data: urlData } = supabase.storage.from('prescriptions').getPublicUrl(path)
      prescription_url = urlData.publicUrl
    }

    const payload = {
      resident_id:      resident.id,
      name:             form.name.trim(),
      dosage:           form.dosage.trim() || null,
      frequency:        form.frequency.filter(Boolean),
      instructions:     form.instructions.trim() || null,
      prescription_url,
      is_active:        form.is_active,
      end_date:         form.durationMode === 'data_fine' ? (form.end_date || null) : null,
    }

    const { error: err } = isNew
      ? await supabase.from('resident_medications').insert({ ...payload, created_by: profile?.id ?? null })
      : await supabase.from('resident_medications').update(payload).eq('id', med.id)

    if (err) { setError(err.message); setSaving(false); return }
    setSaving(false)
    onSaved()
  }

  const inp = `w-full h-11 px-3 rounded-xl border border-[#e2e8f0] bg-white text-sm
    text-[#1a202c] outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 transition-colors`

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0 border-b border-[#f0f4f8]">
          <h3 className="font-bold text-[#1a202c] text-base">
            {isNew ? 'Nuovo farmaco' : 'Modifica farmaco'}
          </h3>
          <button type="button" onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#f0f4f8] text-[#718096] text-lg">
            ×
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5 flex flex-col gap-4">

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-semibold text-[#718096] block mb-1.5">
                Nome farmaco <span className="text-red-400">*</span>
              </label>
              <input type="text" value={form.name}
                onChange={e => setF('name', e.target.value)}
                placeholder="es. Paracetamolo" className={inp} />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#718096] block mb-1.5">Dosaggio</label>
              <input type="text" value={form.dosage}
                onChange={e => setF('dosage', e.target.value)}
                placeholder="es. 500mg 1 cp" className={inp} />
            </div>
            <div className="flex flex-col justify-end">
              {!isNew && (
                <button type="button" onClick={() => setF('is_active', !form.is_active)}
                  className={`h-11 rounded-xl border-2 font-semibold text-sm transition-colors
                    ${form.is_active
                      ? 'bg-green-50 border-green-400 text-green-700'
                      : 'bg-[#f3f4f6] border-[#d1d5db] text-[#6b7280]'}`}>
                  {form.is_active ? '● Attivo' : '○ Inattivo'}
                </button>
              )}
            </div>
          </div>

          {/* ── Durata trattamento ── */}
          <div>
            <label className="text-xs font-semibold text-[#718096] block mb-2">
              Durata trattamento
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setF('durationMode', 'cronica')}
                className={`flex-1 h-10 rounded-xl border-2 text-xs font-semibold transition-colors
                  ${form.durationMode === 'cronica'
                    ? 'bg-[#1e3a5f] border-[#1e3a5f] text-white'
                    : 'bg-white border-[#e2e8f0] text-[#718096]'}`}
              >
                ♾ Terapia Cronica
              </button>
              <button
                type="button"
                onClick={() => setF('durationMode', 'data_fine')}
                className={`flex-1 h-10 rounded-xl border-2 text-xs font-semibold transition-colors
                  ${form.durationMode === 'data_fine'
                    ? 'bg-[#1e3a5f] border-[#1e3a5f] text-white'
                    : 'bg-white border-[#e2e8f0] text-[#718096]'}`}
              >
                📅 Data Fine
              </button>
            </div>
            {form.durationMode === 'data_fine' && (
              <div className="mt-2.5">
                <label className="text-xs font-semibold text-[#718096] block mb-1.5">
                  Ultimo giorno di somministrazione <span className="text-red-400">*</span>
                </label>
                <input
                  type="date"
                  value={form.end_date}
                  onChange={e => setF('end_date', e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                  className={inp}
                />
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold text-[#718096] block mb-1.5">
              Orari somministrazione <span className="text-red-400">*</span>
            </label>
            <FrequencyInput value={form.frequency} onChange={v => setF('frequency', v)} />
          </div>

          <div>
            <label className="text-xs font-semibold text-[#718096] block mb-1.5">Istruzioni</label>
            <textarea value={form.instructions} onChange={e => setF('instructions', e.target.value)}
              rows={2} placeholder="es. Da assumere a stomaco pieno…"
              className="w-full px-3 py-2.5 rounded-xl border border-[#e2e8f0] bg-white text-sm
                text-[#1a202c] outline-none focus:border-[#1e3a5f] resize-none transition-colors" />
          </div>

          <div>
            <label className="text-xs font-semibold text-[#718096] block mb-1.5">
              Ricetta medica (PDF/immagine)
              {med?.prescription_url && (
                <a href={med.prescription_url} target="_blank" rel="noreferrer"
                  className="ml-2 font-semibold text-[#1e3a5f] underline">
                  Vedi attuale
                </a>
              )}
            </label>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png"
              onChange={e => setPrescFile(e.target.files?.[0] ?? null)}
              className="w-full text-xs text-[#718096] file:mr-3 file:py-2 file:px-3
                file:rounded-lg file:border-0 file:bg-[#eef2f7] file:text-[#1e3a5f]
                file:font-semibold file:text-xs cursor-pointer" />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button type="button" disabled={saving} onClick={handleSave}
            className="w-full h-12 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                       active:bg-[#152b47] disabled:opacity-60 transition-colors">
            {saving ? 'Salvataggio…' : isNew ? 'Aggiungi farmaco' : 'Salva modifiche'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Card farmaco ─────────────────────────────────────────────────────────────

function fmtMedDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('it-IT', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function MedCard({ med, canWrite, onEdit, onStop, stopConfirming, onStopConfirm, onStopCancel, archived }) {
  const todayISO  = new Date().toISOString().slice(0, 10)
  const isExpired = med.end_date && med.end_date < todayISO

  // Giorni mancanti alla fine (solo se non scaduto)
  const daysLeft = (!isExpired && med.end_date)
    ? Math.round((new Date(med.end_date + 'T00:00:00') - new Date(todayISO + 'T00:00:00')) / 86400000)
    : null
  const endDateUrgent = daysLeft !== null && daysLeft < 3

  return (
    <div className={`rounded-2xl border px-4 py-3 flex flex-col gap-2
      ${archived ? 'bg-[#f8f9fa] border-[#e2e8f0] opacity-70' : 'bg-white border-[#e2e8f0]'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-[#1a202c]">{med.name}</p>
            {med.dosage && (
              <span className="text-xs font-medium text-[#718096] bg-[#f0f4f8] px-2 py-0.5 rounded-full">
                {med.dosage}
              </span>
            )}
            {!med.is_active && (
              <span className="text-[10px] font-bold bg-[#e5e7eb] text-[#6b7280] px-2 py-0.5 rounded-full">
                Conclusa
              </span>
            )}
            {isExpired && med.is_active && (
              <span className="text-[10px] font-bold bg-[#fef3c7] text-[#92400e] px-2 py-0.5 rounded-full">
                Scaduta
              </span>
            )}
          </div>
          {med.frequency?.length > 0 && !archived && (
            <p className="text-xs text-[#1e3a5f] font-semibold mt-1">
              🕐 {med.frequency.join('  ·  ')}
            </p>
          )}
          {med.end_date && (
            <p className={`text-[10px] mt-0.5 font-medium
              ${isExpired ? 'text-[#a0aec0]' : endDateUrgent ? 'text-orange-500' : 'text-[#a0aec0]'}`}>
              {isExpired
                ? `Terminata il ${fmtMedDate(med.end_date)}`
                : daysLeft === 0
                  ? `⚠ Ultimo giorno — ${fmtMedDate(med.end_date)}`
                  : endDateUrgent
                    ? `⚠ Scade tra ${daysLeft} giorn${daysLeft === 1 ? 'o' : 'i'} — ${fmtMedDate(med.end_date)}`
                    : `Fino al ${fmtMedDate(med.end_date)}`
              }
            </p>
          )}
          {med.instructions && !archived && (
            <p className="text-xs text-[#a0aec0] mt-0.5 italic">{med.instructions}</p>
          )}
          {med.creator?.full_name && (
            <p className="text-[10px] text-[#a0aec0] mt-1">
              Inserito da {med.creator.full_name} · {fmtDateShort(med.created_at)}
            </p>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
          {med.prescription_url && (
            <a href={med.prescription_url} target="_blank" rel="noreferrer"
              className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-[#dbeafe] text-[#1d4ed8]
                         active:bg-[#bfdbfe] transition-colors whitespace-nowrap">
              📄 Ricetta
            </a>
          )}
          {canWrite && !archived && (
            <button type="button" onClick={() => onEdit(med)}
              className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-[#eef2f7] text-[#1e3a5f]
                         active:bg-[#e2e8f0] transition-colors">
              Modifica
            </button>
          )}
          {canWrite && !archived && onStop && (
            <button type="button" onClick={onStop}
              className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-[#fee2e2] text-[#991b1b]
                         active:bg-[#fecaca] transition-colors whitespace-nowrap">
              Interrompi
            </button>
          )}
        </div>
      </div>

      {/* Conferma interruzione inline */}
      {stopConfirming && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 flex flex-col gap-2">
          <p className="text-xs font-semibold text-amber-800 leading-snug">
            Interrompere questa terapia? Il farmaco verrà spostato nello storico.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onStopCancel}
              className="flex-1 h-8 rounded-lg border border-[#e2e8f0] text-xs font-semibold
                         text-[#718096] active:bg-[#f0f4f8] transition-colors">
              Annulla
            </button>
            <button type="button" onClick={onStopConfirm}
              className="flex-[2] h-8 rounded-lg bg-[#991b1b] text-white text-xs font-semibold
                         active:bg-[#7f1d1d] transition-colors">
              Sì, interrompi
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── FarmacologiaTab ──────────────────────────────────────────────────────────

function FarmacologiaTab({ resident, canWrite }) {
  const [meds,         setMeds]         = useState([])
  const [logs,         setLogs]         = useState([])
  const [medsLoad,     setMedsLoad]     = useState(false)
  const [logsLoad,     setLogsLoad]     = useState(false)
  const [editMed,      setEditMed]      = useState(null)   // null | 'new' | {med obj}
  const [stopConfirmId, setStopConfirmId] = useState(null)
  const [stopping,     setStopping]     = useState(false)
  const [fromDate,     setFromDate]     = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  })

  const todayISO = new Date().toISOString().slice(0, 10)

  const fetchMeds = useCallback(async () => {
    setMedsLoad(true)
    const { data } = await supabase
      .from('resident_medications')
      .select('*, creator:profiles!created_by(full_name)')
      .eq('resident_id', resident.id)
      .order('created_at', { ascending: false })
    setMeds(data ?? [])
    setMedsLoad(false)
  }, [resident.id])

  const fetchLogs = useCallback(async () => {
    setLogsLoad(true)
    const { data } = await supabase
      .from('medication_logs')
      .select(`
        id, administered_at, status, notes, medication_name,
        medication:resident_medications!medication_id(name, dosage),
        operator:profiles!operator_id(full_name)
      `)
      .eq('resident_id', resident.id)
      .gte('administered_at', fromDate + 'T00:00:00')
      .order('administered_at', { ascending: false })
      .limit(100)
    setLogs(data ?? [])
    setLogsLoad(false)
  }, [resident.id, fromDate])

  useEffect(() => { fetchMeds() }, [fetchMeds])
  useEffect(() => { fetchLogs() }, [fetchLogs])

  async function handleStop(medId) {
    setStopping(true)
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayISO = yesterday.toISOString().slice(0, 10)
    await supabase
      .from('resident_medications')
      .update({ is_active: false, end_date: yesterdayISO })
      .eq('id', medId)
    setStopping(false)
    setStopConfirmId(null)
    fetchMeds()
  }

  // Terapia in corso: is_active=true E (nessuna end_date O end_date >= oggi)
  const activeMeds   = meds.filter(m => m.is_active && (!m.end_date || m.end_date >= todayISO))
  // Storico: is_active=false OPPURE end_date < oggi
  const concludedMeds = meds.filter(m => !m.is_active || (m.end_date && m.end_date < todayISO))

  return (
    <div className="px-4 py-4 flex flex-col gap-6">

      {/* ── Sezione A: Terapia Attiva ── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-[#1a202c] text-sm">Terapia attiva</h3>
            <p className="text-xs text-[#a0aec0] mt-0.5">{activeMeds.length} farmac{activeMeds.length === 1 ? 'o' : 'i'}</p>
          </div>
          {canWrite && (
            <button type="button" onClick={() => setEditMed('new')}
              className="text-xs font-semibold px-3 py-2 rounded-xl bg-[#1e3a5f] text-white
                         active:bg-[#152b47] transition-colors">
              + Aggiungi
            </button>
          )}
        </div>

        {medsLoad ? (
          <div className="h-16 bg-[#e2e8f0] rounded-2xl animate-pulse" />
        ) : activeMeds.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#e2e8f0] py-8 text-center">
            <p className="text-2xl mb-1">💊</p>
            <p className="text-xs text-[#a0aec0]">Nessuna terapia attiva</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {activeMeds.map(m => (
              <MedCard
                key={m.id}
                med={m}
                canWrite={canWrite}
                onEdit={setEditMed}
                onStop={() => setStopConfirmId(m.id)}
                stopConfirming={stopConfirmId === m.id}
                onStopConfirm={() => handleStop(m.id)}
                onStopCancel={() => setStopConfirmId(null)}
                archived={false}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Sezione B: Registro Somministrazioni ── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-bold text-[#1a202c] text-sm">Registro somministrazioni</h3>
            <p className="text-xs text-[#a0aec0] mt-0.5">{logs.length} registrazion{logs.length === 1 ? 'e' : 'i'}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-[#718096] font-medium">Dal</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="h-9 px-2.5 text-xs rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c]
                         outline-none focus:border-[#1e3a5f] transition-colors" />
          </div>
        </div>

        {logsLoad ? (
          <div className="h-24 bg-[#e2e8f0] rounded-2xl animate-pulse" />
        ) : logs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#e2e8f0] py-8 text-center">
            <p className="text-xs text-[#a0aec0]">Nessuna somministrazione nel periodo selezionato.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-[#e2e8f0] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[#f8f9fa] border-b border-[#e2e8f0]">
                    <th className="text-left px-3 py-2.5 font-semibold text-[#718096] whitespace-nowrap">Data/Ora</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-[#718096]">Farmaco</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-[#718096]">Esito</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-[#718096] whitespace-nowrap">Operatore</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0f4f8]">
                  {logs.map(l => {
                    const st = LOG_STATUS[l.status] ?? LOG_STATUS.given
                    return (
                      <tr key={l.id} className="hover:bg-[#f8f9fa] transition-colors">
                        <td className="px-3 py-2.5 whitespace-nowrap text-[#718096]">
                          {new Date(l.administered_at).toLocaleDateString('it-IT', {
                            day: '2-digit', month: 'short',
                          })}
                          {' '}
                          <span className="font-semibold text-[#1a202c]">
                            {new Date(l.administered_at).toLocaleTimeString('it-IT', {
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="font-semibold text-[#1a202c]">{l.medication?.name ?? l.medication_name ?? '—'}</span>
                          {l.medication?.dosage && (
                            <span className="text-[#a0aec0] ml-1">{l.medication.dosage}</span>
                          )}
                          {l.notes && (
                            <p className="text-[#718096] italic mt-0.5 leading-snug">{l.notes}</p>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="font-bold px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: st.bg, color: st.text }}>
                            {st.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-[#718096]">
                          {l.operator?.full_name ?? '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* ── Sezione C: Storico Terapie Concluse ── */}
      {concludedMeds.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-[#e2e8f0]" />
            <span className="text-[10px] font-bold text-[#a0aec0] uppercase tracking-widest shrink-0">
              Storico terapie concluse
            </span>
            <div className="flex-1 h-px bg-[#e2e8f0]" />
          </div>
          <div className="flex flex-col gap-2">
            {concludedMeds.map(m => (
              <MedCard
                key={m.id}
                med={m}
                canWrite={false}
                onEdit={() => {}}
                archived
              />
            ))}
          </div>
        </section>
      )}

      {/* Modal form */}
      {editMed && (
        <MedFormModal
          resident={resident}
          med={editMed === 'new' ? null : editMed}
          onSaved={() => { setEditMed(null); fetchMeds() }}
          onClose={() => setEditMed(null)}
        />
      )}
    </div>
  )
}

// ─── Tab Agenda Appuntamenti ──────────────────────────────────────────────────

const APPT_STATUS = {
  scheduled:  { label: 'Programmato', bg: '#dbeafe', text: '#1d4ed8' },
  completed:  { label: 'Completato',  bg: '#d1fae5', text: '#065f46' },
  cancelled:  { label: 'Annullato',   bg: '#f3f4f6', text: '#6b7280' },
}

function fmtApptDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('it-IT', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  })
}
function fmtApptTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}
function toLocalDT(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function nowLocalDT() { return toLocalDT(new Date().toISOString()) }

// ─── Modal nuovo / modifica / elimina appuntamento ────────────────────────────
// appointment=null → nuovo | appointment={...} → modifica

function AppointmentModal({ resident, operators, appointment, onSaved, onDeleted, onClose }) {
  const { profile } = useAuth()
  const isEdit = !!appointment

  const [form, setForm] = useState({
    title:                isEdit ? appointment.title                               : '',
    description:          isEdit ? (appointment.description ?? '')                 : '',
    start_datetime:       isEdit ? toLocalDT(appointment.start_datetime)           : nowLocalDT(),
    end_datetime:         isEdit ? (appointment.end_datetime ? toLocalDT(appointment.end_datetime) : '') : '',
    location:             isEdit ? (appointment.location ?? '')                    : '',
    assigned_operator_id: isEdit ? (appointment.assigned_operator_id ?? '')        : '',
  })
  const [saving,       setSaving]       = useState(false)
  const [confirmDel,   setConfirmDel]   = useState(false)
  const [deleting,     setDeleting]     = useState(false)
  const [error,        setError]        = useState('')

  function setF(k, v) { setForm(p => ({ ...p, [k]: v })) }

  async function handleSave() {
    if (!form.title.trim())   { setError('Il titolo è obbligatorio.'); return }
    if (!form.start_datetime) { setError('La data/ora è obbligatoria.'); return }
    setSaving(true); setError('')

    const payload = {
      title:                form.title.trim(),
      description:          form.description.trim() || null,
      start_datetime:       new Date(form.start_datetime).toISOString(),
      end_datetime:         form.end_datetime ? new Date(form.end_datetime).toISOString() : null,
      location:             form.location.trim() || null,
      assigned_operator_id: form.assigned_operator_id || null,
    }

    let err
    if (isEdit) {
      ({ error: err } = await supabase
        .from('resident_appointments').update(payload).eq('id', appointment.id))
    } else {
      ({ error: err } = await supabase
        .from('resident_appointments').insert({
          ...payload, resident_id: resident.id, created_by: profile?.id ?? null,
        }))
    }
    if (err) { setError('Errore nel salvataggio.'); setSaving(false); return }
    setSaving(false)
    onSaved()
  }

  async function handleDelete() {
    setDeleting(true)
    await supabase.from('resident_appointments').delete().eq('id', appointment.id)
    setDeleting(false)
    onDeleted(appointment.id)
  }

  const inp = `w-full h-11 px-3 rounded-xl border border-[#e2e8f0] bg-white text-sm
    text-[#1a202c] outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 transition-colors`

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0 border-b border-[#f0f4f8]">
          <h3 className="font-bold text-[#1a202c] text-base">
            {isEdit ? 'Modifica appuntamento' : 'Nuovo appuntamento'}
          </h3>
          <button type="button" onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#f0f4f8] text-[#718096] text-lg">×</button>
        </div>
        <div className="overflow-y-auto px-6 py-5 flex flex-col gap-4">
          <div>
            <label className="text-xs font-semibold text-[#718096] block mb-1.5">
              Titolo <span className="text-red-400">*</span>
            </label>
            <input type="text" value={form.title} onChange={e => setF('title', e.target.value)}
              placeholder="es. Visita Dentista" className={inp} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#718096] block mb-1.5">
                Inizio <span className="text-red-400">*</span>
              </label>
              <input type="datetime-local" value={form.start_datetime}
                onChange={e => setF('start_datetime', e.target.value)} className={inp} />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#718096] block mb-1.5">Fine</label>
              <input type="datetime-local" value={form.end_datetime}
                onChange={e => setF('end_datetime', e.target.value)} className={inp} />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-[#718096] block mb-1.5">Luogo</label>
            <input type="text" value={form.location} onChange={e => setF('location', e.target.value)}
              placeholder="es. Ospedale Civico" className={inp} />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#718096] block mb-1.5">Operatore accompagnatore</label>
            <select value={form.assigned_operator_id} onChange={e => setF('assigned_operator_id', e.target.value)}
              className={inp + ' appearance-none'}>
              <option value="">— Nessuno —</option>
              {operators.map(op => (
                <option key={op.id} value={op.id}>{op.full_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-[#718096] block mb-1.5">Note (opzionale)</label>
            <textarea value={form.description} onChange={e => setF('description', e.target.value)}
              rows={3} placeholder="Dettagli aggiuntivi…"
              className="w-full px-3 py-2.5 rounded-xl border border-[#e2e8f0] bg-white text-sm
                text-[#1a202c] outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                resize-none transition-colors" />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button type="button" disabled={saving} onClick={handleSave}
            className="w-full h-12 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                       active:bg-[#152b47] disabled:opacity-60 transition-colors">
            {saving ? 'Salvataggio…' : isEdit ? 'Salva modifiche' : 'Salva appuntamento'}
          </button>

          {/* Elimina — solo in modalità modifica */}
          {isEdit && !confirmDel && (
            <button type="button" onClick={() => setConfirmDel(true)}
              className="w-full h-10 rounded-xl border border-red-200 text-red-500 text-sm font-semibold
                         active:bg-red-50 transition-colors">
              Elimina appuntamento
            </button>
          )}

          {/* Conferma eliminazione */}
          {confirmDel && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 flex flex-col gap-3">
              <p className="text-sm font-semibold text-red-700 text-center">
                Sei sicuro di voler eliminare questo appuntamento?
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirmDel(false)}
                  className="flex-1 h-10 rounded-xl border border-[#e2e8f0] text-sm font-semibold
                             text-[#718096] active:bg-[#f8f9fa] transition-colors">
                  Annulla
                </button>
                <button type="button" disabled={deleting} onClick={handleDelete}
                  className="flex-1 h-10 rounded-xl bg-red-600 text-white text-sm font-semibold
                             active:bg-red-700 disabled:opacity-60 transition-colors">
                  {deleting ? 'Eliminazione…' : 'Sì, elimina'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Modal completamento appuntamento ─────────────────────────────────────────

function CompletionModal({ appointment, resident, profile, onCompleted, onClose }) {
  const [outcomeNote,  setOutcomeNote]  = useState('')
  const [addToDiary,   setAddToDiary]   = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')

  async function handleConfirm() {
    setSaving(true); setError('')
    const { error: err } = await supabase
      .from('resident_appointments')
      .update({ status: 'completed', outcome_note: outcomeNote.trim() || null })
      .eq('id', appointment.id)
    if (err) { setError('Errore nel salvataggio.'); setSaving(false); return }

    if (addToDiary && outcomeNote.trim() && profile?.id) {
      const note = `📅 Appuntamento — ${resident.nome} ${resident.cognome}\n` +
        `${appointment.title}` +
        (appointment.location ? ` · ${appointment.location}` : '') +
        `\n\nEsito: ${outcomeNote.trim()}`
      await supabase.from('diaries').insert({
        structure_id:   resident.structure_id,
        operator_id:    profile.id,
        mood:           3,
        has_incident:   false,
        handover_notes: note,
        is_urgent:      false,
      })
    }

    setSaving(false)
    onCompleted()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0 border-b border-[#f0f4f8]">
          <h3 className="font-bold text-[#1a202c] text-base">Segna come completato</h3>
          <button type="button" onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#f0f4f8] text-[#718096] text-lg">×</button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <div className="bg-[#f8f9fa] rounded-xl px-4 py-3">
            <p className="text-sm font-semibold text-[#1a202c]">{appointment.title}</p>
            {appointment.location && (
              <p className="text-xs text-[#718096] mt-0.5">{appointment.location}</p>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-[#718096] block mb-1.5">
              Nota di esito (opzionale)
            </label>
            <textarea value={outcomeNote} onChange={e => setOutcomeNote(e.target.value)}
              rows={4} placeholder="Come è andato l'appuntamento?…"
              className="w-full px-3 py-2.5 rounded-xl border border-[#e2e8f0] bg-white text-sm
                text-[#1a202c] outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                resize-none transition-colors" />
          </div>
          {outcomeNote.trim() && (
            <button type="button" onClick={() => setAddToDiary(v => !v)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-colors text-left
                ${addToDiary
                  ? 'bg-[#eef2f7] border-[#1e3a5f] text-[#1e3a5f]'
                  : 'bg-white border-[#e2e8f0] text-[#718096]'}`}>
              <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 text-xs font-bold
                ${addToDiary ? 'bg-[#1e3a5f] text-white' : 'bg-[#e2e8f0] text-transparent'}`}>✓</div>
              <div>
                <p className="text-xs font-semibold leading-tight">Aggiungi al Diario di Bordo</p>
                <p className="text-[10px] mt-0.5 opacity-75">Crea una voce automatica nel diario della struttura</p>
              </div>
            </button>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="flex-1 h-11 rounded-xl border border-[#e2e8f0] text-sm font-semibold
                         text-[#718096] active:bg-[#f8f9fa] transition-colors">
              Annulla
            </button>
            <button type="button" disabled={saving} onClick={handleConfirm}
              className="flex-1 h-11 rounded-xl bg-[#065f46] text-white font-semibold text-sm
                         active:bg-[#064e3b] disabled:opacity-60 transition-colors">
              {saving ? 'Salvataggio…' : '✓ Completato'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── ApptRow ──────────────────────────────────────────────────────────────────

function ApptRow({ appt, operators, onComplete, onEdit }) {
  const st           = APPT_STATUS[appt.status] ?? APPT_STATUS.scheduled
  const past         = new Date(appt.start_datetime) < new Date()
  const operatorName = appt.operator?.full_name
    ?? operators?.find(o => o.id === appt.assigned_operator_id)?.full_name
    ?? null
  return (
    <div className={`bg-white rounded-2xl border px-4 py-3 flex flex-col gap-2
      ${past && appt.status === 'scheduled' ? 'border-orange-200 bg-orange-50/40' : 'border-[#e2e8f0]'}`}>
      <div className="flex items-start gap-3">
        <div className="shrink-0 text-center min-w-[44px] bg-[#f8f9fa] rounded-xl px-2 py-1.5">
          <p className="text-[10px] font-bold text-[#1e3a5f] uppercase leading-tight">
            {new Date(appt.start_datetime).toLocaleDateString('it-IT', { month: 'short' })}
          </p>
          <p className="text-base font-black text-[#1a202c] leading-tight">
            {new Date(appt.start_datetime).getDate()}
          </p>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-bold text-[#1a202c] leading-snug">{appt.title}</p>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: st.bg, color: st.text }}>
                {st.label}
              </span>
              <button type="button" onClick={() => onEdit(appt)} title="Modifica"
                className="w-6 h-6 flex items-center justify-center rounded-lg bg-[#f0f4f8]
                           text-[#718096] hover:text-[#1e3a5f] hover:bg-[#dbeafe] transition-colors">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H7v-3.414a2 2 0 01.586-1.414z" />
                </svg>
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-[#718096]">
              {fmtApptTime(appt.start_datetime)}
              {appt.end_datetime ? ` – ${fmtApptTime(appt.end_datetime)}` : ''}
            </span>
            {appt.location && (
              <>
                <span className="text-[#d1d5db]">·</span>
                <span className="text-xs text-[#718096]">📍 {appt.location}</span>
              </>
            )}
          </div>
          <p className="text-xs text-[#718096] mt-0.5 break-words">
            👤 {operatorName ?? 'Nessun accompagnatore'}
          </p>
          {appt.creator?.full_name && (
            <p className="text-[10px] text-[#a0aec0] mt-0.5">
              Inserito da {appt.creator.full_name} · {fmtDateShort(appt.created_at)}
            </p>
          )}
          {appt.outcome_note && (
            <p className="text-xs text-[#065f46] mt-1.5 bg-green-50 rounded-lg px-2.5 py-1.5 leading-relaxed">
              {appt.outcome_note}
            </p>
          )}
        </div>
      </div>
      {appt.status === 'scheduled' && (
        <button type="button" onClick={() => onComplete(appt)}
          className="self-end text-[11px] font-semibold px-3 py-1.5 rounded-lg
                     bg-[#d1fae5] text-[#065f46] active:bg-[#a7f3d0] transition-colors">
          ✓ Segna completato
        </button>
      )}
    </div>
  )
}

// ─── AgendaTab ────────────────────────────────────────────────────────────────

function AgendaTab({ resident }) {
  const { profile } = useAuth()
  const [appointments, setAppointments] = useState([])
  const [operators,    setOperators]    = useState([])
  const [loading,      setLoading]      = useState(false)
  const [showAdd,      setShowAdd]      = useState(false)
  const [editing,      setEditing]      = useState(null)   // appointment object | null
  const [completing,   setCompleting]   = useState(null)

  const fetchAppointments = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('resident_appointments')
      .select(`*, operator:profiles!assigned_operator_id(full_name), creator:profiles!created_by(full_name)`)
      .eq('resident_id', resident.id)
      .order('start_datetime', { ascending: true })
    setAppointments(data ?? [])
    setLoading(false)
  }, [resident.id])

  useEffect(() => { fetchAppointments() }, [fetchAppointments])

  useEffect(() => {
    if (!resident.structure_id) return
    supabase.rpc('get_structure_members', { p_structure_id: resident.structure_id })
      .then(({ data }) => setOperators(data ?? []))
  }, [resident.structure_id])

  // Aggiornamento ottimistico: rimuove l'appuntamento eliminato senza refetch
  function handleDeleted(id) {
    setAppointments(p => p.filter(a => a.id !== id))
    setEditing(null)
  }

  const now        = new Date()
  const upcoming   = appointments.filter(a => a.status === 'scheduled' && new Date(a.start_datetime) >= now)
  const pastOrDone = appointments.filter(a => a.status !== 'scheduled' || new Date(a.start_datetime) < now)

  return (
    <div className="px-4 py-4 flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-[#1a202c] text-sm">Agenda appuntamenti</h3>
          <p className="text-xs text-[#a0aec0] mt-0.5">{appointments.length} totali</p>
        </div>
        <button type="button" onClick={() => setShowAdd(true)}
          className="text-xs font-semibold px-3 py-2 rounded-xl bg-[#1e3a5f] text-white
                     active:bg-[#152b47] transition-colors">
          + Aggiungi
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {[1,2].map(i => <div key={i} className="h-20 bg-[#e2e8f0] rounded-2xl animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* Prossimi */}
          {upcoming.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#a0aec0]">Prossimi</p>
              {upcoming.map(a => (
                <ApptRow key={a.id} appt={a} operators={operators} onComplete={setCompleting} onEdit={setEditing} />
              ))}
            </div>
          )}

          {/* Passati / completati */}
          {pastOrDone.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#a0aec0]">
                {upcoming.length > 0 ? 'Storico' : 'Tutti gli appuntamenti'}
              </p>
              {pastOrDone.map(a => (
                <ApptRow key={a.id} appt={a} operators={operators} onComplete={setCompleting} onEdit={setEditing} />
              ))}
            </div>
          )}

          {appointments.length === 0 && (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <span className="text-4xl mb-3">📅</span>
              <p className="font-semibold text-sm text-[#1a202c]">Nessun appuntamento</p>
              <p className="text-xs text-[#a0aec0] mt-1">Usa "+ Aggiungi" per inserire il primo.</p>
            </div>
          )}
        </>
      )}

      {/* Modal nuovo appuntamento */}
      {showAdd && (
        <AppointmentModal
          resident={resident}
          operators={operators}
          onSaved={() => { setShowAdd(false); fetchAppointments() }}
          onDeleted={() => {}}
          onClose={() => setShowAdd(false)}
        />
      )}

      {/* Modal modifica appuntamento */}
      {editing && (
        <AppointmentModal
          resident={resident}
          operators={operators}
          appointment={editing}
          onSaved={() => { setEditing(null); fetchAppointments() }}
          onDeleted={handleDeleted}
          onClose={() => setEditing(null)}
        />
      )}

      {completing && (
        <CompletionModal
          appointment={completing}
          resident={resident}
          profile={profile}
          onCompleted={() => { setCompleting(null); fetchAppointments() }}
          onClose={() => setCompleting(null)}
        />
      )}
    </div>
  )
}

// ─── Componente principale ─────────────────────────────────────────────────────

const TABS = [
  { id: 'profilo',       label: 'Profilo' },
  { id: 'educativo',     label: 'Percorso Educativo' },
  { id: 'documenti',     label: 'Documenti e Pratiche' },
  { id: 'farmacologia',  label: '💊 Farmacologia' },
  { id: 'agenda',        label: '📅 Agenda' },
]

export default function ResidentDetail({ resident, canWrite, onBack, onResidentUpdate, onDischarged, onTransferred }) {
  const [activeTab, setActiveTab] = useState('profilo')

  const [bg, text] = avatarColors(resident.cognome)

  return (
    <div className="flex flex-col">
      {/* Back */}
      <button type="button" onClick={onBack}
        className="flex items-center gap-2 px-4 pt-4 pb-2 text-sm font-semibold
                   text-[#1e3a5f] self-start active:text-[#152b47] transition-colors">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Tutti i residenti
      </button>

      {/* Hero */}
      <div className="mx-4 bg-white rounded-2xl border border-[#e2e8f0] px-4 py-4 flex items-center gap-4">
        {resident.foto_url ? (
          <img src={resident.foto_url} alt="" className="w-16 h-16 rounded-2xl object-cover shrink-0" />
        ) : (
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center shrink-0 font-bold text-xl"
            style={{ backgroundColor: bg, color: text }}>
            {initials(resident.nome, resident.cognome)}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="font-black text-[#1a202c] text-lg leading-tight">
            {resident.nome} {resident.cognome}
          </h1>
          {resident.nazionalita && (
            <p className="text-xs text-[#718096] mt-0.5">
              {NATIONALITY_FLAGS[resident.nazionalita] && (
                <span className="mr-1">{NATIONALITY_FLAGS[resident.nazionalita]}</span>
              )}
              {resident.nazionalita}
            </p>
          )}
          {resident.is_archived && (
            <span className="inline-block mt-1 text-[10px] font-bold text-[#718096] bg-[#f0f4f8] px-2 py-0.5 rounded-full">
              Archiviato
            </span>
          )}
        </div>
      </div>

      {/* Tab bar scrollabile */}
      <div className="flex border-b border-[#e2e8f0] bg-[#f8f9fa] mt-4 overflow-x-auto">
        {TABS.map(tab => (
          <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
            className={`relative shrink-0 px-4 py-3 text-sm font-semibold transition-colors whitespace-nowrap
              ${activeTab===tab.id ? 'text-[#1e3a5f]' : 'text-[#a0aec0]'}`}>
            {tab.label}
            {activeTab===tab.id && (
              <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-[#1e3a5f] rounded-full" />
            )}
          </button>
        ))}
      </div>

      {activeTab==='profilo'   && <ProfiloTab resident={resident} canWrite={canWrite} onResidentUpdate={onResidentUpdate} onDischarged={onDischarged} onTransferred={onTransferred} />}
      {activeTab==='educativo' && <PercorsoEducativoTab resident={resident} canWrite={canWrite} />}
      {activeTab==='documenti'    && <DocumPraticheTab    resident={resident} canWrite={canWrite} />}
      {activeTab==='farmacologia' && <FarmacologiaTab    resident={resident} canWrite={canWrite} />}
      {activeTab==='agenda'       && <AgendaTab          resident={resident} />}
    </div>
  )
}
