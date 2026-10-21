import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

export default function StructureInfoPage({ structure, profile, onLogoChange, onDeleteSuccess }) {
  const isManager  = profile?.role === 'manager'
  // Coordinatori possono gestire le impostazioni della struttura ma non eliminarla
  const canManage  = isManager || profile?.role === 'admin_secondary'

  // ── Stats ─────────────────────────────────────────────────────────────────
  const [stats,        setStats]        = useState(null)   // { operators, residents }
  const [loadingStats, setLoadingStats] = useState(true)

  // ── Capacità ──────────────────────────────────────────────────────────────
  const [capacity,      setCapacity]      = useState(structure.capacity ?? null)
  const [editingCap,    setEditingCap]    = useState(false)
  const [capInput,      setCapInput]      = useState(String(structure.capacity ?? ''))
  const [savingCap,     setSavingCap]     = useState(false)

  // ── Logo ──────────────────────────────────────────────────────────────────
  const [logoUrl,      setLogoUrl]      = useState(structure.logo_url ?? null)
  const [uploadingLogo,setUploadingLogo]= useState(false)
  const [logoError,    setLogoError]    = useState('')
  const fileInputRef = useRef(null)

  // ── Contatti struttura ────────────────────────────────────────────────────
  const [contactEmail,    setContactEmail]    = useState('')
  const [contactPhone,    setContactPhone]    = useState('')
  const [savingContacts,  setSavingContacts]  = useState(false)
  const [contactsSaved,   setContactsSaved]   = useState(false)

  // ── Note private ──────────────────────────────────────────────────────────
  const [notes,        setNotes]        = useState('')
  const [savingNotes,  setSavingNotes]  = useState(false)
  const [notesSaved,   setNotesSaved]   = useState(false)
  const [loadingNotes, setLoadingNotes] = useState(canManage)

  // ── Eliminazione struttura ─────────────────────────────────────────────────
  const [showDeleteModal,   setShowDeleteModal]   = useState(false)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleting,          setDeleting]          = useState(false)
  const [deleteError,       setDeleteError]        = useState('')

  async function loadStats() {
    if (!structure?.id) return
    setLoadingStats(true)

    const [opRes, resRes] = await Promise.all([
      supabase.rpc('count_structure_operators', { p_structure_id: structure.id }),
      supabase
        .from('residents')
        .select('id', { count: 'exact', head: true })
        .eq('structure_id', structure.id)
        .eq('is_archived', false),
    ])

    setStats({
      operators: opRes.data ?? 0,
      residents: resRes.count ?? 0,
    })
    setLoadingStats(false)
  }

  useEffect(() => {
    if (!structure?.id) return

    async function load() {
      await loadStats()

      if (canManage) {
        const { data: sData } = await supabase
          .from('structures')
          .select('notes_private, logo_url, email, phone, capacity')
          .eq('id', structure.id)
          .maybeSingle()

        if (sData) {
          setNotes(sData.notes_private ?? '')
          setContactEmail(sData.email ?? '')
          setContactPhone(sData.phone ?? '')
          if (sData.logo_url) setLogoUrl(sData.logo_url)
          if (sData.capacity != null) {
            setCapacity(sData.capacity)
            setCapInput(String(sData.capacity))
          }
        }
      }

      setLoadingNotes(false)
    }

    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structure?.id, canManage])

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
    if (!allowed.includes(file.type)) {
      setLogoError('Formato non supportato. Usa JPG, PNG, WebP o SVG.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setLogoError('Il file supera il limite di 5 MB.')
      return
    }

    setLogoError('')
    setUploadingLogo(true)

    const ext  = file.name.split('.').pop()
    const path = `${structure.id}/logo.${ext}`

    const { error: upErr } = await supabase.storage
      .from('structure-logos')
      .upload(path, file, { upsert: true, contentType: file.type })

    if (upErr) {
      setLogoError('Errore nel caricamento. Riprova.')
      setUploadingLogo(false)
      return
    }

    const { data: { publicUrl } } = supabase.storage
      .from('structure-logos')
      .getPublicUrl(path)

    // Cache-buster per forzare refresh browser
    const urlWithBust = publicUrl + '?t=' + Date.now()

    const { error: dbErr } = await supabase
      .from('structures')
      .update({ logo_url: urlWithBust })
      .eq('id', structure.id)

    if (dbErr) {
      setLogoError('File caricato ma errore nel salvataggio: ' + dbErr.message)
      setUploadingLogo(false)
      return
    }

    setLogoUrl(urlWithBust)
    onLogoChange?.(urlWithBust)
    setUploadingLogo(false)

    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleDeleteLogo() {
    setUploadingLogo(true)
    // Prova a rimuovere tutte le estensioni possibili
    await supabase.storage.from('structure-logos').remove([
      `${structure.id}/logo.jpg`,
      `${structure.id}/logo.jpeg`,
      `${structure.id}/logo.png`,
      `${structure.id}/logo.webp`,
      `${structure.id}/logo.svg`,
    ])
    await supabase.from('structures').update({ logo_url: null }).eq('id', structure.id)
    setLogoUrl(null)
    onLogoChange?.(null)
    setUploadingLogo(false)
  }

  async function saveContacts() {
    setSavingContacts(true)
    const { error: err } = await supabase
      .from('structures')
      .update({ email: contactEmail.trim() || null, phone: contactPhone.trim() || null })
      .eq('id', structure.id)
    setSavingContacts(false)
    if (err) { console.error('saveContacts error:', err); return }
    setContactsSaved(true)
    setTimeout(() => setContactsSaved(false), 2500)
    loadStats()
  }

  async function saveNotes() {
    setSavingNotes(true)
    const { error: err } = await supabase
      .from('structures')
      .update({ notes_private: notes })
      .eq('id', structure.id)
    setSavingNotes(false)
    if (err) { console.error('saveNotes error:', err); return }
    setNotesSaved(true)
    setTimeout(() => setNotesSaved(false), 2500)
  }

  async function saveCapacity() {
    const val = parseInt(capInput, 10)
    if (isNaN(val) || val < 0) return
    setSavingCap(true)
    const { error: err } = await supabase
      .from('structures')
      .update({ capacity: val })
      .eq('id', structure.id)
    setSavingCap(false)
    if (err) { console.error('saveCapacity error:', err); return }
    setCapacity(val)
    setEditingCap(false)
    loadStats()
  }

  async function handleDeleteStructure() {
    setDeleting(true)
    setDeleteError('')
    try {
      // 1. Recupera operatori assegnati alla struttura
      const { data: ops } = await supabase
        .from('profiles')
        .select('id')
        .eq('structure_id', structure.id)
        .in('role', ['operator', 'admin_secondary'])
      const opIds = (ops ?? []).map(o => o.id)

      // 2. Elimina assenze degli operatori
      if (opIds.length > 0) {
        await supabase.from('absences').delete().in('user_id', opIds)
        await supabase.from('notifications').delete().in('user_id', opIds)
      }

      // 3. Elimina dati della struttura
      await supabase.from('schedules').delete().eq('structure_id', structure.id)
      await supabase.from('diaries').delete().eq('structure_id', structure.id)
      await supabase.from('residents').delete().eq('structure_id', structure.id)
      await supabase.from('invitation_codes').delete().eq('structure_id', structure.id)

      // 4. Rimuovi ogni operatore (RPC gestisce auth.users)
      for (const id of opIds) {
        await supabase.rpc('remove_operator', { p_user_id: id })
      }

      // 5. Rimuovi logo dallo storage
      await supabase.storage.from('structure-logos').remove([
        `${structure.id}/logo.jpg`, `${structure.id}/logo.jpeg`,
        `${structure.id}/logo.png`, `${structure.id}/logo.webp`,
        `${structure.id}/logo.svg`,
      ])

      // 6. Elimina la struttura
      const { error } = await supabase.from('structures').delete().eq('id', structure.id)
      if (error) throw error

      onDeleteSuccess?.(structure.id)
    } catch (err) {
      setDeleteError(err.message ?? 'Errore durante l\'eliminazione.')
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 pb-10">

      {/* ── Hero: nome + indirizzo ── */}
      <div className="bg-white rounded-2xl border border-[#e2e8f0] px-5 py-5 shadow-sm">
        <div className="flex items-start gap-4">

          {/* Logo */}
          <div className="shrink-0">
            {logoUrl ? (
              <div className="relative">
                <img
                  src={logoUrl}
                  alt="Logo struttura"
                  className="w-16 h-16 rounded-2xl object-cover border border-[#e2e8f0] bg-[#f8f9fa]"
                />
                {canManage && (
                  <button
                    type="button"
                    onClick={handleDeleteLogo}
                    disabled={uploadingLogo}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white
                               flex items-center justify-center text-[10px] leading-none
                               active:bg-red-600 transition-colors shadow"
                    title="Rimuovi logo"
                  >
                    ×
                  </button>
                )}
              </div>
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-[#eef2f7] flex items-center justify-center">
                <span className="text-2xl leading-none">🏢</span>
              </div>
            )}
          </div>

          {/* Info testuali */}
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-[#1a202c] leading-tight">{structure.name}</h2>
            {structure.address && (
              <p className="text-sm text-[#718096] mt-1 leading-snug">{structure.address}</p>
            )}
            {structure.type && (
              <span className="inline-block mt-2 text-[11px] font-semibold rounded-full px-2.5 py-0.5
                               bg-[#eef2f7] text-[#1e3a5f]">
                {structure.type}
              </span>
            )}
          </div>
        </div>

        {/* Upload logo (manager e coordinatore) */}
        {canManage && (
          <div className="mt-4 pt-4 border-t border-[#f0f4f8]">
            <label className={`flex items-center gap-2.5 cursor-pointer
              ${uploadingLogo ? 'opacity-60 pointer-events-none' : ''}`}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/svg+xml"
                className="hidden"
                onChange={handleLogoUpload}
                disabled={uploadingLogo}
              />
              <div className="w-8 h-8 rounded-xl bg-[#eef2f7] flex items-center justify-center shrink-0">
                {uploadingLogo ? (
                  <svg className="w-4 h-4 text-[#1e3a5f] animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-[#1e3a5f]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                )}
              </div>
              <span className="text-sm font-medium text-[#1e3a5f]">
                {uploadingLogo ? 'Caricamento…' : logoUrl ? 'Sostituisci logo' : 'Carica logo struttura'}
              </span>
            </label>
            {logoError && <p className="text-xs text-red-500 mt-1.5">{logoError}</p>}
          </div>
        )}
      </div>

      {/* ── Contatti struttura (manager e coordinatore) ── */}
      {canManage && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <p className="text-[11px] font-bold text-[#718096] uppercase tracking-wider">
              Contatti comunità
            </p>
            <span className="flex-1 h-px bg-[#e2e8f0]" />
          </div>
          <div className="bg-white rounded-2xl border border-[#e2e8f0] px-5 py-4 shadow-sm flex flex-col gap-3">
            <div>
              <label className="text-xs font-semibold text-[#718096] block mb-1.5">
                Email comunità
              </label>
              <input
                type="email"
                value={contactEmail}
                onChange={e => setContactEmail(e.target.value)}
                placeholder="es. info@nomecomunita.it"
                className="w-full h-11 px-3 rounded-xl border border-[#e2e8f0] bg-white text-sm
                  text-[#1a202c] outline-none focus:border-[#1e3a5f] focus:ring-2
                  focus:ring-[#1e3a5f]/20 transition-colors placeholder:text-[#a0aec0]"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#718096] block mb-1.5">
                Telefono di riferimento
              </label>
              <input
                type="tel"
                value={contactPhone}
                onChange={e => setContactPhone(e.target.value)}
                placeholder="es. +39 02 1234567"
                className="w-full h-11 px-3 rounded-xl border border-[#e2e8f0] bg-white text-sm
                  text-[#1a202c] outline-none focus:border-[#1e3a5f] focus:ring-2
                  focus:ring-[#1e3a5f]/20 transition-colors placeholder:text-[#a0aec0]"
              />
            </div>
            <p className="text-[10px] text-[#a0aec0] -mt-1">
              Visibili a tutti gli operatori nella sezione Impostazioni.
            </p>
            <button
              type="button"
              onClick={saveContacts}
              disabled={savingContacts}
              className={`w-full h-11 rounded-xl font-semibold text-sm transition-colors
                ${contactsSaved
                  ? 'bg-green-500 text-white'
                  : 'bg-[#1e3a5f] text-white active:bg-[#152b47] disabled:opacity-60'}`}
            >
              {savingContacts ? 'Salvataggio…' : contactsSaved ? '✓ Contatti salvati' : 'Salva contatti'}
            </button>
          </div>
        </div>
      )}

      {/* ── Stats ── */}
      <div>
        <p className="text-[11px] font-bold text-[#718096] uppercase tracking-wider mb-3">
          Riepilogo
        </p>
        <div className="grid grid-cols-2 gap-3">

          {/* Operatori */}
          <div className="bg-white rounded-2xl border border-[#e2e8f0] px-4 py-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg leading-none">👥</span>
              <p className="text-xs font-semibold text-[#718096]">Personale</p>
            </div>
            {loadingStats ? (
              <div className="h-8 rounded-lg bg-[#f0f4f8] animate-pulse" />
            ) : (
              <p className="text-3xl font-bold text-[#1e3a5f] leading-none">
                {stats?.operators ?? 0}
              </p>
            )}
            <p className="text-[11px] text-[#a0aec0] mt-1">operatori assegnati</p>
          </div>

          {/* Residenti */}
          <div className="bg-white rounded-2xl border border-[#e2e8f0] px-4 py-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg leading-none">🏠</span>
              <p className="text-xs font-semibold text-[#718096]">Residenti</p>
            </div>
            {loadingStats ? (
              <div className="h-8 rounded-lg bg-[#f0f4f8] animate-pulse" />
            ) : (
              <div className="flex items-end gap-1.5">
                <p className="text-3xl font-bold text-[#1e3a5f] leading-none">
                  {stats?.residents ?? 0}
                </p>
                {capacity != null && (
                  <p className="text-sm text-[#a0aec0] mb-0.5">/ {capacity}</p>
                )}
              </div>
            )}
            <p className="text-[11px] text-[#a0aec0] mt-1">
              {capacity != null ? 'attivi su capacità massima' : 'attivi'}
            </p>
          </div>

          {/* Capacità modificabile (solo manager/coordinatore) */}
          {canManage && (
            <div className="col-span-2 bg-white rounded-2xl border border-[#e2e8f0] px-4 py-3.5 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-[#718096]">Capacità massima</p>
                {!editingCap && (
                  <button type="button" onClick={() => { setEditingCap(true); setCapInput(String(capacity ?? '')) }}
                    className="text-[11px] font-semibold text-[#1e3a5f] px-2 py-1 rounded-lg
                               bg-[#eef2f7] active:bg-[#dbeafe] transition-colors">
                    Modifica
                  </button>
                )}
              </div>

              {editingCap ? (
                <div className="flex items-center gap-2">
                  <button type="button"
                    onClick={() => setCapInput(v => String(Math.max(0, (parseInt(v,10)||0) - 1)))}
                    className="w-9 h-9 rounded-xl bg-[#f0f4f8] text-[#1e3a5f] font-bold text-lg
                               flex items-center justify-center active:bg-[#dbeafe] transition-colors">
                    −
                  </button>
                  <input
                    type="number" min="0" value={capInput}
                    onChange={e => setCapInput(e.target.value)}
                    className="w-20 h-9 text-center rounded-xl border border-[#e2e8f0] text-sm
                               font-bold text-[#1a202c] outline-none focus:border-[#1e3a5f] transition-colors"
                  />
                  <button type="button"
                    onClick={() => setCapInput(v => String((parseInt(v,10)||0) + 1))}
                    className="w-9 h-9 rounded-xl bg-[#f0f4f8] text-[#1e3a5f] font-bold text-lg
                               flex items-center justify-center active:bg-[#dbeafe] transition-colors">
                    +
                  </button>
                  <button type="button" onClick={saveCapacity} disabled={savingCap}
                    className="flex-1 h-9 rounded-xl bg-[#1e3a5f] text-white text-xs font-semibold
                               active:bg-[#152b47] disabled:opacity-60 transition-colors">
                    {savingCap ? '…' : 'Salva'}
                  </button>
                  <button type="button" onClick={() => setEditingCap(false)}
                    className="h-9 px-3 rounded-xl border border-[#e2e8f0] text-xs font-semibold
                               text-[#718096] active:bg-[#f8f9fa] transition-colors">
                    Annulla
                  </button>
                </div>
              ) : (
                <p className="text-2xl font-bold text-[#1e3a5f]">
                  {capacity != null ? capacity : <span className="text-sm text-[#a0aec0] font-normal">Non impostata</span>}
                </p>
              )}

              {/* Barra occupazione */}
              {capacity != null && !loadingStats && stats && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[11px] text-[#718096]">Occupazione</p>
                    <p className="text-[11px] font-bold"
                      style={{ color: stats.residents > capacity ? '#ef4444' : '#1e3a5f' }}>
                      {Math.round((stats.residents / capacity) * 100)}%
                    </p>
                  </div>
                  <div className="w-full h-2 bg-[#f0f4f8] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(100, Math.round((stats.residents / capacity) * 100))}%`,
                        backgroundColor: stats.residents > capacity ? '#ef4444' : '#1e3a5f',
                      }}
                    />
                  </div>
                  {stats.residents >= capacity && (
                    <p className="text-[11px] text-red-500 font-semibold mt-1.5">
                      ⚠️ Capacità massima raggiunta
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Note private (manager e coordinatore) ── */}
      {canManage && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <p className="text-[11px] font-bold text-[#718096] uppercase tracking-wider">
              Note Private (Solo Manager)
            </p>
            <span className="flex-1 h-px bg-[#e2e8f0]" />
            <span className="text-[10px] text-[#a0aec0] shrink-0">🔒 riservato</span>
          </div>
          {loadingNotes ? (
            <div className="h-24 rounded-2xl bg-[#f0f4f8] animate-pulse" />
          ) : (
            <>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={4}
                placeholder="Annotazioni riservate sulla struttura: fornitori, accordi, criticità, contatti utili…"
                className="w-full rounded-2xl border border-[#e2e8f0] px-4 py-3 text-sm text-[#1a202c]
                           bg-white outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                           transition-colors resize-none placeholder:text-[#a0aec0]"
              />
              <p className="text-xs text-[#a0aec0] mt-1.5 mb-3">
                Visibili solo al Responsabile. Gli operatori non possono accedere a questa sezione.
              </p>
              <button
                type="button"
                onClick={saveNotes}
                disabled={savingNotes}
                className={`w-full h-11 rounded-xl font-semibold text-sm transition-colors
                  ${notesSaved
                    ? 'bg-green-500 text-white'
                    : 'bg-[#1e3a5f] text-white active:bg-[#152b47] disabled:opacity-60'}`}
              >
                {savingNotes ? 'Salvataggio…' : notesSaved ? '✓ Note salvate' : 'Salva note'}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Gestione Account e Dati (solo manager) ── */}
      {isManager && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <p className="text-[11px] font-bold text-[#718096] uppercase tracking-wider">
              Gestione Account e Dati
            </p>
            <span className="flex-1 h-px bg-[#e2e8f0]" />
          </div>
          <div className="bg-white rounded-2xl border border-[#e2e8f0] px-5 py-4 shadow-sm">
            <p className="text-sm font-medium text-[#1a202c] mb-1">Elimina struttura</p>
            <p className="text-xs text-[#718096] mb-4 leading-relaxed">
              Rimuove permanentemente la struttura, tutti i turni, i diari, i residenti e gli operatori associati.
            </p>
            <button
              type="button"
              onClick={() => { setShowDeleteModal(true); setDeleteConfirmName(''); setDeleteError('') }}
              className="h-10 px-4 rounded-xl border border-red-300 text-red-600 text-sm font-semibold
                         bg-white hover:bg-red-600 hover:text-white hover:border-red-600
                         transition-colors duration-150"
            >
              Elimina Struttura
            </button>
          </div>
        </div>
      )}

      {/* ── Modal conferma eliminazione ── */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => !deleting && setShowDeleteModal(false)}
          />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">

            {/* Header */}
            <div className="px-6 pt-6 pb-4 border-b border-[#e2e8f0]">
              <p className="text-base font-bold text-[#1a202c]">Conferma eliminazione struttura</p>
            </div>

            {/* Body */}
            <div className="px-6 py-5 flex flex-col gap-4">
              <p className="text-sm text-[#4a5568] leading-relaxed">
                L'operazione è definitiva. Tutti i dati relativi a turni, diari, operatori e residenti
                verranno rimossi permanentemente in conformità con le norme GDPR.
              </p>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[#718096]">
                  Per confermare, digita il nome della struttura:
                  <span className="text-[#1a202c] font-bold ml-1">{structure.name}</span>
                </label>
                <input
                  type="text"
                  value={deleteConfirmName}
                  onChange={e => setDeleteConfirmName(e.target.value)}
                  placeholder={structure.name}
                  disabled={deleting}
                  className="w-full h-11 px-4 rounded-xl border border-[#e2e8f0] text-sm text-[#1a202c]
                             outline-none focus:border-red-400 focus:ring-2 focus:ring-red-200
                             disabled:opacity-60 transition-colors placeholder:text-[#a0aec0]"
                  autoComplete="off"
                />
              </div>

              {deleteError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                  {deleteError}
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 pb-6 flex gap-3">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 h-11 rounded-xl border border-[#e2e8f0] text-sm font-semibold
                           text-[#718096] bg-white active:bg-[#f8f9fa] disabled:opacity-60 transition-colors"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={deleting || deleteConfirmName !== structure.name}
                onClick={handleDeleteStructure}
                className="flex-1 h-11 rounded-xl bg-red-600 text-white text-sm font-semibold
                           active:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {deleting ? 'Eliminazione…' : 'Elimina definitivamente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
