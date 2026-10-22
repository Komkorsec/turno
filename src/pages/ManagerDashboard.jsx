import { useState, useEffect, useMemo, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useError } from '../contexts/ErrorContext'
import { supabase } from '../lib/supabase'
import logo from '../assets/logobianco2.svg'
import { exportDiariesPdf } from '../utils/exportPdf'
import { playAudio } from '../utils/audio'
import TagManager, { TAG_COLORS, getTagColor, TagPills } from '../components/manager/TagManager'
import ShiftSchedule from '../components/ShiftSchedule'
import ResidentList from '../components/ResidentList'
import NotificationsPanel, { BellButton, fetchNotifications, subscribeNotifications } from '../components/NotificationsPanel'
import DiaryRow, { formatTime, formatDateTime, MOOD_LABEL } from '../components/manager/DiaryRow'
import FilterPanel, { EMPTY_FILTERS, todayFilters } from '../components/manager/FilterPanel'
import DiaryForm from '../components/DiaryForm'
import MedPanel from '../components/MedPanel'
import MemberProfileSheet from '../components/manager/MemberProfileSheet'
import StructureInfoPage from '../components/manager/StructureInfoPage'
import SettingsPage from '../components/manager/SettingsPage'
import AbsencesManagerPanel from '../components/manager/AbsencesManagerPanel'
import TasksPanel, { fetchOpenTasksCount } from '../components/TasksPanel'
import OrgDashboard from '../components/manager/OrgDashboard'
import ArchivioGenerale from '../components/ArchivioGenerale'

// ─── Costanti ────────────────────────────────────────────────────────────────

const ADMIN_EMAIL  = 'umberto.vignati05@gmail.com'

// Viste in cui lo swipe-right attiva il "back" gerarchico
const SWIPE_BACK_VIEWS = new Set(['structure-menu', 'diaries', 'schedule', 'team', 'team-archive', 'residents', 'structure-info', 'settings', 'absences', 'codes', 'tasks', 'org-dashboard', 'archivio-generale'])
const ROLE_LABELS  = { operator: 'Operatore', admin_secondary: 'Coordinatore', manager: 'Responsabile' }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isWithin8h(iso) {
  if (!iso) return false
  return Date.now() - new Date(iso).getTime() < 8 * 60 * 60 * 1000
}

function exportCSV(diaries, structureName) {
  const headers = [
    'Data', 'Ora compilazione', 'Operatore',
    'Turno inizio', 'Turno fine',
    'Umore (1-5)', 'Descrizione umore',
    'Episodio critico', 'Tipo episodio', 'Descrizione episodio',
    'Passaggio di consegne', 'Note responsabile',
  ]

  const rows = diaries.map(d => {
    const dt = new Date(d.created_at)
    return [
      dt.toLocaleDateString('it-IT'),
      dt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
      d.profiles?.full_name ?? '',
      formatTime(d.shift_start) ?? '',
      formatTime(d.shift_end)   ?? '',
      d.mood,
      MOOD_LABEL[d.mood] ?? '',
      d.has_incident ? 'Sì' : 'No',
      d.has_incident ? (d.incident_type ?? '') : '',
      d.incident_notes  ?? '',
      d.handover_notes  ?? '',
      d.manager_notes   ?? '',
    ]
  })

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n')

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `turno-${structureName}-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Icone inline ────────────────────────────────────────────────────────────

function IconFilter() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M7 10h10M11 16h2" />
    </svg>
  )
}

function IconDownload() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4" />
    </svg>
  )
}

// ─── StructureCard ───────────────────────────────────────────────────────────

function StructureCard({ structure, lastAt, onClick }) {
  const ok     = isWithin8h(lastAt)
  const hasAny = !!lastAt

  return (
    <button
      onClick={onClick}
      className="w-full bg-white rounded-2xl border border-[#e2e8f0] p-5 flex items-center justify-between
                 active:bg-[#f8f9fa] transition-colors text-left shadow-sm"
    >
      <div>
        <p className="font-semibold text-[#1a202c] text-base">{structure.name}</p>
        <p className="text-xs text-[#718096] mt-0.5">
          {hasAny ? `Ultimo turno: ${formatDateTime(lastAt)}` : 'Nessun diario registrato'}
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-4">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: ok ? '#22c55e' : '#f59e0b' }} />
          <span className="text-xs font-medium" style={{ color: ok ? '#16a34a' : '#d97706' }}>
            {ok ? 'Recente' : 'Attesa'}
          </span>
        </div>
        <svg className="w-4 h-4 text-[#a0aec0]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  )
}

// ─── CopyButton ──────────────────────────────────────────────────────────────

function CopyButton({ text, small }) {
  const [copied, setCopied] = useState(false)
  async function handleCopy() {
    await navigator.clipboard.writeText(text)
    playAudio('action')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`shrink-0 rounded-xl border font-semibold transition-colors active:scale-95
        ${small ? 'text-xs px-2.5 py-1' : 'text-sm px-3 py-2'}
        ${copied
          ? 'bg-green-50 border-green-300 text-green-700'
          : 'bg-white border-[#e2e8f0] text-[#1a202c]'}`}
    >
      {copied ? '✓ Copiato' : 'Copia'}
    </button>
  )
}

function makeCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

function ShareButtons({ code, structureName }) {
  const appName = 'Turno'
  const msg = `Ciao! Questo è il tuo codice invito per ${appName}: ${code}. Inseriscilo durante la registrazione per unirti alla struttura ${structureName}.`

  function openWhatsApp() {
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank', 'noopener')
  }

  function openMail() {
    window.location.href = `mailto:?subject=${encodeURIComponent(`Invito ${appName}`)}&body=${encodeURIComponent(msg)}`
  }

  async function openNativeShare() {
    try {
      await navigator.share({ title: `Invito ${appName}`, text: msg })
    } catch {
      // dismissed or not supported — silently ignore
    }
  }

  const canNativeShare = typeof navigator !== 'undefined' && !!navigator.share

  return (
    <div className="flex items-center gap-2 shrink-0">
      {/* WhatsApp */}
      <button
        type="button"
        onClick={openWhatsApp}
        title="Condividi su WhatsApp"
        className="w-8 h-8 flex items-center justify-center rounded-xl
                   bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
      >
        {/* WhatsApp icon */}
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
      </button>

      {/* Email */}
      <button
        type="button"
        onClick={openMail}
        title="Invia via Email"
        className="w-8 h-8 flex items-center justify-center rounded-xl
                   bg-[#eef2f7] text-[#4a6fa5] hover:bg-[#dde6f0] transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      </button>

      {/* Condivisione nativa (solo se supportata) */}
      {canNativeShare && (
        <button
          type="button"
          onClick={openNativeShare}
          title="Condividi"
          className="w-8 h-8 flex items-center justify-center rounded-xl
                     bg-[#f0f4f8] text-[#718096] hover:bg-[#e2e8f0] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
        </button>
      )}
    </div>
  )
}

// ─── Pagina principale ───────────────────────────────────────────────────────

export default function ManagerDashboard({ onGoToAdmin }) {
  const { profile, session, signOut, userStructures, setActiveStructure } = useAuth()
  const { reportError } = useError()
  const isManager = profile?.role === 'manager'

  const [view, setView]                   = useState('structures')
  const [slideClass,  setSlideClass]      = useState('')
  const [structures, setStructures]       = useState([])
  const [lastDiaryMap, setLastDiaryMap]   = useState({})
  const [loadingStructures, setLoadingStructures] = useState(true)
  const [openTasksMap, setOpenTasksMap]   = useState({}) // structureId → count
  const [showSwitcher,    setShowSwitcher]  = useState(false)  // dropdown cambio struttura

  // ── Notifiche ────────────────────────────────────────────────────────────────
  const [notifications,  setNotifications]  = useState([])
  const [showNotifPanel, setShowNotifPanel] = useState(false)

  // ── Diari ───────────────────────────────────────────────────────────────────
  const [selectedStructure, setSelectedStructure] = useState(null)
  const [diaries,           setDiaries]           = useState([])
  const [loadingDiaries,    setLoadingDiaries]    = useState(false)
  const [expandedId,        setExpandedId]        = useState(null)
  const [showFilters,       setShowFilters]       = useState(false)
  const [filters,           setFilters]           = useState(EMPTY_FILTERS)
  const [viewsMap,          setViewsMap]          = useState({})
  const [diarySubView,      setDiarySubView]      = useState('oggi')

  // ── Aggiungi struttura ───────────────────────────────────────────────────────
  const [orgInfo,            setOrgInfo]           = useState(null)
  const [showAddStructure,   setShowAddStructure]  = useState(false)
  const [addForm,            setAddForm]           = useState({ name: '', address: '', type: '', capacity: '' })
  const [addingStructure,    setAddingStructure]   = useState(false)
  const [addStructureError,  setAddStructureError] = useState('')

  // ── Team ─────────────────────────────────────────────────────────────────────
  const [teamCodes,           setTeamCodes]          = useState([])
  const [loadingTeam,         setLoadingTeam]        = useState(false)
  const [selectedRole,        setSelectedRole]       = useState('operator')
  const [isSecretaryCode,     setIsSecretaryCode]    = useState(false)
  const [selectedStructureIds,setSelectedStructureIds] = useState([]) // strutture per operatore e coordinatore
  const [generatedCode,       setGeneratedCode]      = useState(null)
  const [generating,          setGenerating]         = useState(false)
  const [teamError,           setTeamError]          = useState(null)
  const [teamMembers,        setTeamMembers]       = useState([])
  const [loadingMembers,     setLoadingMembers]    = useState(false)
  const [tagsByMember,       setTagsByMember]      = useState({})   // { [profileId]: Tag[] }
  const [allStructureTags,   setAllStructureTags]  = useState([])   // per archivio suggerimenti
  const [tagFilter,          setTagFilter]         = useState(null)  // label stringa o null

  // ── Member profile ───────────────────────────────────────────────────────────
  const [selectedMember, setSelectedMember] = useState(null)

  // ── Fine rapporto di lavoro ───────────────────────────────────────────────────
  const [terminateTarget,       setTerminateTarget]       = useState(null)   // membro da terminare
  const [terminateEndedAt,      setTerminateEndedAt]      = useState('')
  const [terminateReason,       setTerminateReason]       = useState('')
  const [terminating,           setTerminating]           = useState(false)
  const [terminateError,        setTerminateError]        = useState('')
  const [terminateScope,        setTerminateScope]        = useState('current') // 'current' | 'all'
  const [terminateStructureIds, setTerminateStructureIds] = useState([])
  // ── Archivio personale ────────────────────────────────────────────────────────
  const [archivedMembers,       setArchivedMembers]       = useState([])
  const [loadingArchive,        setLoadingArchive]        = useState(false)
  const [expandedReason,        setExpandedReason]        = useState(null)
  const [confirmDeleteArchived, setConfirmDeleteArchived] = useState(null) // member object
  const [deletingArchived,      setDeletingArchived]      = useState(false)

  // ── Delete diary ─────────────────────────────────────────────────────────────
  const [confirmDeleteDiary, setConfirmDeleteDiary] = useState(null)
  const [deletingDiary,      setDeletingDiary]      = useState(false)
  const [deleteDiaryError,   setDeleteDiaryError]   = useState('')

  // ── Richieste ferie in attesa ─────────────────────────────────────────────────
  const [pendingAbsencesCount, setPendingAbsencesCount] = useState(0)

  // ── Deep-link da notifiche ────────────────────────────────────────────────────
  const [deepLinkDiaryId,          setDeepLinkDiaryId]          = useState(null)
  const [deepLinkMemberId,         setDeepLinkMemberId]         = useState(null)
  const [deepLinkMemberToAbsences, setDeepLinkMemberToAbsences] = useState(false)
  const [deepLinkResidentId,       setDeepLinkResidentId]       = useState(null)

  // ── Carica strutture + info organizzazione ───────────────────────────────────
  useEffect(() => {
    async function loadStructures() {
      setLoadingStructures(true)

      const { data: structs, error } = await supabase
        .from('structures')
        .select('id, name, address, type, capacity, logo_url')
        .order('id')

      if (error || !structs) { setLoadingStructures(false); return }
      setStructures(structs)

      if (profile?.organization_id) {
        const { data: org } = await supabase
          .from('organizations')
          .select('name, max_structures')
          .eq('id', profile.organization_id)
          .maybeSingle()
        setOrgInfo(org ?? null)
      }

      const { data: recent } = await supabase
        .from('diaries')
        .select('structure_id, created_at')
        .in('structure_id', structs.map(s => s.id))
        .order('created_at', { ascending: false })

      const map = {}
      for (const d of recent ?? []) {
        if (!map[d.structure_id]) map[d.structure_id] = d.created_at
      }
      setLastDiaryMap(map)

      // Conta richieste ferie pending per badge
      const { data: absData } = await supabase.rpc('get_org_absences')
      const pendingCount = (absData ?? []).filter(a => a.status === 'pending').length
      setPendingAbsencesCount(pendingCount)

      setLoadingStructures(false)
    }
    loadStructures()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Notifiche: caricamento iniziale + real-time ───────────────────────────
  useEffect(() => {
    if (!profile?.id) return
    fetchNotifications(profile.id).then(setNotifications)
    void supabase.rpc('check_expiring_document_notifications')
    const channel = subscribeNotifications(profile.id, n =>
      setNotifications(prev => [n, ...prev])
    )
    return () => { supabase.removeChannel(channel) }
  }, [profile?.id])

  // Riaggiorna badge ferie quando l'utente torna alla home dopo aver gestito le richieste
  useEffect(() => {
    if (view === 'structures') {
      supabase.rpc('get_org_absences').then(({ data }) => {
        setPendingAbsencesCount((data ?? []).filter(a => a.status === 'pending').length)
      })
    }
  }, [view])

  async function openNotifPanel() {
    setShowNotifPanel(v => !v)
    await supabase.rpc('purge_old_notifications')
    fetchNotifications(profile.id).then(setNotifications)
  }

  async function handleMarkAllRead() {
    await supabase.rpc('mark_all_notifications_read')
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
  }

  async function handleClearAll() {
    await supabase.rpc('delete_all_notifications')
    setNotifications([])
  }

  async function handleNotifNavigate(notif) {
    setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n))
    setShowNotifPanel(false)
    await supabase.rpc('mark_notification_read', { notif_id: notif.id })

    if (!notif.link) return
    const parts = notif.link.split(':')
    const targetView      = parts[0]
    const structureId     = parts[1] ? Number(parts[1]) : null
    const resourceId      = parts[2] ?? null
    const targetStructure = structureId ? structures.find(s => s.id === structureId) : null

    if (targetView === 'diaries' && targetStructure) {
      clearSectionState()
      setSelectedStructure(targetStructure)
      if (resourceId) setDeepLinkDiaryId(resourceId)
      openDiaries(targetStructure, !!resourceId)
    } else if (targetView === 'team' && targetStructure) {
      clearSectionState()
      setSelectedStructure(targetStructure)
      if (resourceId) {
        setDeepLinkMemberId(resourceId)
        setDeepLinkMemberToAbsences(notif.type === 'absence')
      }
      openTeam(targetStructure)
    } else if (targetView === 'schedule' && targetStructure) {
      clearSectionState()
      setSelectedStructure(targetStructure)
      setView('schedule')
    } else if (targetView === 'residents' && targetStructure) {
      clearSectionState()
      setSelectedStructure(targetStructure)
      if (resourceId) setDeepLinkResidentId(resourceId)
      setView('residents')
    }
  }

  function clearSectionState() {
    // Diaries
    setDiaries([])
    setViewsMap({})
    setExpandedId(null)
    setShowFilters(false)
    setFilters(EMPTY_FILTERS)
    setConfirmDeleteDiary(null)
    setDeleteDiaryError('')
    // Team
    setTeamMembers([])
    setTeamCodes([])
    setGeneratedCode(null)
    setTeamError(null)
    setSelectedMember(null)
    setTerminateTarget(null)
    setTerminateReason('')
    setTerminateError('')
    setTerminateScope('current')
    setTerminateStructureIds([])
  }

  // ── Deep-link: espandi diario specifico e scrolla a esso ─────────────────────
  useEffect(() => {
    if (!deepLinkDiaryId || diaries.length === 0) return
    setExpandedId(deepLinkDiaryId)
    const id = deepLinkDiaryId
    setDeepLinkDiaryId(null)
    // Scrolla al diario dopo che React ha aggiornato il DOM
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById('diary-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    })
  }, [diaries, deepLinkDiaryId])

  // ── Deep-link: apri profilo membro specifico dopo il caricamento ─────────────
  useEffect(() => {
    if (!deepLinkMemberId || teamMembers.length === 0) return
    const member = teamMembers.find(m => m.id === deepLinkMemberId)
    if (member) {
      setSelectedMember(member)
      setDeepLinkMemberId(null)
    }
  }, [teamMembers, deepLinkMemberId])

  function openStructure(structure) {
    clearSectionState()
    setSelectedStructure(structure)
    setView('structure-menu')
    // Aggiorna il badge task per questa struttura
    fetchOpenTasksCount(structure.id, profile?.id, true)
      .then(count => setOpenTasksMap(prev => ({ ...prev, [structure.id]: count })))
  }

  const normalizeDiary = d => ({ ...d, profiles: { full_name: d.operator_name } })

  async function reloadDiaries() {
    if (!selectedStructure) return
    setLoadingDiaries(true)
    const { data } = await supabase.rpc('get_structure_diaries', {
      p_structure_id: selectedStructure.id,
    })
    setDiaries((data ?? []).map(normalizeDiary))
    setLoadingDiaries(false)
  }

  async function openDiaries(structure, skipTodayFilter = false) {
    const s = structure ?? selectedStructure
    setView('diaries')
    setDiarySubView('oggi')
    setExpandedId(null)
    setFilters(skipTodayFilter ? EMPTY_FILTERS : todayFilters())
    setShowFilters(false)
    setLoadingDiaries(true)

    const { data, error } = await supabase.rpc('get_structure_diaries', {
      p_structure_id: s.id,
    })

    if (error) console.error('Errore diari:', error.message)
    const diaryList = (data ?? []).map(normalizeDiary)
    setDiaries(diaryList)
    setLoadingDiaries(false)

    const diaryIds = diaryList.map(d => d.id)
    if (diaryIds.length > 0) {
      const { data: viewRows } = await supabase
        .from('report_views')
        .select('report_id, user_id, viewed_at')
        .in('report_id', diaryIds)

      if (viewRows && viewRows.length > 0) {
        const viewerIds = [...new Set(viewRows.map(v => v.user_id))]
        const { data: viewerProfiles } = await supabase
          .rpc('get_profiles_by_ids', { p_ids: viewerIds })
        const profileMap = Object.fromEntries((viewerProfiles ?? []).map(p => [p.id, p.full_name]))
        const map = {}
        for (const v of viewRows) {
          if (!map[v.report_id]) map[v.report_id] = []
          map[v.report_id].push({ full_name: profileMap[v.user_id] ?? '?', viewed_at: v.viewed_at, user_id: v.user_id })
        }
        setViewsMap(map)
      } else {
        setViewsMap({})
      }
    }
  }

  async function handleViewDiary(diaryId) {
    if (profile?.role !== 'manager' && profile?.role !== 'admin_secondary') return
    const { error } = await supabase
      .from('report_views')
      .upsert(
        { report_id: diaryId, user_id: profile.id, viewed_at: new Date().toISOString() },
        { onConflict: 'report_id,user_id', ignoreDuplicates: true }
      )
    if (!error) {
      setViewsMap(prev => {
        const existing = prev[diaryId] ?? []
        if (existing.some(v => v.user_id === profile.id)) return prev
        return {
          ...prev,
          [diaryId]: [...existing, {
            full_name: profile.full_name,
            viewed_at: new Date().toISOString(),
            user_id:   profile.id,
          }],
        }
      })
    }
  }

  async function handleAddStructure(e) {
    e.preventDefault()
    if (!addForm.name.trim())    { setAddStructureError('Il nome è obbligatorio.'); return }
    if (!addForm.address.trim()) { setAddStructureError("L'indirizzo è obbligatorio."); return }
    if (!addForm.type)           { setAddStructureError('Seleziona la tipologia.'); return }

    setAddingStructure(true)
    setAddStructureError('')

    const { error } = await supabase.rpc('create_structure', {
      p_name:     addForm.name.trim(),
      p_address:  addForm.address.trim(),
      p_type:     addForm.type,
      p_capacity: addForm.capacity ? Number(addForm.capacity) : null,
    })

    if (error) {
      setAddStructureError(
        error.message.includes('Limite')
          ? 'Hai raggiunto il limite di strutture per il tuo piano.'
          : 'Errore durante la creazione. Riprova.'
      )
      setAddingStructure(false)
      return
    }

    const { data: structs } = await supabase
      .from('structures').select('id, name, address, type, capacity, logo_url, email, phone, notes_private').order('id')
    setStructures(structs ?? [])
    setAddForm({ name: '', address: '', type: '', capacity: '' })
    setShowAddStructure(false)
    setAddingStructure(false)
  }

  // ── Computed (diari) ─────────────────────────────────────────────────────────

  // Profilo "effettivo" per DiaryForm/MedPanel: usa la struttura selezionata
  // (importante per coordinatori multi-struttura e manager)
  const effectiveProfile = useMemo(
    () => selectedStructure ? { ...profile, structure_id: selectedStructure.id } : profile,
    [profile, selectedStructure]
  )

  const todayISO = new Date().toISOString().slice(0, 10)
  const todayDiaries = useMemo(
    () => diaries.filter(d => d.created_at?.startsWith(todayISO)),
    [diaries, todayISO]
  )

  const operators = useMemo(() => {
    const seen = new Set()
    return diaries
      .filter(d => { if (seen.has(d.operator_id)) return false; seen.add(d.operator_id); return true })
      .map(d => ({ id: d.operator_id, name: d.profiles?.full_name ?? 'Operatore' }))
  }, [diaries])

  // ── Tag: valori derivati ──────────────────────────────────────────────────────
  const uniqueFilterTags = useMemo(() => {
    const seen = new Set()
    return allStructureTags.filter(t => { if (seen.has(t.label)) return false; seen.add(t.label); return true })
  }, [allStructureTags])

  const filteredMembers = useMemo(() => {
    if (!tagFilter) return teamMembers
    return teamMembers.filter(m => (tagsByMember[m.id] ?? []).some(t => t.label === tagFilter))
  }, [teamMembers, tagsByMember, tagFilter])

  const filteredDiaries = useMemo(() => {
    return diaries.filter(d => {
      if (filters.dateFrom) {
        const from = new Date(filters.dateFrom)
        from.setHours(0, 0, 0, 0)
        if (new Date(d.created_at) < from) return false
      }
      if (filters.dateTo) {
        const to = new Date(filters.dateTo)
        to.setHours(23, 59, 59, 999)
        if (new Date(d.created_at) > to) return false
      }
      if (filters.operatorId && d.operator_id !== filters.operatorId) return false
      if (filters.onlyIncidents && !d.has_incident) return false
      return true
    })
  }, [diaries, filters])

  const activeCount = [
    filters.preset || filters.dateFrom || filters.dateTo,
    filters.operatorId,
    filters.onlyIncidents,
  ].filter(Boolean).length

  // ── Team functions ───────────────────────────────────────────────────────────

  async function loadTeamCodes() {
    const structureIds = structures.map(s => s.id)
    if (!structureIds.length) return
    setLoadingTeam(true)

    const { data: codes, error } = await supabase
      .from('invitation_codes')
      .select('id, code, role, is_used, used_by, created_at, structure_id')
      .in('structure_id', structureIds)
      .in('role', ['operator', 'admin_secondary'])
      .order('created_at', { ascending: false })

    if (error || !codes) { setLoadingTeam(false); return }

    const redeemerIds = codes.filter(c => c.used_by).map(c => c.used_by)
    let profileMap = {}
    if (redeemerIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', redeemerIds)
      for (const p of profiles ?? []) profileMap[p.id] = p.full_name
    }

    setTeamCodes(codes.map(c => ({
      ...c,
      redeemerName: c.used_by ? (profileMap[c.used_by] ?? 'Utente') : null,
    })))
    setLoadingTeam(false)
  }

  async function handleGenerateCode() {
    setGenerating(true)
    setGeneratedCode(null)
    setTeamError(null)

    // Strutture selezionate — sia operatore che coordinatore usano multi-checkbox
    // Se c'è una sola struttura nell'org, auto-seleziona quella
    let targetStructureIds =
      structures.length === 1
        ? [structures[0].id]
        : selectedStructureIds.map(Number)

    if (targetStructureIds.length === 0 && !isSecretaryCode) {
      setTeamError('Seleziona almeno una struttura.')
      setGenerating(false)
      return
    }

    const targetStructureId = targetStructureIds[0]

    const code = makeCode()
    const payload = {
      code,
      role: selectedRole,
      structure_id: targetStructureId,
      created_by: session.user.id,
      is_used: false,
      structure_ids: targetStructureIds,
      is_secretary: selectedRole === 'admin_secondary' ? isSecretaryCode : false,
    }

    const { error } = await supabase.from('invitation_codes').insert(payload)

    if (error) {
      setTeamError('Errore nella generazione del codice. Riprova.')
    } else {
      playAudio('action')
      setGeneratedCode(code)
      await loadTeamCodes()
    }
    setGenerating(false)
  }

  async function loadTeamMembers(structureId) {
    setLoadingMembers(true)
    const sid = structureId ?? selectedStructure?.id
    if (!sid) { setLoadingMembers(false); return }

    const [{ data: membersData }, { data: tagsData }] = await Promise.all([
      supabase.rpc('get_team_members', { p_structure_id: sid }),
      supabase.from('operator_tags').select('*').eq('structure_id', sid),
    ])

    setTeamMembers(membersData ?? [])

    const byMember = {}
    for (const tag of (tagsData ?? [])) {
      if (!byMember[tag.profile_id]) byMember[tag.profile_id] = []
      byMember[tag.profile_id].push(tag)
    }
    setTagsByMember(byMember)
    setAllStructureTags(tagsData ?? [])
    setTagFilter(null)
    setLoadingMembers(false)
  }

  async function handleTerminate() {
    if (!terminateTarget) return
    setTerminating(true); setTerminateError('')

    const structureIds = terminateScope === 'all' && terminateStructureIds.length > 0
      ? terminateStructureIds
      : [selectedStructure.id]

    for (const structId of structureIds) {
      const { error: err } = await supabase.rpc('terminate_employment', {
        p_user_id:      terminateTarget.id,
        p_structure_id: structId,
        p_ended_at:     terminateEndedAt,
        p_end_reason:   terminateReason || null,
      })
      if (err) { setTerminateError(err.message); setTerminating(false); return }
    }

    playAudio('success')
    setTeamMembers(prev => prev.filter(m => m.id !== terminateTarget.id))
    setTagsByMember(prev => {
      const next = { ...prev }
      delete next[terminateTarget.id]
      setAllStructureTags(Object.values(next).flat())
      return next
    })
    if (selectedMember?.id === terminateTarget.id) setSelectedMember(null)
    setTerminateTarget(null)
    setTerminateReason('')
    setTerminateScope('current')
    setTerminateStructureIds([])
    setTerminating(false)
  }

  async function loadArchivedMembers() {
    setLoadingArchive(true)
    const { data } = await supabase.rpc('get_archived_employees', {
      p_structure_id: selectedStructure.id,
    })
    setArchivedMembers(data ?? [])
    setLoadingArchive(false)
  }

  async function handleDeleteArchived() {
    if (!confirmDeleteArchived) return
    setDeletingArchived(true)
    const { error: err } = await supabase.rpc('delete_archived_employee', {
      p_archive_id: confirmDeleteArchived.archive_id,
    })
    if (err) { reportError(err.message, 'eliminazione dipendente archiviato'); setDeletingArchived(false); return }
    playAudio('success')
    setArchivedMembers(prev => prev.filter(m => m.archive_id !== confirmDeleteArchived.archive_id))
    setConfirmDeleteArchived(null)
    setDeletingArchived(false)
  }

  function updateMemberTags(memberId, newTags) {
    setTagsByMember(prev => {
      const updated = { ...prev, [memberId]: newTags }
      setAllStructureTags(Object.values(updated).flat())
      return updated
    })
  }

  async function handleDeleteDiary() {
    if (!confirmDeleteDiary) return
    setDeletingDiary(true); setDeleteDiaryError('')
    const { error: err } = await supabase
      .from('diaries')
      .delete()
      .eq('id', confirmDeleteDiary.id)
    if (err) {
      setDeleteDiaryError(err.message)
      setDeletingDiary(false)
      return
    }
    setDiaries(prev => prev.filter(d => d.id !== confirmDeleteDiary.id))
    setConfirmDeleteDiary(null)
    setDeletingDiary(false)
    if (expandedId === confirmDeleteDiary.id) setExpandedId(null)
  }

  function openTeam(targetStructure) {
    const s = targetStructure ?? selectedStructure
    setView('team')
    setGeneratedCode(null)
    setTeamError(null)
    setSelectedStructureIds(s?.id ? [String(s.id)] : [])
    loadTeamCodes()
    loadTeamMembers(s?.id)
  }

  function goBack() {
    // Dalle sezioni → torna al menu struttura
    if (view === 'team-archive') { setView('team'); return }
    if (view === 'diaries' || view === 'team' || view === 'schedule' || view === 'residents' || view === 'structure-info' || view === 'tasks') {
      clearSectionState()
      setSlideClass('slide-in-from-left')
      setView('structure-menu')
      // Ricarica badge task
      if (selectedStructure) {
        fetchOpenTasksCount(selectedStructure.id, profile?.id, true)
          .then(count => setOpenTasksMap(prev => ({ ...prev, [selectedStructure.id]: count })))
      }
      return
    }
    if (view === 'org-dashboard') { setView('structures'); return }
    // Dal menu struttura → torna alla lista strutture
    if (view === 'structure-menu') {
      setSelectedStructure(null)
      setView('structures')
      return
    }
    // Dalle impostazioni / ferie / codici → torna alla lista strutture
    if (view === 'settings' || view === 'absences' || view === 'codes') {
      setView('structures')
      return
    }
    setView('structures')
  }

  // ── Swipe-to-back navigation ──────────────────────────────────────────────
  // Solo swipe-right (pollice da sinistra a destra) → torna alla vista precedente
  // nella gerarchia. Swipe-left (avanzare) disabilitato.
  const swipeTouchX   = useRef(null)
  const swipeTouchY   = useRef(null)
  const swipeBlocked  = useRef(false)
  const mainRef       = useRef(null)       // ref al <main> per la trasformazione live
  const swipeOverlayRef = useRef(null)     // overlay dimming durante il drag

  function hasHorizScrollAncestor(el) {
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el)
      if (['auto', 'scroll'].includes(style.overflowX) && el.scrollWidth > el.clientWidth) return true
      el = el.parentElement
    }
    return false
  }

  function handleSwipeTouchStart(e) {
    swipeBlocked.current = false
    if (e.target instanceof Element && e.target.closest('[role="dialog"], .fixed')) {
      swipeBlocked.current = true; return
    }
    if (e.target instanceof Element && hasHorizScrollAncestor(e.target)) {
      swipeBlocked.current = true; return
    }
    swipeTouchX.current = e.touches[0].clientX
    swipeTouchY.current = e.touches[0].clientY
  }

  function handleSwipeTouchMove(e) {
    if (swipeBlocked.current || swipeTouchX.current === null) return
    if (!SWIPE_BACK_VIEWS.has(view)) return

    const dx = e.touches[0].clientX - swipeTouchX.current
    const dy = e.touches[0].clientY - swipeTouchY.current

    // Solo drag verso destra (back), e solo se prevalentemente orizzontale
    if (dx <= 0 || Math.abs(dy) > dx * 0.7) return

    const progress = Math.min(dx / 280, 1)
    if (mainRef.current) {
      mainRef.current.style.transform = `translateX(${dx}px)`
      mainRef.current.style.boxShadow = `-6px 0 24px rgba(0,0,0,${0.12 * progress})`
    }
    if (swipeOverlayRef.current)
      swipeOverlayRef.current.style.opacity = String(progress * 0.35)
  }

  function handleSwipeTouchEnd(e) {
    if (swipeBlocked.current || swipeTouchX.current === null) return

    const dx = e.changedTouches[0].clientX - swipeTouchX.current
    const dy = e.changedTouches[0].clientY - swipeTouchY.current
    swipeTouchX.current = null

    const resetOverlay = () => {
      if (swipeOverlayRef.current) {
        swipeOverlayRef.current.style.transition = 'opacity 0.25s ease-out'
        swipeOverlayRef.current.style.opacity = '0'
      }
    }

    // Gesto valido: swipe-right oltre soglia, prevalentemente orizzontale, vista backabile
    if (dx > 100 && Math.abs(dy) <= dx * 0.7 && SWIPE_BACK_VIEWS.has(view)) {
      // Anima uscita verso destra poi chiama goBack
      if (mainRef.current) {
        mainRef.current.style.transition = 'transform 0.18s ease-out'
        mainRef.current.style.transform  = 'translateX(100%)'
      }
      resetOverlay()
      setTimeout(() => {
        // goBack() cambia view → React rimonta <main> con key diverso,
        // il vecchio nodo con translateX(100%) viene smontato senza flash
        goBack()
      }, 180)
    } else {
      // Non raggiunta soglia → spring back
      if (mainRef.current) {
        mainRef.current.style.transition = 'transform 0.28s ease-out'
        mainRef.current.style.transform  = 'translateX(0)'
        setTimeout(() => {
          if (mainRef.current) {
            mainRef.current.style.transform  = ''
            mainRef.current.style.transition = ''
            mainRef.current.style.boxShadow  = ''
          }
        }, 280)
      }
      resetOverlay()
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f8f9fa]"
      onTouchStart={handleSwipeTouchStart}
      onTouchMove={handleSwipeTouchMove}
      onTouchEnd={handleSwipeTouchEnd}
    >
      {/* Overlay dimming durante swipe-back — opacità controllata via ref */}
      <div ref={swipeOverlayRef} className="fixed inset-0 bg-black pointer-events-none z-[5]" style={{ opacity: 0 }} />

      {/* Header */}
      <header className="bg-[#1e3a5f] px-4 flex items-center gap-2 sticky top-0 z-10 shadow-sm print:hidden"
              style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)', paddingBottom: '0.75rem' }}>

        {/* Back button — condizionale, appare solo nelle sotto-viste */}
        {(view === 'structure-menu' || view === 'diaries' || view === 'team' || view === 'team-archive' || view === 'schedule' || view === 'residents' || view === 'structure-info' || view === 'settings' || view === 'absences' || view === 'codes' || view === 'tasks' || view === 'org-dashboard') && (
          <button
            onClick={goBack}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-white text-[#1e3a5f]
                       active:bg-[#e8eef5] transition-colors shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        {/* Logo + titolo */}
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <img src={logo} alt="Turno" className="h-10 w-auto shrink-0 -ml-2" />

          {/* Strutture/impostazioni: testo semplice */}
          {(view === 'structures' || view === 'settings' || view === 'absences' || view === 'codes' || view === 'tasks' || view === 'org-dashboard' || view === 'archivio-generale') ? (
            <p className="text-white font-bold text-sm truncate">
              {view === 'settings' ? 'Impostazioni' : view === 'absences' ? 'Gestione Ferie' : view === 'codes' ? 'Generazione Codici Personale' : view === 'tasks' ? 'Bacheca Task' : view === 'org-dashboard' ? 'Panoramica' : view === 'archivio-generale' ? 'Archivio Generale' : (orgInfo?.name ?? 'Il tuo Workspace')}
            </p>
          ) : (
            /* Sub-viste: nome struttura cliccabile con dropdown se 2+ strutture */
            <div className="relative min-w-0">
              <button
                type="button"
                onClick={() => structures.length > 1 && setShowSwitcher(p => !p)}
                className={`flex items-center gap-1 leading-tight
                  ${structures.length > 1 ? 'active:opacity-70 transition-opacity' : 'cursor-default pointer-events-none'}`}
              >
                <span className="text-white font-bold text-sm truncate max-w-[160px]">
                  {selectedStructure?.name ?? ''}
                </span>
                {structures.length > 1 && (
                  <svg className="w-4 h-4 shrink-0 text-white/80" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                )}
              </button>

              {showSwitcher && structures.length > 1 && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowSwitcher(false)} />
                  <div className="absolute top-full left-0 mt-2 w-60 bg-white rounded-2xl shadow-xl border border-[#e2e8f0] z-50 overflow-hidden py-1">
                    {structures.filter(s => s.id !== selectedStructure?.id).map(s => (
                      <button key={s.id} type="button"
                        onClick={() => { openStructure(s); setShowSwitcher(false) }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors active:bg-[#f0f4f8]">
                        <span className="w-7 h-7 rounded-lg bg-[#eef2f7] flex items-center justify-center shrink-0">
                          <svg className="w-4 h-4 text-[#1e3a5f]" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                          </svg>
                        </span>
                        <span className="text-sm font-medium text-[#1a202c] truncate">{s.name}</span>
                      </button>
                    ))}
                    <div className="border-t border-[#f0f4f8] mt-1 pt-1">
                      <button type="button"
                        onClick={() => { setView('structures'); setShowSwitcher(false) }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors active:bg-[#f0f4f8]">
                        <span className="w-7 h-7 rounded-lg bg-[#eef2f7] flex items-center justify-center shrink-0">
                          <svg className="w-4 h-4 text-[#1e3a5f]" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                          </svg>
                        </span>
                        <span className="text-sm font-semibold text-[#1e3a5f]">Menu Principale</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Azioni destra */}
        <div className="flex items-center gap-2 shrink-0">
          <BellButton
            unreadCount={notifications.filter(n => !n.is_read).length}
            onClick={openNotifPanel}
          />
          <button
            onClick={() => setView('settings')}
            className={`w-10 h-10 flex items-center justify-center rounded-xl transition-colors
              ${view === 'settings'
                ? 'bg-[#e8eef5] text-[#1e3a5f]'
                : 'bg-white text-[#1e3a5f] active:bg-[#e8eef5]'}`}
            title="Impostazioni"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </header>

      {/* Pannello notifiche */}
      {showNotifPanel && (
        <NotificationsPanel
          notifications={notifications}
          onClose={() => setShowNotifPanel(false)}
          onMarkAllRead={handleMarkAllRead}
          onClearAll={handleClearAll}
          onNavigate={handleNotifNavigate}
        />
      )}

      <main ref={mainRef} className={`pb-16 mx-auto ${view === 'schedule' ? 'py-4 w-full max-w-[1600px] px-0' : view === 'residents' ? 'max-w-2xl px-0' : 'py-6 max-w-lg px-4'} ${slideClass}`} key={view} onAnimationEnd={() => setSlideClass('')}>

        {/* ── Gestione Ferie ── */}
        {view === 'absences' && (
          <AbsencesManagerPanel profile={profile} structures={structures} teamMembers={teamMembers} />
        )}

        {/* ── Impostazioni ── */}
        {view === 'settings' && (
          <SettingsPage
            profile={profile}
            session={session}
            signOut={signOut}
            onGoToAdmin={onGoToAdmin}
            adminEmail={ADMIN_EMAIL}
          />
        )}

        {/* ── Menu struttura ── */}
        {view === 'structure-menu' && selectedStructure && (
          <div className="flex flex-col gap-6">
            {/* Info struttura */}
            <div>
              <h2 className="text-xl font-bold text-[#1a202c]">{selectedStructure.name}</h2>
              {(selectedStructure.type || selectedStructure.address) && (
                <p className="text-sm text-[#718096] mt-1">
                  {selectedStructure.type}{selectedStructure.type && selectedStructure.address ? ' · ' : ''}{selectedStructure.address}
                </p>
              )}
            </div>

            {/* Griglia 2×2 */}
            <div className="grid grid-cols-2 gap-4">
              {[
                { emoji: '📝', title: 'Diario di Bordo',         action: () => { setSlideClass('slide-in-from-right'); openDiaries() } },
                { emoji: '📅', title: 'Turni e Schedule',        action: () => { setSlideClass('slide-in-from-right'); setView('schedule') } },
                { emoji: '👥', title: 'Gestione Team',           action: () => { setSlideClass('slide-in-from-right'); openTeam() } },
                { emoji: '🏠', title: 'Residenti e Documenti',   action: () => { setSlideClass('slide-in-from-right'); setView('residents') } },
              ].map(card => (
                <button
                  key={card.title}
                  type="button"
                  onClick={card.action}
                  className="bg-white rounded-2xl border border-[#e2e8f0] p-6 flex flex-col items-center gap-3
                             shadow-sm hover:shadow-md hover:-translate-y-0.5 active:scale-95
                             transition-all duration-150 text-center"
                >
                  <span className="text-4xl leading-none">{card.emoji}</span>
                  <p className="font-semibold text-[#1a202c] text-sm leading-tight">{card.title}</p>
                </button>
              ))}
            </div>

            {/* Ultima riga: La mia Struttura (larga) + Task (quadrato) */}
            <div className="flex gap-4">
              {/* La mia Struttura — occupa tutto lo spazio rimanente */}
              <button
                type="button"
                onClick={() => setView('structure-info')}
                className="flex-1 bg-white rounded-2xl border border-[#e2e8f0] px-6 py-5
                           flex items-center gap-4 shadow-sm hover:shadow-md hover:-translate-y-0.5
                           active:scale-95 transition-all duration-150 text-left"
              >
                <span className="text-4xl leading-none shrink-0">🏢</span>
                <div>
                  <p className="font-semibold text-[#1a202c] text-sm">La mia Struttura</p>
                  <p className="text-xs text-[#718096] mt-0.5">Info, logo, statistiche e note riservate</p>
                </div>
              </button>

              {/* Task — quadrato */}
              <button
                type="button"
                onClick={() => { setSlideClass('slide-in-from-right'); setView('tasks') }}
                className="relative bg-white rounded-2xl border border-[#e2e8f0] p-4 flex flex-col items-center justify-center gap-2
                           shadow-sm hover:shadow-md hover:-translate-y-0.5 active:scale-95
                           transition-all duration-150 text-center w-24 shrink-0"
              >
                {openTasksMap[selectedStructure?.id] > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full
                                   bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {openTasksMap[selectedStructure?.id]}
                  </span>
                )}
                <span className="text-4xl leading-none">📋</span>
                <p className="font-semibold text-[#1a202c] text-sm leading-tight">Task</p>
              </button>
            </div>
          </div>
        )}

        {/* ── Turni ── */}
        {view === 'schedule' && (
          <ShiftSchedule
            structures={structures}
            canWrite={profile?.role === 'manager' || profile?.role === 'admin_secondary'}
            defaultStructureId={selectedStructure?.id}
            onGoToTeam={() => openTeam(selectedStructure)}
          />
        )}

        {/* ── Residenti ── */}
        {view === 'residents' && (
          <ResidentList
            structures={structures}
            canWrite={profile?.role === 'manager' || profile?.role === 'admin_secondary'}
            defaultStructureId={selectedStructure?.id}
            defaultResidentId={deepLinkResidentId}
            onDeepLinkConsumed={() => setDeepLinkResidentId(null)}
          />
        )}

        {/* ── Task ── */}
        {view === 'tasks' && selectedStructure && (
          <div className="px-4 py-6">
            <TasksPanel structureId={selectedStructure.id} profile={profile} />
          </div>
        )}

        {/* ── La mia Struttura ── */}
        {view === 'structure-info' && selectedStructure && (
          <StructureInfoPage
            structure={selectedStructure}
            profile={profile}
            onLogoChange={url => {
              const updated = { ...selectedStructure, logo_url: url }
              setSelectedStructure(updated)
              setStructures(prev => prev.map(s => s.id === updated.id ? updated : s))
            }}
            onDeleteSuccess={async deletedId => {
              const remaining = structures.filter(s => s.id !== deletedId)
              setStructures(remaining)
              setSelectedStructure(null)
              clearSectionState()
              if (remaining.length > 0) {
                setView('structures')
              } else {
                await signOut()
              }
            }}
          />
        )}

        {/* ── Team ── */}
        {view === 'team' && (
          <div className="flex flex-col gap-6">

            {/* Personale */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-[#718096] uppercase tracking-wider">
                  Personale ({teamMembers.length})
                </h3>
                {isManager && (
                  <button
                    type="button"
                    onClick={() => { loadArchivedMembers(); setView('team-archive') }}
                    className="text-[10px] font-bold text-[#718096] bg-[#f0f4f8] px-2.5 py-1
                               rounded-lg active:bg-[#e2e8f0] transition-colors"
                  >
                    Archivio personale
                  </button>
                )}
              </div>
              {tagFilter && (
                <div className="flex justify-end mb-3">
                  <button
                    type="button"
                    onClick={() => setTagFilter(null)}
                    className="text-[10px] font-semibold text-[#718096] flex items-center gap-1
                               hover:text-[#1a202c] transition-colors"
                  >
                    Rimuovi filtro ×
                  </button>
                </div>
              )}

              {/* Filtro rapido per tag */}
              {uniqueFilterTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {uniqueFilterTags.map(tag => {
                    const c = getTagColor(tag.color)
                    const active = tagFilter === tag.label
                    return (
                      <button
                        key={tag.label}
                        type="button"
                        onClick={() => setTagFilter(active ? null : tag.label)}
                        style={{
                          backgroundColor: active ? c.text : c.bg,
                          color:           active ? 'white' : c.text,
                        }}
                        className="text-[10px] font-bold px-2.5 py-1 rounded-full transition-all"
                      >
                        {tag.label}{active ? ' ×' : ''}
                      </button>
                    )
                  })}
                </div>
              )}

              {loadingMembers ? (
                <div className="flex flex-col gap-2">
                  {[1, 2].map(i => <div key={i} className="h-16 rounded-2xl bg-white border border-[#e2e8f0] animate-pulse" />)}
                </div>
              ) : teamMembers.length === 0 ? (
                <div className="rounded-2xl bg-white border border-dashed border-[#cbd5e0] p-5 text-center">
                  <p className="text-[#718096] text-sm">Nessun operatore associato a questa struttura.</p>
                  {isManager && (
                    <p className="text-[#a0aec0] text-xs mt-1">Invita qualcuno usando un codice invito.</p>
                  )}
                </div>
              ) : filteredMembers.length === 0 ? (
                <div className="rounded-2xl bg-white border border-dashed border-[#cbd5e0] p-5 text-center">
                  <p className="text-[#718096] text-sm">Nessun operatore con il tag «{tagFilter}».</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {filteredMembers.map(m => (
                    <div key={m.id}
                      className="bg-white rounded-2xl border border-[#e2e8f0] px-4 py-3.5 flex items-start gap-3 shadow-sm">
                      <button
                        type="button"
                        onClick={() => setSelectedMember(m)}
                        className="flex items-start gap-3 flex-1 min-w-0 text-left active:opacity-70 transition-opacity"
                      >
                        <div className="w-10 h-10 rounded-xl bg-[#eef2f7] flex items-center justify-center shrink-0 mt-0.5">
                          <span className="text-[#1e3a5f] font-bold text-base leading-none">
                            {m.full_name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-semibold text-[#1a202c] text-sm truncate">{m.full_name}</p>
                            {m.id === profile.id && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full
                                               bg-[#1e3a5f] text-white leading-none shrink-0">
                                Tu
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[#718096] mt-0.5">
                            {ROLE_LABELS[m.role] ?? m.role}
                          </p>
                          {isManager && (m.max_hours_per_week || m.weekly_rest_day || m.contract_pdf_url) && (
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {m.max_hours_per_week && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full
                                                 bg-indigo-50 text-indigo-600 leading-none">
                                  {m.max_hours_per_week}h/sett
                                </span>
                              )}
                              {m.weekly_rest_day && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full
                                                 bg-[#eef2f7] text-[#1e3a5f] leading-none">
                                  riposo {m.weekly_rest_day}
                                </span>
                              )}
                              {m.contract_pdf_url && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full
                                                 bg-green-50 text-green-700 leading-none">
                                  📄 Contratto
                                </span>
                              )}
                            </div>
                          )}
                          {/* Tag: editabili solo dal manager, sola lettura per coordinatore */}
                          {isManager ? (
                            <TagManager
                              memberId={m.id}
                              structureId={m.structure_id}
                              tags={tagsByMember[m.id] ?? []}
                              allStructureTags={allStructureTags}
                              onTagsChange={newTags => updateMemberTags(m.id, newTags)}
                            />
                          ) : (
                            <TagPills tags={tagsByMember[m.id] ?? []} tiny />
                          )}
                        </div>
                        <svg className="w-4 h-4 text-[#a0aec0] shrink-0 mt-1" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

        {/* ── Archivio personale ── */}
        {view === 'team-archive' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-[#718096] uppercase tracking-wider">
                Ex dipendenti
              </h3>
            </div>

            {loadingArchive ? (
              <div className="flex flex-col gap-2">
                {[1,2,3].map(i => <div key={i} className="h-16 rounded-2xl bg-white border border-[#e2e8f0] animate-pulse" />)}
              </div>
            ) : archivedMembers.length === 0 ? (
              <div className="rounded-2xl bg-white border border-dashed border-[#cbd5e0] p-8 text-center">
                <p className="text-sm font-semibold text-[#718096]">Nessun ex dipendente</p>
                <p className="text-xs text-[#a0aec0] mt-1">I dipendenti con rapporto concluso appariranno qui.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {archivedMembers.map(m => (
                  <div key={m.archive_id} className="bg-white rounded-2xl border border-[#e2e8f0] px-4 py-3.5 flex flex-col gap-2 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm text-[#1a202c] truncate">{m.full_name}</p>
                        <p className="text-xs text-[#718096] mt-0.5">{ROLE_LABELS[m.role] ?? m.role}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-right">
                          <p className="text-[10px] text-[#a0aec0]">
                            {m.started_at ? new Date(m.started_at).toLocaleDateString('it-IT') : '—'}
                            {' → '}
                            {m.ended_at ? new Date(m.ended_at).toLocaleDateString('it-IT') : '—'}
                          </p>
                        </div>
                        {isManager && (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteArchived(m)}
                            className="w-8 h-8 flex items-center justify-center rounded-xl
                                       bg-red-50 text-red-400 active:bg-red-100 transition-colors"
                            title="Elimina definitivamente"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round"
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                    {m.end_reason && (
                      <div className="bg-[#f8f9fa] rounded-xl px-3 py-2">
                        <p className={`text-xs text-[#718096] leading-relaxed
                          ${expandedReason === m.archive_id ? '' : 'line-clamp-2'}`}>
                          {m.end_reason}
                        </p>
                        {m.end_reason.length > 80 && (
                          <button
                            type="button"
                            onClick={() => setExpandedReason(expandedReason === m.archive_id ? null : m.archive_id)}
                            className="text-[10px] font-semibold text-[#1e3a5f] mt-1"
                          >
                            {expandedReason === m.id ? 'Mostra meno' : 'Mostra tutto'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Generazione Codici Personale ── */}
        {view === 'codes' && isManager && (
          <div className="flex flex-col gap-6">
            {/* Genera codice */}
            <div className="bg-white rounded-2xl border border-[#e2e8f0] p-5 shadow-sm flex flex-col gap-4">
              <h3 className="text-sm font-semibold text-[#1a202c]">Genera codice invito</h3>

              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: 'operator',        label: 'Operatore' },
                  { value: 'admin_secondary', label: 'Coordinatore' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setSelectedRole(opt.value)
                      setSelectedStructureIds([])
                      setIsSecretaryCode(false)
                      setGeneratedCode(null)
                      setTeamError(null)
                    }}
                    className={`h-12 rounded-xl border-2 text-sm font-semibold transition-colors active:scale-95
                      ${selectedRole === opt.value
                        ? 'bg-[#1e3a5f] border-[#1e3a5f] text-white'
                        : 'bg-white border-[#e2e8f0] text-[#1a202c]'}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Opzione segreteria — solo per coordinatore */}
              {selectedRole === 'admin_secondary' && (
                <label className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors
                  ${isSecretaryCode ? 'border-[#1e3a5f] bg-[#eef2f7]' : 'border-[#e2e8f0] bg-white'}`}>
                  <input
                    type="checkbox"
                    checked={isSecretaryCode}
                    onChange={e => setIsSecretaryCode(e.target.checked)}
                    className="w-4 h-4 accent-[#1e3a5f]"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#1a202c]">Solo Archivio Generale</p>
                    <p className="text-xs text-[#718096] mt-0.5">Accesso esclusivo ai documenti dell'ente (segreteria)</p>
                  </div>
                  <span className="text-lg shrink-0">🗂️</span>
                </label>
              )}

              {/* Strutture di destinazione — multi-checkbox per entrambi i ruoli */}
              {structures.length > 1 && !isSecretaryCode && (
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide">
                    {selectedRole === 'admin_secondary' ? 'Strutture di accesso' : 'Strutture di destinazione'}
                  </label>
                  <div className="flex flex-col gap-1.5">
                    {structures.map(s => {
                      const checked = selectedStructureIds.includes(String(s.id))
                      return (
                        <label
                          key={s.id}
                          className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors
                            ${checked ? 'border-[#1e3a5f] bg-[#eef2f7]' : 'border-[#e2e8f0] bg-white'}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={e => {
                              const id = String(s.id)
                              setSelectedStructureIds(prev =>
                                e.target.checked ? [...prev, id] : prev.filter(x => x !== id)
                              )
                            }}
                            className="w-4 h-4 accent-[#1e3a5f]"
                          />
                          <span className="text-sm font-medium text-[#1a202c]">{s.name}</span>
                        </label>
                      )
                    })}
                  </div>
                  <p className="text-xs text-[#718096]">
                    {selectedRole === 'admin_secondary'
                      ? 'Il coordinatore avrà accesso a tutte le strutture selezionate.'
                      : selectedStructureIds.length > 1
                        ? "L'operatore potrà scegliere la struttura al login."
                        : "Seleziona una o più strutture per l'operatore."}
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={handleGenerateCode}
                disabled={generating}
                className="w-full h-12 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                           active:bg-[#152b47] disabled:opacity-60 transition-colors"
              >
                {generating ? 'Generazione…' : 'Genera codice'}
              </button>

              {teamError && <p className="text-sm text-red-600">{teamError}</p>}

              {generatedCode && (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-green-50 border border-green-200 px-4 py-3">
                  <div>
                    <p className="text-xs text-green-700 font-medium mb-0.5">Codice generato</p>
                    <p className="font-mono font-bold text-[#1a202c] text-lg tracking-widest">{generatedCode}</p>
                  </div>
                  <CopyButton text={generatedCode} />
                </div>
              )}
            </div>

            {/* Lista codici pendenti */}
            {loadingTeam ? (
              <div className="flex flex-col gap-2">
                {[1, 2, 3].map(i => <div key={i} className="h-14 rounded-2xl bg-white border border-[#e2e8f0] animate-pulse" />)}
              </div>
            ) : (() => {
              const pending = teamCodes.filter(c => !c.is_used)
              return (
                <div>
                  <h3 className="text-xs font-semibold text-[#718096] uppercase tracking-wider mb-3">
                    Pendenti ({pending.length})
                  </h3>
                  {pending.length === 0 ? (
                    <div className="rounded-2xl bg-white border border-dashed border-[#cbd5e0] px-5 py-6 flex flex-col items-center text-center gap-2">
                      <svg className="w-7 h-7 text-[#cbd5e0]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                      </svg>
                      <p className="text-sm font-semibold text-[#718096]">Nessun invito attivo</p>
                      <p className="text-xs text-[#a0aec0] leading-relaxed max-w-[220px]">
                        Genera un codice per invitare i tuoi colleghi a unirsi alla struttura.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {pending.map(c => {
                        const structName = structures.find(s => s.id === c.structure_id)?.name ?? ''
                        return (
                          <div key={c.id}
                            className="bg-white rounded-2xl border border-[#e2e8f0] px-4 py-3 flex items-center gap-3 shadow-sm">
                            <div className="flex-1 min-w-0">
                              <p className="font-mono font-bold text-[#1a202c] tracking-widest text-sm">{c.code}</p>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <span className={`text-xs font-semibold rounded-full px-2 py-0.5
                                  ${c.role === 'admin_secondary' ? 'bg-[#eef2f7] text-[#1e3a5f]' : 'bg-green-50 text-green-700'}`}>
                                  {ROLE_LABELS[c.role] ?? c.role}
                                </span>
                                {structName && (
                                  <span className="text-xs text-[#718096] font-medium">
                                    {structName}
                                  </span>
                                )}
                                <span className="text-xs text-[#a0aec0]">
                                  {new Date(c.created_at).toLocaleDateString('it-IT')}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <ShareButtons code={c.code} structureName={structName} />
                              <CopyButton text={c.code} small />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        )}

        {/* ── Strutture ── */}
        {view === 'structures' && (
          <>
            {/* ── Hero Workspace ─────────────────────────────────────────────── */}
            <button type="button" onClick={() => setView('org-dashboard')}
              className="bg-white rounded-2xl border border-[#e2e8f0] shadow-sm px-5 py-5 mb-5 flex items-center gap-4 w-full text-left active:bg-[#f0f4f8] transition-colors">
              <div className="w-12 h-12 rounded-2xl bg-[#1e3a5f] flex items-center justify-center shrink-0">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="font-bold text-[#1a202c] text-base leading-tight truncate">
                  {orgInfo?.name ?? profile?.full_name ?? 'Il tuo Workspace'}
                </h1>
                <p className="text-xs text-[#718096] mt-0.5">Quartiere Generale</p>
              </div>
              <div className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold
                ${orgInfo && structures.length >= orgInfo.max_structures
                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                  : 'bg-[#eef2f7] border-[#e2e8f0] text-[#1e3a5f]'}`}>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                </svg>
                {structures.length} / {orgInfo?.max_structures ?? '—'}
              </div>
              <svg className="w-4 h-4 text-[#a0aec0] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {/* ── Quick actions ────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 gap-2 mb-5">
              {/* Generazione Codici Personale — solo manager */}
              {isManager && (
                <button
                  type="button"
                  onClick={() => { setView('codes'); loadTeamCodes() }}
                  className="w-full bg-white rounded-2xl border border-[#e2e8f0] shadow-sm
                             px-4 py-3.5 flex items-center gap-3 text-left
                             hover:border-[#1e3a5f]/40 active:bg-[#f0f4f8] transition-all"
                >
                  <div className="w-10 h-10 rounded-xl bg-[#eef2f7] flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 text-[#1e3a5f]" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[#1a202c] text-sm leading-tight">Generazione Codici Personale</p>
                    <p className="text-xs text-[#a0aec0] mt-0.5">Genera codici invito per operatori e coordinatori</p>
                  </div>
                  <svg className="w-4 h-4 text-[#a0aec0] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={() => setView('absences')}
                className="w-full bg-white rounded-2xl border border-[#e2e8f0] shadow-sm
                           px-4 py-3.5 flex items-center gap-3 text-left
                           hover:border-[#1e3a5f]/40 active:bg-[#f0f4f8] transition-all"
              >
                <div className="relative w-10 h-10 shrink-0">
                  <div className="w-10 h-10 rounded-xl bg-[#eef2f7] flex items-center justify-center">
                    <svg className="w-5 h-5 text-[#1e3a5f]" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                      <rect x="3" y="4" width="18" height="18" rx="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 2v4M8 2v4M3 10h18"/>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 14h.01M12 14h.01M8 18h.01M12 18h.01M16 14h.01"/>
                    </svg>
                  </div>
                  {pendingAbsencesCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 rounded-full
                                     bg-red-500 text-white text-[9px] font-bold
                                     flex items-center justify-center leading-none">
                      {pendingAbsencesCount > 9 ? '9+' : pendingAbsencesCount}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[#1a202c] text-sm leading-tight">Gestione Ferie</p>
                  <p className="text-xs text-[#a0aec0] mt-0.5">Approva o rifiuta le richieste dei dipendenti</p>
                </div>
                <svg className="w-4 h-4 text-[#a0aec0] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            {/* ── Barra azioni ──────────────────────────────────────────────── */}
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-semibold text-[#718096] uppercase tracking-wider">
                Le tue strutture
              </p>
              {profile?.role === 'manager' && (
                <button
                  onClick={() => { setShowAddStructure(v => !v); setAddStructureError('') }}
                  disabled={orgInfo && structures.length >= orgInfo.max_structures}
                  className={`h-9 px-3 rounded-xl border text-xs font-semibold flex items-center gap-1.5
                    transition-colors active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed
                    ${showAddStructure
                      ? 'bg-[#eef2f7] border-[#1e3a5f] text-[#1e3a5f]'
                      : 'bg-[#1e3a5f] border-[#1e3a5f] text-white'}`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  {orgInfo && structures.length >= orgInfo.max_structures ? 'Limite raggiunto' : 'Aggiungi struttura'}
                </button>
              )}
            </div>

            {showAddStructure && (
              <form onSubmit={handleAddStructure} className="bg-white rounded-2xl border border-[#e2e8f0] p-5 flex flex-col gap-4 mb-4 shadow-sm">
                <p className="text-sm font-semibold text-[#1a202c]">Nuova struttura</p>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide">
                    Nome <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={addForm.name}
                    onChange={e => setAddForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="Es. Casa Famiglia Aurora"
                    className="w-full h-12 px-4 rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c] text-sm
                               outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 transition-colors"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide">
                    Indirizzo completo <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={addForm.address}
                    onChange={e => setAddForm(p => ({ ...p, address: e.target.value }))}
                    placeholder="Via Roma 1, 20100 Milano"
                    className="w-full h-12 px-4 rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c] text-sm
                               outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 transition-colors"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide">
                    Tipologia <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={addForm.type}
                    onChange={e => setAddForm(p => ({ ...p, type: e.target.value }))}
                    className="w-full h-12 px-4 rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c] text-sm
                               outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 appearance-none transition-colors"
                  >
                    <option value="">Seleziona tipologia…</option>
                    <option value="Comunità Alloggio">Comunità Alloggio</option>
                    <option value="Gruppo Appartamento">Gruppo Appartamento</option>
                    <option value="Centro Diurno">Centro Diurno</option>
                    <option value="Casa Famiglia">Casa Famiglia</option>
                    <option value="Pronto Intervento">Pronto Intervento</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide">
                    Posti letto / capacità <span className="text-[#a0aec0] font-normal normal-case">(opzionale)</span>
                  </label>
                  <input
                    type="number" min={1} max={100}
                    value={addForm.capacity}
                    onChange={e => setAddForm(p => ({ ...p, capacity: e.target.value }))}
                    placeholder="Es. 8"
                    className="w-full h-12 px-4 rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c] text-sm
                               outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 transition-colors"
                  />
                </div>

                {addStructureError && (
                  <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                    {addStructureError}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => { setShowAddStructure(false); setAddStructureError('') }}
                    className="flex-1 h-12 rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c] font-semibold text-sm
                               active:bg-[#f8f9fa] transition-colors"
                  >
                    Annulla
                  </button>
                  <button
                    type="submit"
                    disabled={addingStructure}
                    className="flex-1 h-12 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                               active:bg-[#152b47] disabled:opacity-60 transition-colors"
                  >
                    {addingStructure ? 'Creazione…' : 'Crea struttura'}
                  </button>
                </div>
              </form>
            )}

            {loadingStructures ? (
              <div className="flex flex-col gap-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-20 rounded-2xl bg-white border border-[#e2e8f0] animate-pulse" />
                ))}
              </div>
            ) : structures.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 px-6 text-center
                              rounded-2xl bg-white border border-dashed border-[#cbd5e0]">
                <div className="w-20 h-20 rounded-2xl bg-[#eef2f7] flex items-center justify-center mb-5">
                  <svg className="w-10 h-10 text-[#1e3a5f]/40" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                  </svg>
                </div>
                <h2 className="text-base font-bold text-[#1a202c] mb-2">Benvenuto nel tuo Workspace!</h2>
                <p className="text-sm text-[#718096] max-w-xs mb-6 leading-relaxed">
                  Qui potrai gestire tutte le tue strutture. Inizia creando la prima per rendere operativa la tua cooperativa.
                </p>
                {profile?.role === 'manager' && (
                  <button
                    onClick={() => { setShowAddStructure(true); setAddStructureError('') }}
                    disabled={orgInfo && structures.length >= orgInfo.max_structures}
                    className="h-11 px-6 rounded-xl bg-[#1e3a5f] text-white text-sm font-semibold
                               flex items-center gap-2 active:bg-[#152b47] disabled:opacity-40
                               disabled:cursor-not-allowed transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Aggiungi la prima struttura
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {structures.map(s => (
                  <StructureCard
                    key={s.id}
                    structure={s}
                    lastAt={lastDiaryMap[s.id] ?? null}
                    onClick={() => openStructure(s)}
                  />
                ))}

                {/* Archivio Generale */}
                <button
                  type="button"
                  onClick={() => setView('archivio-generale')}
                  className="w-full bg-white rounded-2xl border border-[#e2e8f0] p-5 flex items-center gap-4
                             active:bg-[#f0f4f8] transition-colors text-left shadow-sm
                             hover:border-[#1e3a5f]/40 hover:shadow-md"
                >
                  <div className="w-11 h-11 rounded-xl bg-[#eef2f7] flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 text-[#1e3a5f]" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[#1a202c] text-base leading-tight">Archivio Generale</p>
                    <p className="text-xs text-[#a0aec0] mt-0.5">Accreditamenti, autorizzazioni e documenti ente</p>
                  </div>
                  <svg className="w-4 h-4 text-[#a0aec0] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                  </svg>
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Org Dashboard ── */}
        {view === 'org-dashboard' && (
          <OrgDashboard
            structures={structures}
            orgInfo={orgInfo}
            profile={profile}
          />
        )}

        {/* ── Archivio Generale ── */}
        {view === 'archivio-generale' && (
          <div className="fixed inset-0 z-40">
            <ArchivioGenerale
              structures={structures}
              onClose={() => setView('structures')}
            />
          </div>
        )}

        {/* ── Diari ── */}
        {view === 'diaries' && (
          <>
            {/* Tab switcher Oggi / Archivio */}
            <div className="flex gap-1 p-1 bg-[#eef2f7] rounded-2xl mb-5">
              {[
                { key: 'oggi',    label: 'Oggi' },
                { key: 'archivio', label: 'Archivio' },
              ].map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setDiarySubView(tab.key)}
                  className={`flex-1 h-9 rounded-xl text-sm font-semibold transition-colors
                    ${diarySubView === tab.key
                      ? 'bg-white text-[#1e3a5f] shadow-sm'
                      : 'text-[#718096] hover:text-[#1a202c]'}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ── Tab: Oggi ── */}
            {diarySubView === 'oggi' && (
              <div className="flex flex-col gap-5">

                {/* Diari di oggi — visione d'insieme */}
                <div>
                  <p className="text-xs font-semibold text-[#718096] uppercase tracking-wider mb-3">
                    Diari di oggi ({todayDiaries.length})
                  </p>
                  {loadingDiaries ? (
                    <div className="flex flex-col gap-3">
                      {[1, 2].map(i => (
                        <div key={i} className="h-20 rounded-2xl bg-white border border-[#e2e8f0] animate-pulse" />
                      ))}
                    </div>
                  ) : todayDiaries.length === 0 ? (
                    <div className="rounded-2xl bg-white border border-dashed border-[#cbd5e0] p-6 text-center">
                      <p className="text-[#718096] text-sm">Nessun diario scritto oggi.</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {todayDiaries.map(d => (
                        <div key={d.id} id={`diary-${d.id}`}>
                          <DiaryRow
                            diary={d}
                            views={viewsMap[d.id] ?? []}
                            expanded={expandedId === d.id}
                            orgName={orgInfo?.name}
                            structureName={selectedStructure?.name}
                            structureAddress={selectedStructure?.address}
                            logoUrl={selectedStructure?.logo_url}
                            onDelete={diary => { setDeleteDiaryError(''); setConfirmDeleteDiary(diary) }}
                            onToggle={() => {
                              const isOpening = expandedId !== d.id
                              setExpandedId(prev => prev === d.id ? null : d.id)
                              if (isOpening) handleViewDiary(d.id)
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Farmaci del giorno */}
                {effectiveProfile && (
                  <MedPanel profile={effectiveProfile} onDiaryCreated={reloadDiaries} />
                )}

                {/* Form nuovo diario */}
                <div className="bg-white rounded-2xl border border-[#e2e8f0] shadow-sm p-5">
                  <h3 className="text-sm font-semibold text-[#1a202c] mb-4">Nuovo diario di turno</h3>
                  {effectiveProfile && (
                    <DiaryForm profile={effectiveProfile} onSubmitted={reloadDiaries} />
                  )}
                </div>
              </div>
            )}

            {/* ── Tab: Archivio ── */}
            {diarySubView === 'archivio' && (
              <>
                {/* Toolbar filtri + export */}
                <div className="flex items-center gap-2 mb-4">
                  <button
                    onClick={() => setShowFilters(v => !v)}
                    className={`flex items-center gap-1.5 h-9 px-3 rounded-xl border text-sm font-medium
                      transition-colors active:scale-95
                      ${showFilters || activeCount > 0
                        ? 'bg-[#1e3a5f] border-[#1e3a5f] text-white'
                        : 'bg-white border-[#e2e8f0] text-[#1a202c]'}`}
                  >
                    <IconFilter />
                    Filtri
                    {activeCount > 0 && (
                      <span className="ml-0.5 bg-white text-[#1e3a5f] text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center">
                        {activeCount}
                      </span>
                    )}
                  </button>

                  <div className="flex-1" />

                  <button
                    onClick={() => exportCSV(filteredDiaries, selectedStructure?.name ?? 'struttura')}
                    disabled={filteredDiaries.length === 0}
                    className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-[#e2e8f0]
                      bg-white text-[#1a202c] text-sm font-medium
                      active:bg-[#f8f9fa] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <IconDownload />
                    CSV
                  </button>

                  <button
                    onClick={() => exportDiariesPdf(filteredDiaries, orgInfo?.name, selectedStructure?.name, selectedStructure?.address, selectedStructure?.logo_url)}
                    disabled={filteredDiaries.length === 0}
                    className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-[#e2e8f0]
                      bg-white text-[#1a202c] text-sm font-medium
                      active:bg-[#f8f9fa] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <IconDownload />
                    PDF
                  </button>
                </div>

                {showFilters && (
                  <div className="mb-4">
                    <FilterPanel filters={filters} setFilters={setFilters} operators={operators} />
                  </div>
                )}

                {activeCount > 0 && !loadingDiaries && (
                  <p className="text-xs text-[#718096] mb-3">
                    {filteredDiaries.length} di {diaries.length} diari
                  </p>
                )}

                {loadingDiaries ? (
                  <div className="flex flex-col gap-3">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="h-20 rounded-2xl bg-white border border-[#e2e8f0] animate-pulse" />
                    ))}
                  </div>
                ) : filteredDiaries.length === 0 ? (
                  <div className="rounded-2xl bg-white border border-dashed border-[#cbd5e0] p-8 text-center">
                    <p className="text-[#718096] text-sm">
                      {diaries.length === 0
                        ? 'Nessun diario registrato per questa struttura.'
                        : 'Nessun diario corrisponde ai filtri selezionati.'}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {filteredDiaries.map(d => (
                      <div key={d.id} id={`diary-${d.id}`}>
                        <DiaryRow
                          diary={d}
                          views={viewsMap[d.id] ?? []}
                          expanded={expandedId === d.id}
                          orgName={orgInfo?.name}
                          structureName={selectedStructure?.name}
                          structureAddress={selectedStructure?.address}
                          logoUrl={selectedStructure?.logo_url}
                          onDelete={diary => { setDeleteDiaryError(''); setConfirmDeleteDiary(diary) }}
                          onToggle={() => {
                            const isOpening = expandedId !== d.id
                            setExpandedId(prev => prev === d.id ? null : d.id)
                            if (isOpening) handleViewDiary(d.id)
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}

      </main>

      {/* ── Popup conferma eliminazione dipendente ── */}
      {terminateTarget && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0">
          <div className="absolute inset-0 bg-black/50" onClick={() => !terminating && setTerminateTarget(null)} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 flex flex-col gap-4">

            <div>
              <p className="font-bold text-[#1a202c] text-base">Fine Rapporto di Lavoro</p>
              <p className="text-sm text-[#718096] mt-0.5">{terminateTarget.full_name}</p>
              {terminateScope === 'all' && terminateStructureIds.length > 1 ? (
                <p className="text-xs font-semibold text-amber-700 mt-1.5 bg-amber-50 rounded-lg px-2.5 py-1.5">
                  Rimozione da tutte le strutture ({terminateStructureIds.length})
                </p>
              ) : (
                <p className="text-xs text-[#a0aec0] mt-1">
                  Solo da: {selectedStructure?.name}
                </p>
              )}
            </div>

            {/* Data inizio — sola lettura */}
            <div>
              <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1">
                Data Inizio
              </label>
              <div className="h-11 px-3 flex items-center rounded-xl border border-[#e2e8f0] bg-[#f8f9fa]">
                <p className="text-sm text-[#718096]">
                  {terminateTarget.created_at
                    ? new Date(terminateTarget.created_at).toLocaleDateString('it-IT')
                    : '—'}
                </p>
              </div>
            </div>

            {/* Data fine */}
            <div>
              <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1">
                Data Fine
              </label>
              <input
                type="date"
                value={terminateEndedAt}
                onChange={e => setTerminateEndedAt(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-[#e2e8f0] bg-white text-sm
                           text-[#1a202c] outline-none focus:border-[#1e3a5f] appearance-none transition-colors"
              />
            </div>

            {/* Motivo */}
            <div>
              <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1">
                Motivo Interruzione
              </label>
              <textarea
                value={terminateReason}
                onChange={e => setTerminateReason(e.target.value)}
                placeholder="Inserisci il motivo (opzionale)…"
                rows={3}
                className="w-full px-3 py-2.5 rounded-xl border border-[#e2e8f0] bg-white text-sm
                           text-[#1a202c] outline-none focus:border-[#1e3a5f] resize-none transition-colors"
              />
            </div>

            {terminateError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                {terminateError}
              </p>
            )}

            <div className="flex gap-2">
              <button type="button" disabled={terminating}
                onClick={() => setTerminateTarget(null)}
                className="flex-1 h-11 rounded-xl border border-[#e2e8f0] text-sm font-semibold
                           text-[#718096] active:bg-[#f8f9fa] disabled:opacity-60 transition-colors">
                Annulla
              </button>
              <button type="button" disabled={terminating || !terminateEndedAt}
                onClick={handleTerminate}
                className="flex-1 h-11 rounded-xl bg-amber-600 text-white font-semibold text-sm
                           active:bg-amber-700 disabled:opacity-60 transition-colors">
                {terminating ? 'Salvataggio…' : 'Conferma'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Popup conferma eliminazione definitiva ex-dipendente ── */}
      {confirmDeleteArchived && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => !deletingArchived && setConfirmDeleteArchived(null)} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <div>
                <p className="font-bold text-[#1a202c] text-base">Elimina definitivamente</p>
                <p className="text-sm text-[#718096]">{confirmDeleteArchived.full_name}</p>
              </div>
            </div>
            <p className="text-sm text-[#4a5568] leading-relaxed">
              L'account verrà rimosso dal database in modo permanente.
              I diari storici rimarranno ma non saranno più associati a questo operatore.
              <strong className="text-[#1a202c]"> Questa azione è irreversibile.</strong>
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={deletingArchived}
                onClick={() => setConfirmDeleteArchived(null)}
                className="flex-1 h-11 rounded-xl border border-[#e2e8f0] text-sm font-semibold
                           text-[#718096] active:bg-[#f8f9fa] disabled:opacity-60 transition-colors"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={deletingArchived}
                onClick={handleDeleteArchived}
                className="flex-1 h-11 rounded-xl bg-red-600 text-white font-semibold text-sm
                           active:bg-red-700 disabled:opacity-60 transition-colors"
              >
                {deletingArchived ? 'Eliminazione…' : 'Elimina'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Popup conferma eliminazione diario ── */}
      {confirmDeleteDiary && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => !deletingDiary && setConfirmDeleteDiary(null)} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <div>
                <p className="font-bold text-[#1a202c] text-base">Elimina report</p>
                <p className="text-sm text-[#718096] mt-0.5">
                  {confirmDeleteDiary.profiles?.full_name ?? 'Operatore'} · {formatDateTime(confirmDeleteDiary.created_at)}
                </p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <p className="text-xs font-semibold text-amber-800">Attenzione — operazione irreversibile</p>
              <p className="text-xs text-amber-700 leading-relaxed mt-1">
                Il report verrà eliminato definitivamente e non potrà essere recuperato.
              </p>
            </div>

            {deleteDiaryError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                {deleteDiaryError}
              </p>
            )}

            <div className="flex gap-2">
              <button type="button" disabled={deletingDiary}
                onClick={() => setConfirmDeleteDiary(null)}
                className="flex-1 h-11 rounded-xl border border-[#e2e8f0] text-sm font-semibold
                           text-[#718096] active:bg-[#f8f9fa] disabled:opacity-60 transition-colors">
                Annulla
              </button>
              <button type="button" disabled={deletingDiary}
                onClick={handleDeleteDiary}
                className="flex-1 h-11 rounded-xl bg-red-600 text-white font-semibold text-sm
                           active:bg-red-700 disabled:opacity-60 transition-colors">
                {deletingDiary ? 'Eliminazione…' : 'Elimina'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Profilo membro (bottom sheet) ── */}
      {selectedMember && (
        <MemberProfileSheet
          member={selectedMember}
          profile={profile}
          structures={structures}
          structureId={selectedStructure?.id ?? selectedMember?.structure_id}
          scrollToAbsences={deepLinkMemberToAbsences}
          onClose={() => { setSelectedMember(null); setDeepLinkMemberToAbsences(false) }}
          onMemberUpdate={(memberId, updates) =>
            setTeamMembers(prev => prev.map(m => m.id === memberId ? { ...m, ...updates } : m))
          }
          tags={selectedMember ? (tagsByMember[selectedMember.id] ?? []) : []}
          allStructureTags={allStructureTags}
          onTagsChange={selectedMember
            ? newTags => updateMemberTags(selectedMember.id, newTags)
            : undefined}
          onTerminate={isManager && selectedMember.id !== profile.id ? (m, scope, structureIds) => {
            const today = new Date().toISOString().slice(0, 10)
            setTerminateTarget(m)
            setTerminateScope(scope ?? 'current')
            setTerminateStructureIds(structureIds ?? [])
            setTerminateEndedAt(today)
            setTerminateReason('')
            setTerminateError('')
          } : undefined}
        />
      )}

    </div>
  )
}
