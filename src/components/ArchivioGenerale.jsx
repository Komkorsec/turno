import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

// ── Categorie default (seed al primo accesso per org) ─────────────────────────
export const DEFAULT_CATEGORIES = [
  { name: 'Accreditamento e autorizzazioni',    emoji: '🏛️' },
  { name: 'Sicurezza (DVR, antincendio, HACCP)', emoji: '🔒' },
  { name: 'Assicurazioni',                      emoji: '🛡️' },
  { name: 'Regolamenti e carta dei servizi',    emoji: '📋' },
  { name: 'Verbali',                            emoji: '📝' },
  { name: 'Contratti',                          emoji: '🤝' },
  { name: 'Altro',                              emoji: '📁' },
]

// Emoji selezionabili nel picker
const EMOJI_OPTIONS = ['📁','🏛️','🔒','🛡️','📋','📝','🤝','📄','🖼️','📊',
                       '🗂️','📌','🏥','⚖️','🔑','💼','🌐','📞','🏗️','✅']

// ── Helpers ───────────────────────────────────────────────────────────────────
function fileIcon(name = '') {
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (ext === 'pdf') return '📄'
  if (['doc', 'docx'].includes(ext)) return '📝'
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return '🖼️'
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊'
  return '📎'
}

function fmtFileSize(b) {
  if (!b) return ''
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${Math.round(b / 1024)} KB`
  return `${(b / 1048576).toFixed(1)} MB`
}

function fmtDateShort(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

function daysToExpiry(dateStr) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000)
}

function expiryStatus(dateStr) {
  const d = daysToExpiry(dateStr)
  if (d === null) return 'nessuna'
  if (d < 0)   return 'scaduto'
  if (d <= 30) return 'in-scadenza'
  return 'valido'
}

function ExpiryBadge({ dateStr }) {
  const d = daysToExpiry(dateStr)
  if (d === null) return null
  const expired = d < 0
  const soon    = d >= 0 && d <= 30
  if (!expired && !soon)
    return <span className="text-xs text-[#a0aec0]">{fmtDateShort(dateStr)}</span>
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
      expired ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'
    }`}>
      {expired
        ? `⚠ Scaduto il ${fmtDateShort(dateStr)}`
        : d === 0 ? '⚠ Scade oggi'
        : `⚠ Scade in ${d} giorn${d === 1 ? 'o' : 'i'}`}
    </span>
  )
}

const inputCls = `w-full h-11 px-3 rounded-xl border border-[#e2e8f0] bg-white text-sm
  text-[#1a202c] outline-none focus:border-[#1e3a5f] appearance-none transition-colors`

// ── CategoryEditModal (crea o modifica categoria) ─────────────────────────────
function CategoryEditModal({ orgId, existing, canDelete, onSaved, onDelete, onClose }) {
  const isNew = !existing
  const [name,    setName]    = useState(existing?.name  ?? '')
  const [emoji,   setEmoji]   = useState(existing?.emoji ?? '📁')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  async function handleSave() {
    if (!name.trim()) { setError('Inserisci un nome.'); return }
    setSaving(true); setError('')
    if (isNew) {
      const { error: err } = await supabase.from('org_document_categories').insert({
        organization_id: orgId,
        name:            name.trim(),
        emoji,
        sort_order:      999,
      })
      if (err) { setError('Errore: ' + err.message); setSaving(false); return }
    } else {
      const { error: err } = await supabase.from('org_document_categories')
        .update({ name: name.trim(), emoji })
        .eq('id', existing.id)
      if (err) { setError('Errore: ' + err.message); setSaving(false); return }
    }
    setSaving(false); onSaved(name.trim(), existing?.name)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-[#1a202c] text-base">
            {isNew ? 'Nuova cartella' : 'Modifica cartella'}
          </h3>
          <button type="button" onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#f0f4f8] text-[#718096] text-lg">×</button>
        </div>

        <div>
          <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">Nome</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="Es. Autorizzazioni regionali" className={inputCls} />
        </div>

        <div>
          <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-2">Emoji</label>
          <div className="flex flex-wrap gap-2">
            {EMOJI_OPTIONS.map(e => (
              <button key={e} type="button" onClick={() => setEmoji(e)}
                className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center transition-colors
                  ${emoji === e
                    ? 'bg-[#1e3a5f] shadow-md scale-110'
                    : 'bg-[#f0f4f8] hover:bg-[#e2e8f0]'}`}>
                {e}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <button type="button" disabled={saving} onClick={handleSave}
          className="w-full h-12 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                     active:bg-[#152b47] disabled:opacity-60 transition-colors">
          {saving ? 'Salvataggio…' : isNew ? 'Crea cartella' : 'Salva'}
        </button>

        {!isNew && canDelete && (
          <button type="button" onClick={onDelete}
            className="w-full h-10 rounded-xl border border-red-200 text-red-500 text-sm font-medium
                       hover:bg-red-50 active:bg-red-100 transition-colors">
            Elimina cartella
          </button>
        )}
        {!isNew && !canDelete && (
          <p className="text-center text-xs text-[#a0aec0]">
            La cartella contiene documenti e non può essere eliminata
          </p>
        )}
      </div>
    </div>
  )
}

// ── UploadModal ───────────────────────────────────────────────────────────────
function UploadModal({ orgId, structures, defaultCategoria, categories, onUploaded, onClose }) {
  const { profile } = useAuth()
  const [file,          setFile]          = useState(null)
  const [titolo,        setTitolo]        = useState('')
  const [categoria,     setCategoria]     = useState(defaultCategoria || (categories[0]?.name ?? 'Altro'))
  const [structureId,   setStructureId]   = useState('')
  const [dataScadenza,  setDataScadenza]  = useState('')
  const [note,          setNote]          = useState('')
  const [uploading,     setUploading]     = useState(false)
  const [error,         setError]         = useState('')
  const inputRef         = useRef(null)
  const blockBackdropRef = useRef(false)
  const safetyTimerRef   = useRef(null)

  function openFilePicker() {
    blockBackdropRef.current = true
    clearTimeout(safetyTimerRef.current)
    safetyTimerRef.current = setTimeout(() => { blockBackdropRef.current = false }, 5000)
    inputRef.current?.click()
  }

  function handleFileChange(e) {
    const f = e.target.files?.[0] ?? null
    setFile(f); setError('')
    if (f && !titolo) setTitolo(f.name.replace(/\.[^.]+$/, ''))
    clearTimeout(safetyTimerRef.current)
    setTimeout(() => { blockBackdropRef.current = false }, 500)
  }

  async function handleUpload() {
    if (!file) { setError('Seleziona un file.'); return }
    if (file.size > 20 * 1024 * 1024) { setError('File troppo grande (max 20 MB).'); return }
    if (!titolo.trim()) { setError('Inserisci un titolo.'); return }
    setUploading(true); setError('')

    const ext    = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
    const folder = structureId ? structureId : 'generale'
    const path   = `${orgId}/${folder}/${crypto.randomUUID()}.${ext}`

    const { error: sErr } = await supabase.storage
      .from('org-documents').upload(path, file, { upsert: false })
    if (sErr) { setError('Errore upload: ' + sErr.message); setUploading(false); return }

    const { error: dErr } = await supabase.from('org_documents').insert({
      organization_id: orgId,
      structure_id:    structureId ? Number(structureId) : null,
      categoria,
      titolo:          titolo.trim(),
      storage_path:    path,
      original_name:   file.name,
      file_size:       file.size,
      mime_type:       file.type || null,
      data_scadenza:   dataScadenza || null,
      note:            note.trim() || null,
      uploaded_by:     profile?.id ?? null,
    })
    if (dErr) {
      await supabase.storage.from('org-documents').remove([path])
      setError('Errore salvataggio: ' + dErr.message)
      setUploading(false); return
    }
    setUploading(false); onUploaded()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40"
           onClick={() => { if (!blockBackdropRef.current) onClose() }} />
      <div className="relative w-full max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-6
                      flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-[#1a202c] text-base">Carica documento</h3>
          <button type="button" onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#f0f4f8] text-[#718096] text-lg">×</button>
        </div>

        <div>
          <input ref={inputRef} type="file" className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx"
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
          <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">Titolo</label>
          <input type="text" value={titolo} onChange={e => setTitolo(e.target.value)}
            placeholder="Es. DVR 2025" className={inputCls} />
        </div>

        <div>
          <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">Categoria</label>
          <select value={categoria} onChange={e => setCategoria(e.target.value)} className={inputCls}>
            {categories.map(c => (
              <option key={c.id ?? c.name} value={c.name}>{c.emoji} {c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">
            Comunità <span className="font-normal normal-case text-[#a0aec0]">(lascia vuoto per doc. generale ente)</span>
          </label>
          <select value={structureId} onChange={e => setStructureId(e.target.value)} className={inputCls}>
            <option value="">— Documento generale ente —</option>
            {structures.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">
            Data di scadenza <span className="font-normal normal-case text-[#a0aec0]">(opzionale)</span>
          </label>
          <input type="date" value={dataScadenza} onChange={e => setDataScadenza(e.target.value)} className={inputCls} />
        </div>

        <div>
          <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">
            Note <span className="font-normal normal-case text-[#a0aec0]">(opzionale)</span>
          </label>
          <textarea value={note} onChange={e => setNote(e.target.value)}
            rows={2} placeholder="Note aggiuntive…"
            className={`${inputCls} h-auto py-2.5 resize-none`} />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <button type="button" disabled={uploading || !file} onClick={handleUpload}
          className="w-full h-12 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                     active:bg-[#152b47] disabled:opacity-60 transition-colors">
          {uploading ? 'Caricamento…' : 'Carica documento'}
        </button>
      </div>
    </div>
  )
}

// ── EditModal ─────────────────────────────────────────────────────────────────
function EditModal({ doc, structures, categories, onSaved, onClose }) {
  const [titolo,       setTitolo]       = useState(doc.titolo)
  const [categoria,    setCategoria]    = useState(doc.categoria)
  const [structureId,  setStructureId]  = useState(doc.structure_id ? String(doc.structure_id) : '')
  const [dataScadenza, setDataScadenza] = useState(doc.data_scadenza ?? '')
  const [note,         setNote]         = useState(doc.note ?? '')
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')

  async function handleSave() {
    if (!titolo.trim()) { setError('Inserisci un titolo.'); return }
    setSaving(true); setError('')
    const { error: err } = await supabase.from('org_documents')
      .update({
        titolo:        titolo.trim(),
        categoria,
        structure_id:  structureId ? Number(structureId) : null,
        data_scadenza: dataScadenza || null,
        note:          note.trim() || null,
      })
      .eq('id', doc.id)
    if (err) { setError('Errore: ' + err.message); setSaving(false); return }
    setSaving(false); onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-6
                      flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-[#1a202c] text-base">Modifica documento</h3>
          <button type="button" onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#f0f4f8] text-[#718096] text-lg">×</button>
        </div>

        <div>
          <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">Titolo</label>
          <input type="text" value={titolo} onChange={e => setTitolo(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">Categoria</label>
          <select value={categoria} onChange={e => setCategoria(e.target.value)} className={inputCls}>
            {categories.map(c => (
              <option key={c.id ?? c.name} value={c.name}>{c.emoji} {c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">
            Comunità <span className="font-normal normal-case text-[#a0aec0]">(lascia vuoto = doc. generale)</span>
          </label>
          <select value={structureId} onChange={e => setStructureId(e.target.value)} className={inputCls}>
            <option value="">— Documento generale ente —</option>
            {structures.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">
            Data di scadenza <span className="font-normal normal-case text-[#a0aec0]">(opzionale)</span>
          </label>
          <input type="date" value={dataScadenza} onChange={e => setDataScadenza(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">
            Note <span className="font-normal normal-case text-[#a0aec0]">(opzionale)</span>
          </label>
          <textarea value={note} onChange={e => setNote(e.target.value)}
            rows={2} className={`${inputCls} h-auto py-2.5 resize-none`} />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <button type="button" disabled={saving} onClick={handleSave}
          className="w-full h-12 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                     active:bg-[#152b47] disabled:opacity-60 transition-colors">
          {saving ? 'Salvataggio…' : 'Salva modifiche'}
        </button>
      </div>
    </div>
  )
}

// ── DocRow ────────────────────────────────────────────────────────────────────
function DocRow({ doc, structureName, canWrite, onEdit, onDelete }) {
  const [loading, setLoading] = useState(false)
  const [err,     setErr]     = useState(false)

  async function handleOpen(download = false) {
    setLoading(true); setErr(false)
    const { data, error } = await supabase.storage
      .from('org-documents')
      .createSignedUrl(doc.storage_path, 60)
    setLoading(false)
    if (error || !data?.signedUrl) { setErr(true); return }
    if (download) {
      try {
        const res  = await fetch(data.signedUrl)
        const blob = await res.blob()
        const url  = URL.createObjectURL(blob)
        const a    = document.createElement('a')
        a.href     = url
        a.download = doc.original_name || doc.titolo
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 10000)
      } catch {
        window.open(data.signedUrl, '_blank', 'noopener')
      }
    } else {
      window.open(data.signedUrl, '_blank', 'noopener')
    }
  }

  const isPdfOrImage = /\.(pdf|jpg|jpeg|png|gif|webp)$/i.test(doc.original_name || '')

  return (
    <div className="bg-white rounded-2xl border border-[#e2e8f0] shadow-sm px-4 py-3.5 flex items-start gap-3">
      <span className="text-2xl shrink-0 mt-0.5">{fileIcon(doc.original_name || '')}</span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[#1a202c] text-sm leading-tight truncate">{doc.titolo}</p>
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          <span className="text-[10px] text-[#718096] bg-[#f8f9fa] px-2 py-0.5 rounded-full border border-[#e2e8f0]">
            {structureName ?? 'Generale ente'}
          </span>
          {doc.file_size && <span className="text-[10px] text-[#a0aec0]">{fmtFileSize(doc.file_size)}</span>}
        </div>
        {doc.data_scadenza && <div className="mt-1.5"><ExpiryBadge dateStr={doc.data_scadenza} /></div>}
        {doc.note && <p className="text-xs text-[#718096] mt-1 leading-relaxed line-clamp-2">{doc.note}</p>}
        {err && <p className="text-xs text-red-500 mt-1">Errore apertura file</p>}
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <button type="button" disabled={loading} onClick={() => handleOpen(!isPdfOrImage)}
          title={isPdfOrImage ? 'Apri anteprima' : 'Scarica'}
          className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#eef2f7] text-[#1e3a5f]
                     active:bg-[#dde6f0] disabled:opacity-50 transition-colors">
          {loading ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
          ) : isPdfOrImage ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4"/>
            </svg>
          )}
        </button>
        {!isPdfOrImage && (
          <button type="button" disabled={loading} onClick={() => handleOpen(false)} title="Apri"
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#eef2f7] text-[#1e3a5f]
                       active:bg-[#dde6f0] disabled:opacity-50 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
            </svg>
          </button>
        )}
        {canWrite && (
          <>
            <button type="button" onClick={onEdit} title="Modifica"
              className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#f0f4f8] text-[#718096]
                         active:bg-[#e2e8f0] transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 11l6.293-6.293a1 1 0 011.414 0l1.586 1.586a1 1 0 010 1.414L12 14H9v-3z"/>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18"/>
              </svg>
            </button>
            <button type="button" onClick={onDelete} title="Elimina"
              className="w-8 h-8 flex items-center justify-center rounded-xl bg-red-50 text-red-500
                         active:bg-red-100 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── CategoryView ──────────────────────────────────────────────────────────────
function CategoryView({ catObj, docs, structures, categories, canWrite, orgId, onBack, onReload }) {
  const [search,        setSearch]        = useState('')
  const [filterStruct,  setFilterStruct]  = useState('all')
  const [filterExp,     setFilterExp]     = useState('all')
  const [showUpload,    setShowUpload]    = useState(false)
  const [editDoc,       setEditDoc]       = useState(null)
  const [deleteTarget,  setDeleteTarget]  = useState(null)
  const [deleting,      setDeleting]      = useState(false)
  const [deleteError,   setDeleteError]   = useState('')

  const structureMap = Object.fromEntries(structures.map(s => [s.id, s.name]))

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true); setDeleteError('')
    const { error } = await supabase.rpc('soft_delete_org_document', { doc_id: deleteTarget.id })
    setDeleting(false)
    if (error) { setDeleteError(error.message); return }
    setDeleteTarget(null); onReload()
  }

  const filtered = docs.filter(doc => {
    if (search && !doc.titolo.toLowerCase().includes(search.toLowerCase())) return false
    if (filterStruct === 'generale' && doc.structure_id !== null) return false
    if (filterStruct !== 'all' && filterStruct !== 'generale') {
      if (doc.structure_id !== Number(filterStruct)) return false
    }
    if (filterExp !== 'all' && expiryStatus(doc.data_scadenza) !== filterExp) return false
    return true
  })

  return (
    <div className="flex flex-col flex-1">
      {/* Sub-header */}
      <div className="flex items-center gap-3 px-4 pt-2 pb-3">
        <button type="button" onClick={onBack}
          className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#eef2f7] text-[#1e3a5f] shrink-0
                     active:bg-[#dde6f0] transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
          </svg>
        </button>
        <span className="text-2xl">{catObj.emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[#1a202c] text-sm leading-tight truncate">{catObj.name}</p>
          <p className="text-xs text-[#a0aec0]">{docs.length} document{docs.length === 1 ? 'o' : 'i'}</p>
        </div>
        {canWrite && (
          <button type="button" onClick={() => setShowUpload(true)}
            className="h-9 px-3 rounded-xl bg-[#1e3a5f] text-white font-semibold text-xs
                       flex items-center gap-1.5 shrink-0 active:bg-[#152b47] transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
            </svg>
            Carica
          </button>
        )}
      </div>

      {/* Filtri */}
      <div className="px-4 pb-3 flex flex-col gap-2">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#a0aec0]"
               fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z"/>
          </svg>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Cerca per titolo…"
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#e2e8f0] bg-white text-sm
                       text-[#1a202c] outline-none focus:border-[#1e3a5f] transition-colors" />
        </div>
        <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          <select value={filterStruct} onChange={e => setFilterStruct(e.target.value)}
            className="shrink-0 h-9 px-3 rounded-xl border border-[#e2e8f0] bg-white text-xs
                       font-semibold text-[#1a202c] outline-none focus:border-[#1e3a5f] appearance-none">
            <option value="all">Tutte le comunità</option>
            <option value="generale">Solo generali</option>
            {structures.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={filterExp} onChange={e => setFilterExp(e.target.value)}
            className="shrink-0 h-9 px-3 rounded-xl border border-[#e2e8f0] bg-white text-xs
                       font-semibold text-[#1a202c] outline-none focus:border-[#1e3a5f] appearance-none">
            <option value="all">Tutte le scadenze</option>
            <option value="valido">Valido</option>
            <option value="in-scadenza">In scadenza</option>
            <option value="scaduto">Scaduto</option>
            <option value="nessuna">Senza scadenza</option>
          </select>
        </div>
      </div>

      {/* Lista */}
      <div className="flex-1 px-4 pb-4 flex flex-col gap-3 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <span className="text-5xl mb-4">{catObj.emoji}</span>
            <p className="text-sm font-semibold text-[#1a202c] mb-1">
              {docs.length === 0 ? 'Nessun documento' : 'Nessun risultato'}
            </p>
            <p className="text-xs text-[#a0aec0]">
              {docs.length === 0
                ? 'Carica il primo documento con il pulsante in alto.'
                : 'Modifica i filtri.'}
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs text-[#a0aec0]">{filtered.length} document{filtered.length === 1 ? 'o' : 'i'}</p>
            {filtered.map(doc => (
              <DocRow
                key={doc.id}
                doc={doc}
                structureName={doc.structure_id ? structureMap[doc.structure_id] ?? null : null}
                canWrite={canWrite}
                onEdit={() => setEditDoc(doc)}
                onDelete={() => setDeleteTarget(doc)}
              />
            ))}
          </>
        )}
      </div>

      {showUpload && orgId && (
        <UploadModal
          orgId={orgId}
          structures={structures}
          defaultCategoria={catObj.name}
          categories={categories}
          onUploaded={() => { setShowUpload(false); onReload() }}
          onClose={() => setShowUpload(false)}
        />
      )}

      {editDoc && (
        <EditModal
          doc={editDoc}
          structures={structures}
          categories={categories}
          onSaved={() => { setEditDoc(null); onReload() }}
          onClose={() => setEditDoc(null)}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleteTarget(null)} />
          <div className="relative w-full max-w-sm bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-6 flex flex-col gap-4">
            <h3 className="font-bold text-[#1a202c] text-base">Elimina documento</h3>
            <p className="text-sm text-[#718096]">
              Sei sicuro di voler eliminare{' '}
              <span className="font-semibold text-[#1a202c]">"{deleteTarget.titolo}"</span>?
            </p>
            {deleteError && <p className="text-xs text-red-500">{deleteError}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={() => setDeleteTarget(null)}
                className="flex-1 h-12 rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c]
                           font-semibold text-sm active:bg-[#f8f9fa] transition-colors">Annulla</button>
              <button type="button" onClick={handleDelete} disabled={deleting}
                className="flex-1 h-12 rounded-xl bg-red-500 text-white font-semibold text-sm
                           active:bg-red-600 disabled:opacity-60 transition-colors">
                {deleting ? 'Eliminazione…' : 'Elimina'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── ArchivioGenerale (componente principale) ──────────────────────────────────
export default function ArchivioGenerale({ structures, onClose, hideBackAsLogout = false }) {
  const { profile } = useAuth()
  const isManager   = profile?.role === 'manager'
  const canWrite    = isManager || profile?.role === 'admin_secondary'
  const orgId       = profile?.organization_id

  const [docs,           setDocs]           = useState([])
  const [categories,     setCategories]     = useState([])
  const [loadingDocs,    setLoadingDocs]    = useState(true)
  const [loadingCats,    setLoadingCats]    = useState(true)
  const [activeCategory, setActiveCategory] = useState(null) // name string | null
  const [showUpload,     setShowUpload]     = useState(false)
  const [editCat,        setEditCat]        = useState(null)  // category obj to edit | 'new'

  // ── Carica categorie (e seed se empty) ──────────────────────────────────────
  async function loadCategories() {
    setLoadingCats(true)
    const { data } = await supabase
      .from('org_document_categories')
      .select('*')
      .eq('organization_id', orgId)
      .order('sort_order')
      .order('id')
    if (data && data.length > 0) {
      setCategories(data)
      setLoadingCats(false)
    } else {
      // Seed default categories — upsert con ignoreDuplicates è idempotente
      const rows = DEFAULT_CATEGORIES.map((c, i) => ({
        organization_id: orgId,
        name:            c.name,
        emoji:           c.emoji,
        sort_order:      i,
      }))
      await supabase
        .from('org_document_categories')
        .upsert(rows, { onConflict: 'organization_id,name', ignoreDuplicates: true })
      const { data: seeded } = await supabase
        .from('org_document_categories')
        .select('*')
        .eq('organization_id', orgId)
        .order('sort_order')
        .order('id')
      setCategories(seeded ?? DEFAULT_CATEGORIES.map((c, i) => ({ ...c, id: i })))
      setLoadingCats(false)
    }
  }

  async function loadDocs() {
    setLoadingDocs(true)
    const { data } = await supabase
      .from('org_documents')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    setDocs(data ?? [])
    setLoadingDocs(false)
  }

  useEffect(() => {
    if (!orgId) return
    loadCategories()
    loadDocs()
  }, [orgId])

  // ── Docs per categoria (by name) ─────────────────────────────────────────────
  const docsByCategory = {}
  for (const cat of categories) {
    docsByCategory[cat.name] = docs.filter(d => d.categoria === cat.name)
  }

  function categoryHasAlert(catName) {
    return (docsByCategory[catName] ?? []).some(d => {
      const s = expiryStatus(d.data_scadenza)
      return s === 'scaduto' || s === 'in-scadenza'
    })
  }

  const activeCatObj = categories.find(c => c.name === activeCategory) ?? null
  const totalDocs    = docs.length
  const scaduti      = docs.filter(d => expiryStatus(d.data_scadenza) === 'scaduto').length
  const inScadenza   = docs.filter(d => expiryStatus(d.data_scadenza) === 'in-scadenza').length
  const loading      = loadingDocs || loadingCats

  // ── Gestione rinomina categoria (aggiorna anche i doc) ───────────────────────
  async function handleCatSaved(newName, oldName) {
    if (oldName && oldName !== newName) {
      // aggiorna categoria su tutti i doc con il vecchio nome
      await supabase.from('org_documents')
        .update({ categoria: newName })
        .eq('organization_id', orgId)
        .eq('categoria', oldName)
        .is('deleted_at', null)
    }
    setEditCat(null)
    await loadCategories()
    await loadDocs()
    // se eravamo nella categoria rinominata, aggiorna il nome attivo
    if (oldName && activeCategory === oldName) setActiveCategory(newName)
  }

  async function handleDeleteCat(cat) {
    const docsInCat = docsByCategory[cat.name] ?? []
    if (docsInCat.length > 0) return // non eliminare se ha doc
    await supabase.from('org_document_categories').delete().eq('id', cat.id)
    await loadCategories()
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex flex-col">

      {/* ── Header ── */}
      <header className="bg-[#1e3a5f] px-4 flex items-center gap-3 sticky top-0 z-10 shadow-sm"
              style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)', paddingBottom: '0.75rem' }}>
        {activeCategory ? (
          <button type="button" onClick={() => setActiveCategory(null)}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/15 text-white shrink-0
                       active:bg-white/25 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
            </svg>
          </button>
        ) : hideBackAsLogout ? (
          <button type="button" onClick={onClose}
            className="h-9 px-3 rounded-xl bg-white/15 text-white text-xs font-semibold shrink-0
                       active:bg-white/25 transition-colors">
            Esci
          </button>
        ) : (
          <button type="button" onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/15 text-white shrink-0
                       active:bg-white/25 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
            </svg>
          </button>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm truncate">
            {activeCategory ? activeCatObj?.name : 'Archivio Generale'}
          </p>
          {!activeCategory && (scaduti > 0 || inScadenza > 0) && (
            <p className="text-white/70 text-xs mt-0.5">
              {scaduti > 0 && `${scaduti} scadut${scaduti === 1 ? 'o' : 'i'}`}
              {scaduti > 0 && inScadenza > 0 && ' · '}
              {inScadenza > 0 && `${inScadenza} in scadenza`}
            </p>
          )}
        </div>
        {!activeCategory && canWrite && (
          <button type="button" onClick={() => setShowUpload(true)}
            className="h-9 px-3 rounded-xl bg-white text-[#1e3a5f] font-semibold text-xs
                       flex items-center gap-1.5 shrink-0 active:bg-[#f0f4f8] transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
            </svg>
            Carica
          </button>
        )}
      </header>

      {/* ── Vista cartelle ── */}
      {!activeCategory && (
        <main className="flex-1 px-4 py-5 max-w-lg mx-auto w-full">
          {loading ? (
            <div className="grid grid-cols-2 gap-3">
              {[1,2,3,4,5,6,7].map(i => (
                <div key={i} className="h-28 rounded-2xl bg-white border border-[#e2e8f0] animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              {totalDocs > 0 && (
                <p className="text-xs text-[#a0aec0] mb-4">
                  {totalDocs} document{totalDocs === 1 ? 'o' : 'i'} totali
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                {categories.map(cat => {
                  const count    = (docsByCategory[cat.name] ?? []).length
                  const hasAlert = categoryHasAlert(cat.name)
                  return (
                    <div key={cat.id ?? cat.name} className="relative group">
                      <button
                        type="button"
                        onClick={() => setActiveCategory(cat.name)}
                        className="w-full relative bg-white rounded-2xl border border-[#e2e8f0] shadow-sm
                                   p-4 flex flex-col items-center gap-2 text-center
                                   active:bg-[#f0f4f8] hover:border-[#1e3a5f]/30 hover:shadow-md
                                   transition-all"
                      >
                        {hasAlert && (
                          <span className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full bg-red-500" />
                        )}
                        <span className="text-4xl leading-none">{cat.emoji}</span>
                        <p className="text-xs font-semibold text-[#1a202c] leading-tight line-clamp-2">{cat.name}</p>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          count > 0 ? 'bg-[#eef2f7] text-[#1e3a5f]' : 'bg-[#f3f4f6] text-[#a0aec0]'
                        }`}>
                          {count} doc{count === 1 ? '' : 's'}
                        </span>
                      </button>
                      {/* Edit button (solo manager e coordinator) */}
                      {canWrite && (
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); setEditCat(cat) }}
                          className="absolute top-1.5 left-1.5 w-6 h-6 flex items-center justify-center
                                     rounded-lg bg-white text-[#a0aec0] shadow-sm border border-[#e2e8f0]
                                     hover:text-[#1e3a5f] hover:border-[#1e3a5f]/30 active:bg-[#eef2f7]
                                     transition-colors">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 11l6.293-6.293a1 1 0 011.414 0l1.586 1.586a1 1 0 010 1.414L12 14H9v-3z"/>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  )
                })}

                {/* Card "Nuova cartella" */}
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => setEditCat('new')}
                    className="bg-white rounded-2xl border-2 border-dashed border-[#e2e8f0]
                               p-4 flex flex-col items-center gap-2 text-center
                               hover:border-[#1e3a5f]/40 hover:bg-[#f8f9fa] active:bg-[#f0f4f8]
                               transition-all">
                    <span className="w-10 h-10 rounded-full bg-[#eef2f7] flex items-center justify-center text-[#1e3a5f]">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
                      </svg>
                    </span>
                    <p className="text-xs font-semibold text-[#a0aec0]">Nuova cartella</p>
                  </button>
                )}
              </div>

            </>
          )}
        </main>
      )}

      {/* ── Vista categoria ── */}
      {activeCategory && activeCatObj && (
        <CategoryView
          catObj={activeCatObj}
          docs={docsByCategory[activeCategory] ?? []}
          structures={structures}
          categories={categories}
          canWrite={canWrite}
          orgId={orgId}
          onBack={() => setActiveCategory(null)}
          onReload={loadDocs}
        />
      )}

      {/* Upload dalla home cartelle */}
      {showUpload && orgId && categories.length > 0 && (
        <UploadModal
          orgId={orgId}
          structures={structures}
          defaultCategoria={null}
          categories={categories}
          onUploaded={() => { setShowUpload(false); loadDocs() }}
          onClose={() => setShowUpload(false)}
        />
      )}

      {/* Edit / crea categoria */}
      {editCat && (
        <CategoryEditModal
          orgId={orgId}
          existing={editCat === 'new' ? null : editCat}
          canDelete={editCat !== 'new' && isManager && (docsByCategory[editCat?.name] ?? []).length === 0}
          onSaved={handleCatSaved}
          onDelete={() => { handleDeleteCat(editCat); setEditCat(null) }}
          onClose={() => setEditCat(null)}
        />
      )}
    </div>
  )
}
