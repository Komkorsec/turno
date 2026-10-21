import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useError } from '../../contexts/ErrorContext'
import TagManager from './TagManager'

// ─── Costanti locali ──────────────────────────────────────────────────────────

const ROLE_LABELS = { operator: 'Operatore', admin_secondary: 'Coordinatore', manager: 'Responsabile' }

const ABSENCE_STATUS_CFG = {
  pending:  { label: 'In attesa', bg: '#fef3c7', text: '#92400e' },
  approved: { label: 'Approvata', bg: '#d1fae5', text: '#065f46' },
  rejected: { label: 'Rifiutata', bg: '#fee2e2', text: '#991b1b' },
}

const SLOT_LABELS = {
  giorno_intero:  'Giorno intero',
  mattina:        'Mattina (06–14)',
  pomeriggio:     'Pomeriggio (14–22)',
  notte:          'Notte (22–06)',
  personalizzata: 'Personalizzata',
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

function groupDateLabel(records) {
  const sorted = [...records].sort((a, b) => a.start_date.localeCompare(b.start_date))
  const first = sorted[0].start_date
  const last  = sorted[sorted.length - 1].end_date ?? sorted[sorted.length - 1].start_date
  if (first === last) return fmtAbsDate(first)
  return fmtAbsDate(first) + ' → ' + fmtAbsDate(last)
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

// ─── Sezione strutture assegnate ─────────────────────────────────────────────

function StructureEditor({ member, structures, memberStructureIds, onSaved }) {
  const { reportError } = useError()
  const [draft,        setDraft]        = useState(null)   // null = sola lettura
  const [saving,       setSaving]       = useState(false)
  const [conflicts,    setConflicts]    = useState([])
  const [showConflict, setShowConflict] = useState(false)

  // Strutture dell'org non ancora nel draft
  const activeIds  = draft ?? memberStructureIds
  const assigned   = activeIds.map(id => structures.find(s => s.id === id)).filter(Boolean)
  const available  = structures.filter(s => !activeIds.includes(s.id))

  function startEditing() {
    setDraft([...memberStructureIds])
    setConflicts([])
    setShowConflict(false)
  }

  function cancelEditing() {
    setDraft(null)
    setConflicts([])
    setShowConflict(false)
  }

  function addStructure(id) {
    setDraft(d => [...d, parseInt(id, 10)])
  }

  function removeStructure(id) {
    if (draft.length <= 1) return
    setDraft(d => d.filter(x => x !== id))
  }

  async function handleSave(removeSchedules = false) {
    if (!draft) return
    setSaving(true)

    // Se non stiamo già mostrando il conflict dialog: controlla impatto
    if (!showConflict) {
      const removedIds = memberStructureIds.filter(id => !draft.includes(id))
      if (removedIds.length > 0) {
        const { data, error: checkErr } = await supabase.rpc(
          'check_structure_removal_impact',
          { p_user_id: member.id, p_remove_ids: removedIds }
        )
        if (!checkErr && data?.length > 0) {
          setConflicts(data)
          setShowConflict(true)
          setSaving(false)
          return
        }
      }
    }

    const { error } = await supabase.rpc('update_user_structures', {
      p_user_id:                  member.id,
      p_structure_ids:            draft,
      p_remove_future_schedules:  removeSchedules,
    })

    setSaving(false)
    if (error) {
      reportError(error.message, 'aggiornamento strutture')
      return
    }

    onSaved(draft)
    setDraft(null)
    setConflicts([])
    setShowConflict(false)
  }

  // Se l'org ha una sola struttura non serve la sezione di modifica
  if (structures.length <= 1 && !memberStructureIds.length) return null

  const canEdit = structures.length > 1

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <p className="text-xs font-bold text-[#1e3a5f] uppercase tracking-wide">
          Strutture assegnate
        </p>
        <span className="flex-1 h-px bg-[#e2e8f0]" />
        {draft === null && canEdit && (
          <button
            type="button"
            onClick={startEditing}
            className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-[#eef2f7] text-[#1e3a5f]
                       active:bg-[#dde6f0] transition-colors"
          >
            Modifica
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {/* Strutture assegnate */}
        {assigned.map(s => (
          <div key={s.id}
            className="flex items-center justify-between bg-[#f8f9fa] rounded-xl px-4 py-3">
            <p className="text-sm text-[#1a202c] font-medium">{s.name}</p>
            {draft !== null && (
              assigned.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeStructure(s.id)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg
                             bg-red-50 text-red-400 active:bg-red-100 transition-colors"
                  aria-label={`Rimuovi ${s.name}`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              ) : (
                <span className="text-[11px] text-[#a0aec0] font-medium">unica struttura</span>
              )
            )}
          </div>
        ))}

        {/* Dropdown aggiungi struttura */}
        {draft !== null && available.length > 0 && (
          <select
            defaultValue=""
            onChange={e => { if (e.target.value) { addStructure(e.target.value); e.target.value = '' } }}
            className="w-full h-11 px-3 rounded-xl border-2 border-dashed border-[#1e3a5f]/40 bg-white
                       text-sm text-[#1e3a5f] font-medium outline-none cursor-pointer
                       focus:border-[#1e3a5f] transition-colors"
          >
            <option value="" disabled>+ Aggiungi struttura…</option>
            {available.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}

        {/* Avviso turni futuri */}
        {showConflict && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 flex flex-col gap-3">
            <p className="text-sm font-semibold text-amber-800">
              Turni futuri assegnati in queste strutture
            </p>
            <div className="flex flex-col gap-1.5">
              {conflicts.map(c => (
                <div key={c.structure_id}
                  className="flex items-center justify-between rounded-xl bg-amber-100/60 px-3 py-2">
                  <p className="text-xs font-semibold text-amber-800">{c.structure_name}</p>
                  <p className="text-xs text-amber-700">
                    {c.schedule_count} turni
                    {c.has_published && <span className="ml-1 font-semibold">(pubblicati)</span>}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-xs text-amber-700 leading-relaxed">
              L'operatore sarà rimosso dalla struttura ma i turni storici restano.
              Cosa vuoi fare con i turni <strong>futuri</strong>?
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => handleSave(false)}
                disabled={saving}
                className="w-full h-10 rounded-xl bg-[#1e3a5f] text-white text-sm font-semibold
                           active:bg-[#152b47] disabled:opacity-60 transition-colors"
              >
                {saving ? 'Salvataggio…' : 'Mantieni i turni futuri'}
              </button>
              <button
                type="button"
                onClick={() => handleSave(true)}
                disabled={saving}
                className="w-full h-10 rounded-xl border border-red-300 bg-red-50 text-red-700
                           text-sm font-semibold active:bg-red-100 disabled:opacity-60 transition-colors"
              >
                {saving ? 'Salvataggio…' : 'Rimuovi i turni futuri'}
              </button>
              <button
                type="button"
                onClick={() => { setShowConflict(false); setConflicts([]) }}
                className="w-full h-10 rounded-xl border border-[#e2e8f0] text-[#718096]
                           text-sm font-semibold active:bg-[#f0f4f8] transition-colors"
              >
                Annulla
              </button>
            </div>
          </div>
        )}

        {/* Salva / Annulla */}
        {draft !== null && !showConflict && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={cancelEditing}
              className="flex-1 h-10 rounded-xl border border-[#e2e8f0] text-[#718096]
                         text-sm font-semibold active:bg-[#f0f4f8] transition-colors"
            >
              Annulla
            </button>
            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={saving}
              className="flex-1 h-10 rounded-xl bg-[#1e3a5f] text-white text-sm font-semibold
                         active:bg-[#152b47] disabled:opacity-60 transition-colors"
            >
              {saving ? 'Salvataggio…' : 'Salva'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}


// ─── Sezione fine rapporto ────────────────────────────────────────────────────

function TerminateSection({ member, structures, memberStructureIds, onTerminate }) {
  const [confirm, setConfirm] = useState(false)

  const isMultiStructure = memberStructureIds.length > 1
  const currentStructureName = structures.find(s => s.id === member.structure_id)?.name ?? 'questa struttura'

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <p className="text-xs font-bold text-[#718096] uppercase tracking-wide">
          Fine Rapporto
        </p>
        <span className="flex-1 h-px bg-[#e2e8f0]" />
      </div>
      {!confirm ? (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          className="w-full h-11 rounded-xl border border-amber-200 bg-amber-50 text-amber-700
                     text-sm font-semibold active:bg-amber-100 transition-colors"
        >
          Termina Rapporto
        </button>
      ) : (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 flex flex-col gap-3">
          <p className="text-sm font-semibold text-amber-800">
            Terminare il rapporto con {member.full_name}?
          </p>
          {isMultiStructure ? (
            <>
              <p className="text-xs text-amber-700 leading-relaxed">
                <strong>Attenzione: azione irreversibile.</strong>{' '}
                Questo operatore è attivo in <strong>{memberStructureIds.length} strutture</strong>.
                Scegli da quale rimuoverlo.
              </p>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => { setConfirm(false); onTerminate(member, 'current', memberStructureIds) }}
                  className="w-full h-11 rounded-xl bg-amber-600 text-white
                             text-sm font-semibold active:bg-amber-700 transition-colors px-3 text-left"
                >
                  Solo da "{currentStructureName}"
                </button>
                <button
                  type="button"
                  onClick={() => { setConfirm(false); onTerminate(member, 'all', memberStructureIds) }}
                  className="w-full h-11 rounded-xl border border-amber-600 bg-white text-amber-700
                             text-sm font-semibold active:bg-amber-50 transition-colors"
                >
                  Da tutte le strutture ({memberStructureIds.length})
                </button>
                <button
                  type="button"
                  onClick={() => setConfirm(false)}
                  className="w-full h-10 rounded-xl border border-amber-200 bg-white text-amber-700
                             text-sm font-semibold active:bg-amber-50 transition-colors"
                >
                  Annulla
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-amber-700 leading-relaxed">
                <strong>Attenzione: azione irreversibile.</strong>{' '}
                L'operatore verrà rimosso da <strong>questa struttura</strong>.
                Potrai inserire la data di fine e il motivo nel passaggio successivo.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirm(false)}
                  className="flex-1 h-10 rounded-xl border border-amber-200 bg-white text-amber-700
                             text-sm font-semibold active:bg-amber-50 transition-colors"
                >
                  Annulla
                </button>
                <button
                  type="button"
                  onClick={() => { setConfirm(false); onTerminate(member, 'current', memberStructureIds) }}
                  className="flex-1 h-10 rounded-xl bg-amber-600 text-white
                             text-sm font-semibold active:bg-amber-700 transition-colors"
                >
                  Continua
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Componente ──────────────────────────────────────────────────────────────

export default function MemberProfileSheet({ member, profile, structures, structureId, onClose, onMemberUpdate, scrollToAbsences, tags, allStructureTags, onTagsChange, onTerminate }) {
  const { reportError } = useError()
  const [memberDiaryCount,    setMemberDiaryCount]    = useState(null)
  const [memberIncidentCount, setMemberIncidentCount] = useState(null)
  const [showAllAbsences,     setShowAllAbsences]     = useState(false)
  const [memberNotes,      setMemberNotes]      = useState('')
  const [savingNotes,      setSavingNotes]      = useState(false)
  const [notesSaved,       setNotesSaved]       = useState(false)
  const [loadingModal,     setLoadingModal]     = useState(false)

  const [memberContract, setMemberContract] = useState({
    max_hours_per_week: '', weekly_rest_day: '', shift_preference: '', shift_avoid: '', recurring_shifts: [],
  })
  const [savingContract, setSavingContract] = useState(false)
  const [contractSaved,  setContractSaved]  = useState(false)

  const [memberStructureIds, setMemberStructureIds] = useState([])
  const [memberAbsences, setMemberAbsences] = useState([])
  const [showAddAbs,     setShowAddAbs]     = useState(false)
  const [newAbsForm,     setNewAbsForm]     = useState({ start_date: '', end_date: '', reason: '' })
  const [addingAbs,      setAddingAbs]      = useState(false)
  const [absError,       setAbsError]       = useState('')

  // ── Scroll ref per deep-link assenze ─────────────────────────────────────────
  const absencesSectionRef = useRef(null)

  // ── Contratto PDF ─────────────────────────────────────────────────────────────
  const [contractPdfPath,   setContractPdfPath]   = useState(null)
  const [uploadingPdf,      setUploadingPdf]      = useState(false)
  const [pdfError,          setPdfError]          = useState('')

  // Ricarica dati quando cambia il membro aperto
  useEffect(() => {
    if (!member) return
    setMemberDiaryCount(null)
    setMemberIncidentCount(null)
    setShowAllAbsences(false)
    setMemberNotes('')
    setNotesSaved(false)
    setContractSaved(false)
    setShowAddAbs(false)
    setAbsError('')
    setNewAbsForm({ start_date: '', end_date: '', reason: '' })
    setContractPdfPath(null)
    setPdfError('')
    setLoadingModal(true)

    async function load() {
      const [{ count }, { count: incCount }, { data: noteData }, { data: profileData }, { data: absData }, { data: userStructData }] = await Promise.all([
        supabase.from('diaries').select('id', { count: 'exact', head: true }).eq('operator_id', member.id),
        supabase.from('diaries').select('id', { count: 'exact', head: true }).eq('operator_id', member.id).eq('has_incident', true),
        supabase.from('user_notes').select('notes').eq('user_id', member.id).maybeSingle(),
        supabase.from('profiles').select('max_hours_per_week, weekly_rest_day, shift_preference, shift_avoid, recurring_shifts, contract_pdf_url').eq('id', member.id).maybeSingle(),
        supabase.rpc('get_member_absences', { p_user_id: member.id }),
        supabase.rpc('get_user_structure_ids', { p_user_id: member.id }),
      ])

      setMemberDiaryCount(count ?? 0)
      setMemberIncidentCount(incCount ?? 0)
      setMemberNotes(noteData?.notes ?? '')
      setMemberContract({
        max_hours_per_week: profileData?.max_hours_per_week?.toString() ?? '',
        weekly_rest_day:    profileData?.weekly_rest_day    ?? '',
        shift_preference:   profileData?.shift_preference   ?? '',
        shift_avoid:        profileData?.shift_avoid        ?? '',
        recurring_shifts:   profileData?.recurring_shifts   ?? [],
      })
      setContractPdfPath(profileData?.contract_pdf_url ?? null)
      setMemberAbsences(absData ?? [])
      setMemberStructureIds(userStructData ?? [])
      setLoadingModal(false)
      if (scrollToAbsences) {
        requestAnimationFrame(() => {
          absencesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      }
    }

    load()
  }, [member?.id])

  async function saveNotes() {
    if (!member) return
    setSavingNotes(true)
    await supabase
      .from('user_notes')
      .upsert(
        { user_id: member.id, notes: memberNotes, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
    setSavingNotes(false)
    setNotesSaved(true)
    setTimeout(() => setNotesSaved(false), 2500)
  }

  async function saveContract() {
    if (!member) return
    setSavingContract(true)
    const maxHours = memberContract.max_hours_per_week
      ? parseInt(memberContract.max_hours_per_week, 10) : null
    const { error: err } = await supabase.rpc('save_operator_constraints', {
      p_user_id:          member.id,
      p_structure_id:     structureId ?? member.structure_id,
      p_max_hours:        maxHours,
      p_rest_day:         memberContract.weekly_rest_day  || null,
      p_shift_preference: memberContract.shift_preference || null,
      p_shift_avoid:      memberContract.shift_avoid      || null,
      p_recurring_shifts: memberContract.recurring_shifts,
    })
    setSavingContract(false)
    if (err) { reportError(err.message, 'salvataggio contratto operatore'); return }
    onMemberUpdate(member.id, {
      max_hours_per_week: maxHours,
      weekly_rest_day:    memberContract.weekly_rest_day || null,
      shift_preference:   memberContract.shift_preference || null,
      shift_avoid:        memberContract.shift_avoid      || null,
    })
    setContractSaved(true)
    setTimeout(() => setContractSaved(false), 2500)
  }

  async function addMemberAbsence() {
    if (!newAbsForm.start_date || !newAbsForm.end_date) {
      setAbsError('Data inizio e data fine sono obbligatorie.'); return
    }
    setAddingAbs(true); setAbsError('')
    const { data, error: err } = await supabase.rpc('manager_add_absence', {
      p_user_id:    member.id,
      p_start_date: newAbsForm.start_date,
      p_end_date:   newAbsForm.end_date,
      p_reason:     newAbsForm.reason.trim() || null,
    })
    if (err) { setAbsError('Errore nel salvataggio.'); setAddingAbs(false); return }
    const newRecord = Array.isArray(data) ? data[0] : data
    if (newRecord) setMemberAbsences(prev => [newRecord, ...prev])
    setShowAddAbs(false)
    setNewAbsForm({ start_date: '', end_date: '', reason: '' })
    setAddingAbs(false)
  }

  async function updateGroupStatus(records, status) {
    const ids = records.map(r => r.id)
    const { error: err } = await supabase.rpc('update_absence_status', {
      p_ids: ids, p_status: status,
    })
    if (!err) setMemberAbsences(prev => prev.map(a => ids.includes(a.id) ? { ...a, status } : a))
  }

  async function deleteAbsenceGroup(records) {
    const ids = records.map(r => r.id)
    const { error: err } = await supabase.rpc('manager_delete_absences', { p_ids: ids })
    if (!err) setMemberAbsences(prev => prev.filter(a => !ids.includes(a.id)))
  }

  async function handleContractUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type !== 'application/pdf') {
      setPdfError('Solo file PDF sono accettati.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setPdfError('Il file supera il limite di 10 MB.')
      return
    }
    setPdfError('')
    setUploadingPdf(true)

    const path = `${member.id}/contratto.pdf`

    // Rimuovi eventuale file precedente prima di caricare
    await supabase.storage.from('contracts').remove([path])

    const { error: upErr } = await supabase.storage
      .from('contracts')
      .upload(path, file, { upsert: true, contentType: 'application/pdf' })

    if (upErr) {
      setPdfError('Errore durante il caricamento. Riprova.')
      setUploadingPdf(false)
      return
    }

    const { error: dbErr } = await supabase
      .from('profiles')
      .update({ contract_pdf_url: path })
      .eq('id', member.id)

    if (dbErr) {
      setPdfError('File caricato ma errore nel salvataggio. Riprova.')
      setUploadingPdf(false)
      return
    }

    setContractPdfPath(path)
    onMemberUpdate(member.id, { contract_pdf_url: path })
    setUploadingPdf(false)
  }

  async function handleViewContract() {
    if (!contractPdfPath) return
    const { data, error } = await supabase.storage
      .from('contracts')
      .createSignedUrl(contractPdfPath, 120) // 2 minuti
    if (error || !data?.signedUrl) {
      setPdfError('Impossibile aprire il file. Riprova.')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function handleDeleteContract() {
    if (!contractPdfPath) return
    await supabase.storage.from('contracts').remove([contractPdfPath])
    await supabase.from('profiles').update({ contract_pdf_url: null }).eq('id', member.id)
    setContractPdfPath(null)
    onMemberUpdate(member.id, { contract_pdf_url: null })
  }

  if (!member) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Sheet */}
      <div className="relative bg-white rounded-t-3xl max-h-[85vh] overflow-y-auto">

        {/* Handle */}
        <div className="flex justify-center pt-3 pb-0">
          <div className="w-10 h-1 rounded-full bg-[#e2e8f0]" />
        </div>

        {/* Header */}
        <div className="px-6 pt-4 pb-5 flex items-start justify-between border-b border-[#f0f4f8]">
          <div className="flex-1 min-w-0 pr-3">
            <h2 className="text-xl font-bold text-[#1a202c]">{member.full_name}</h2>
            <span className={`inline-block mt-1.5 text-xs font-semibold rounded-full px-2.5 py-0.5
              ${member.role === 'admin_secondary'
                ? 'bg-[#eef2f7] text-[#1e3a5f]'
                : 'bg-green-50 text-green-700'}`}>
              {ROLE_LABELS[member.role] ?? member.role}
            </span>
            {/* Tag manager */}
            <TagManager
              memberId={member.id}
              structureId={member.structure_id}
              tags={tags ?? []}
              allStructureTags={allStructureTags ?? []}
              onTagsChange={onTagsChange ?? (() => {})}
            />
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-[#f8f9fa] flex items-center justify-center text-[#718096]
                       active:bg-[#e2e8f0] transition-colors shrink-0 mt-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-6 pb-14">

          {/* ── Dati anagrafici ── */}
          <div className="flex flex-col gap-3">
            {member.email && (
              <div className="bg-[#f8f9fa] rounded-xl px-4 py-3">
                <p className="text-xs text-[#718096] font-medium mb-0.5">Email</p>
                <p className="text-sm text-[#1a202c] font-medium break-all">{member.email}</p>
              </div>
            )}
            {member.created_at && (
              <div className="bg-[#f8f9fa] rounded-xl px-4 py-3">
                <p className="text-xs text-[#718096] font-medium mb-0.5">Registrato il</p>
                <p className="text-sm text-[#1a202c] font-semibold">
                  {new Date(member.created_at).toLocaleDateString('it-IT', {
                    day: '2-digit', month: 'short', year: 'numeric',
                  })}
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#eef2f7] rounded-xl px-4 py-3">
                <p className="text-xs text-[#718096] font-medium mb-0.5">Report inviati</p>
                <p className="text-2xl font-bold text-[#1e3a5f] leading-none mt-1">
                  {loadingModal ? '…' : (memberDiaryCount ?? 0)}
                </p>
              </div>
              <div className="bg-red-50 rounded-xl px-4 py-3">
                <p className="text-xs text-[#718096] font-medium mb-0.5">Episodi critici</p>
                <p className="text-2xl font-bold text-red-500 leading-none mt-1">
                  {loadingModal ? '…' : (memberIncidentCount ?? 0)}
                </p>
              </div>
            </div>
          </div>

          {/* ── Contatti ── */}
          {(member.email || member.phone) && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <p className="text-xs font-bold text-[#1e3a5f] uppercase tracking-wide">
                  Contatti
                </p>
                <span className="flex-1 h-px bg-[#e2e8f0]" />
              </div>
              <div className="flex flex-col gap-2">
                {member.email && (
                  <a
                    href={`mailto:${member.email}`}
                    className="flex items-center gap-3 bg-[#f8f9fa] rounded-xl px-4 py-3
                               active:bg-[#eef2f7] transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-[#eef2f7] flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4 text-[#1e3a5f]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] text-[#718096] font-medium uppercase tracking-wide">Email</p>
                      <p className="text-sm text-[#1a202c] font-medium truncate">{member.email}</p>
                    </div>
                    <svg className="w-4 h-4 text-[#a0aec0] shrink-0 ml-auto" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </a>
                )}
                {member.phone && (
                  <a
                    href={`tel:${member.phone.replace(/\s/g, '')}`}
                    className="flex items-center gap-3 bg-[#f8f9fa] rounded-xl px-4 py-3
                               active:bg-[#eef2f7] transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-[#eef2f7] flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4 text-[#1e3a5f]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M2.25 6.338c0-1.01.684-1.87 1.67-2.084l2.083-.416a1.5 1.5 0 011.62.806l1.03 2.06a1.5 1.5 0 01-.43 1.883l-.663.497a11.257 11.257 0 005.576 5.576l.497-.663a1.5 1.5 0 011.883-.43l2.06 1.03a1.5 1.5 0 01.806 1.62l-.416 2.083A2.25 2.25 0 0117.662 21.75C9.12 21.75 2.25 14.88 2.25 6.338z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] text-[#718096] font-medium uppercase tracking-wide">Telefono</p>
                      <p className="text-sm text-[#1a202c] font-medium">{member.phone}</p>
                    </div>
                    <svg className="w-4 h-4 text-[#a0aec0] shrink-0 ml-auto" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </a>
                )}
              </div>
            </div>
          )}

          {/* ── Strutture assegnate (solo manager) ── */}
          {profile?.role === 'manager' && (
            <StructureEditor
              member={member}
              structures={structures}
              memberStructureIds={
                memberStructureIds.length > 0
                  ? memberStructureIds
                  : (member.structure_id ? [member.structure_id] : [])
              }
              onSaved={newIds => {
                setMemberStructureIds(newIds)
                onMemberUpdate(member.id, { structure_id: newIds[0] ?? null })
              }}
            />
          )}

          {/* ── Contratto (solo manager) ── */}
          {profile?.role === 'manager' && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <p className="text-xs font-bold text-[#1e3a5f] uppercase tracking-wide">
                  Contratto
                </p>
                <span className="flex-1 h-px bg-[#e2e8f0]" />
              </div>

              {loadingModal ? (
                <div className="flex flex-col gap-2">
                  {[1, 2].map(i => <div key={i} className="h-10 rounded-xl bg-[#f0f4f8] animate-pulse" />)}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">
                      Ore / settimana
                    </label>
                    <input
                      type="number" min="0" max="60" step="1"
                      value={memberContract.max_hours_per_week}
                      onChange={e => setMemberContract(p => ({ ...p, max_hours_per_week: e.target.value }))}
                      placeholder="Es. 38"
                      className="w-full h-11 px-3 rounded-xl border border-[#e2e8f0] bg-white
                                 text-sm text-[#1a202c] outline-none focus:border-[#1e3a5f]
                                 focus:ring-2 focus:ring-[#1e3a5f]/20 transition-colors"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={saveContract}
                    disabled={savingContract}
                    className={`w-full h-11 rounded-xl font-semibold text-sm transition-colors
                      ${contractSaved
                        ? 'bg-green-500 text-white'
                        : 'bg-[#1e3a5f] text-white active:bg-[#152b47] disabled:opacity-60'}`}
                  >
                    {savingContract ? 'Salvataggio…' : contractSaved ? '✓ Contratto aggiornato' : 'Aggiorna Contratto'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Documenti Riservati (solo manager) ── */}
          {profile?.role === 'manager' && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <p className="text-xs font-bold text-[#1e3a5f] uppercase tracking-wide">
                  Documenti Riservati
                </p>
                <span className="flex-1 h-px bg-[#e2e8f0]" />
              </div>

              {loadingModal ? (
                <div className="h-14 rounded-xl bg-[#f0f4f8] animate-pulse" />
              ) : contractPdfPath ? (
                /* ── Contratto presente ── */
                <div className="bg-green-50 border border-green-200 rounded-2xl px-4 py-3.5 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 text-green-700" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#1a202c]">Contratto di lavoro</p>
                    <p className="text-xs text-green-700 font-medium">PDF caricato</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={handleViewContract}
                      className="h-8 px-3 rounded-xl bg-[#1e3a5f] text-white text-xs font-semibold
                                 active:bg-[#152b47] transition-colors"
                    >
                      Apri
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteContract}
                      className="w-8 h-8 flex items-center justify-center rounded-xl
                                 bg-red-50 text-red-400 active:bg-red-100 transition-colors"
                      title="Elimina contratto"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ) : (
                /* ── Nessun contratto ── */
                <label className={`flex items-center gap-3 w-full rounded-2xl border-2 border-dashed
                  border-[#cbd5e0] bg-[#f8f9fa] px-4 py-4 cursor-pointer
                  active:bg-[#f0f4f8] transition-colors
                  ${uploadingPdf ? 'opacity-60 pointer-events-none' : ''}`}>
                  <input
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={handleContractUpload}
                    disabled={uploadingPdf}
                  />
                  <div className="w-10 h-10 rounded-xl bg-[#eef2f7] flex items-center justify-center shrink-0">
                    {uploadingPdf ? (
                      <svg className="w-5 h-5 text-[#1e3a5f] animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5 text-[#1e3a5f]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#1a202c]">
                      {uploadingPdf ? 'Caricamento…' : 'Carica contratto PDF'}
                    </p>
                    <p className="text-xs text-[#718096] mt-0.5">Solo PDF · max 10 MB</p>
                  </div>
                </label>
              )}

              {pdfError && (
                <p className="text-xs text-red-600 mt-2">{pdfError}</p>
              )}
            </div>
          )}

          {/* ── Storico Assenze (solo manager) ── */}
          {profile?.role === 'manager' && (
            <div ref={absencesSectionRef}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-bold text-[#1e3a5f] uppercase tracking-wide">
                    Storico Assenze
                  </p>
                  {memberAbsences.filter(a => a.status === 'pending').length > 0 && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-400 text-white leading-none">
                      {memberAbsences.filter(a => a.status === 'pending').length} in attesa
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { setShowAddAbs(v => !v); setAbsError('') }}
                  className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-[#1e3a5f] text-white
                             active:bg-[#152b47] transition-colors"
                >
                  {showAddAbs ? '× Annulla' : '+ Aggiungi'}
                </button>
              </div>

              {/* Form nuova assenza */}
              {showAddAbs && (
                <div className="bg-[#f0f4f8] rounded-2xl p-4 flex flex-col gap-3 mb-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[#718096]">
                    Nuova assenza — approvata direttamente
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] font-semibold text-[#718096] block mb-1">Data inizio</label>
                      <input type="date" value={newAbsForm.start_date}
                        onChange={e => setNewAbsForm(p => ({ ...p, start_date: e.target.value }))}
                        className="w-full h-10 px-3 rounded-xl border border-[#e2e8f0] bg-white
                                   text-sm outline-none focus:border-[#1e3a5f] transition-colors" />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-[#718096] block mb-1">Data fine</label>
                      <input type="date" value={newAbsForm.end_date}
                        onChange={e => setNewAbsForm(p => ({ ...p, end_date: e.target.value }))}
                        className="w-full h-10 px-3 rounded-xl border border-[#e2e8f0] bg-white
                                   text-sm outline-none focus:border-[#1e3a5f] transition-colors" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-[#718096] block mb-1">
                      Motivo <span className="font-normal text-[#a0aec0]">(opz.)</span>
                    </label>
                    <input type="text" value={newAbsForm.reason}
                      onChange={e => setNewAbsForm(p => ({ ...p, reason: e.target.value }))}
                      placeholder="Ferie, permesso, malattia…"
                      className="w-full h-10 px-3 rounded-xl border border-[#e2e8f0] bg-white
                                 text-sm outline-none focus:border-[#1e3a5f] transition-colors
                                 placeholder:text-[#a0aec0]" />
                  </div>
                  {absError && <p className="text-xs text-red-500 -mt-1">{absError}</p>}
                  <button type="button" disabled={addingAbs} onClick={addMemberAbsence}
                    className="w-full h-10 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                               active:bg-[#152b47] disabled:opacity-60 transition-colors">
                    {addingAbs ? 'Salvataggio…' : 'Salva assenza'}
                  </button>
                </div>
              )}

              {/* Lista assenze (raggruppate per request_group_id) */}
              {loadingModal ? (
                <div className="h-16 rounded-2xl bg-[#f0f4f8] animate-pulse" />
              ) : memberAbsences.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-sm text-[#a0aec0]">Nessuna assenza registrata.</p>
                </div>
              ) : (() => {
                const allGroups = groupAbsences(memberAbsences)
                const visibleGroups = showAllAbsences ? allGroups : allGroups.slice(0, 3)
                return (
                <div className="flex flex-col gap-2">
                  {visibleGroups.map(records => {
                    const sorted    = [...records].sort((a, b) => a.start_date.localeCompare(b.start_date))
                    const status    = groupStatus(records)
                    const cfg       = ABSENCE_STATUS_CFG[status] ?? ABSENCE_STATUS_CFG.pending
                    const isPending = status === 'pending'
                    const isFullDay = records[0].is_full_day !== false
                    const groupKey  = records[0].request_group_id ?? records[0].id
                    return (
                      <div key={groupKey}
                        className={`rounded-xl border px-3 py-2.5 flex items-start gap-2.5
                          ${isPending ? 'bg-amber-50 border-amber-200' : 'bg-white border-[#e2e8f0]'}`}>
                        <div className="min-w-0 flex-1">
                          {/* Status + slot badge */}
                          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                            <span className="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                              style={{ backgroundColor: cfg.bg, color: cfg.text }}>
                              {cfg.label}
                            </span>
                            {isFullDay ? (
                              <span className="text-[9px] font-semibold text-[#718096] bg-[#f0f4f8] px-1.5 py-0.5 rounded-full">
                                Giorno intero
                              </span>
                            ) : (
                              <span className="text-[9px] font-semibold text-[#718096] bg-[#f0f4f8] px-1.5 py-0.5 rounded-full">
                                {records.length === 1
                                  ? (SLOT_LABELS[records[0].slot_type] ?? records[0].slot_type)
                                  : `${records.length} slot`}
                              </span>
                            )}
                          </div>

                          {/* Date summary */}
                          {isFullDay ? (
                            <p className="text-xs font-semibold text-[#1a202c]">
                              {fmtAbsDate(sorted[0].start_date)}
                              {sorted[0].start_date !== sorted[0].end_date && (
                                <span className="text-[#718096]"> → {fmtAbsDate(sorted[0].end_date)}</span>
                              )}
                            </p>
                          ) : (
                            <div className="flex flex-col gap-0.5">
                              {sorted.map(r => (
                                <p key={r.id} className="text-[11px] text-[#1a202c]">
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
                            <p className="text-[11px] text-[#718096] mt-0.5 truncate">{records[0].reason}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0 mt-0.5">
                          {status !== 'approved' && (
                            <button type="button" onClick={() => updateGroupStatus(records, 'approved')}
                              className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1.5 rounded-lg transition-colors
                                ${isPending
                                  ? 'bg-green-500 text-white active:bg-green-600'
                                  : 'bg-green-50 text-green-600 active:bg-green-100'}`}>
                              ✓{isPending && <span className="ml-0.5">Approva</span>}
                            </button>
                          )}
                          {status !== 'rejected' && (
                            <button type="button" onClick={() => updateGroupStatus(records, 'rejected')}
                              className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1.5 rounded-lg transition-colors
                                ${isPending
                                  ? 'bg-red-500 text-white active:bg-red-600'
                                  : 'bg-amber-50 text-amber-600 active:bg-amber-100'}`}>
                              ✕{isPending && <span className="ml-0.5">Rifiuta</span>}
                            </button>
                          )}
                          <button type="button" onClick={() => deleteAbsenceGroup(records)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg
                                       bg-[#f0f4f8] text-[#a0aec0] active:bg-[#e2e8f0] transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round"
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    )
                  })}
                  {allGroups.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setShowAllAbsences(v => !v)}
                      className="w-full py-2 text-xs font-semibold text-[#1e3a5f]
                                 bg-[#eef2f7] rounded-xl active:bg-[#dde6f0] transition-colors"
                    >
                      {showAllAbsences
                        ? '↑ Mostra meno'
                        : `Vedi tutte (${allGroups.length})`}
                    </button>
                  )}
                </div>
                )
              })()}
            </div>
          )}

          {/* ── Note private ── */}
          {(profile?.role === 'manager' || profile?.role === 'admin_secondary') && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <p className="text-xs font-bold text-[#718096] uppercase tracking-wide">
                  Note interne
                </p>
                <span className="flex-1 h-px bg-[#e2e8f0]" />
              </div>
              <textarea
                value={memberNotes}
                onChange={e => setMemberNotes(e.target.value)}
                placeholder="Aggiungi note riservate su questo operatore…"
                rows={3}
                className="w-full rounded-xl border border-[#e2e8f0] px-4 py-3 text-sm text-[#1a202c]
                           bg-white outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                           transition-colors resize-none placeholder:text-[#a0aec0]"
              />
              <p className="text-xs text-[#a0aec0] mt-1.5 mb-3">
                Visibili solo al Management. L'operatore non può accedervi.
              </p>
              <button
                onClick={saveNotes}
                disabled={savingNotes}
                className={`w-full h-11 rounded-xl font-semibold text-sm transition-colors
                  ${notesSaved
                    ? 'bg-green-500 text-white'
                    : 'bg-[#1e3a5f] text-white active:bg-[#152b47] disabled:opacity-60'}`}
              >
                {savingNotes ? 'Salvataggio…' : notesSaved ? '✓ Note salvate' : 'Salva note'}
              </button>
            </div>
          )}

          {/* ── Fine rapporto — solo manager ── */}
          {onTerminate && (
            <TerminateSection
              member={member}
              structures={structures}
              memberStructureIds={memberStructureIds.length > 0 ? memberStructureIds : (member.structure_id ? [member.structure_id] : [])}
              onTerminate={onTerminate}
            />
          )}
        </div>
      </div>
    </div>
  )
}
