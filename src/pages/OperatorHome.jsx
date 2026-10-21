import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import NotificationsPanel, { BellButton, fetchNotifications, subscribeNotifications } from '../components/NotificationsPanel'
import MedPanel from '../components/MedPanel'
import DiaryForm from '../components/DiaryForm'
import DiaryEditForm from '../components/DiaryEditForm'
import MyShifts from '../components/MyShifts'
import DiaryComments from '../components/DiaryComments'
import ResidentList from '../components/ResidentList'
import ShiftSchedule from '../components/ShiftSchedule'
import StructureInfoPage from '../components/manager/StructureInfoPage'
import logo from '../assets/logobianco2.svg'
import OperatorSettingsPage from '../components/OperatorSettingsPage'
import TasksPanel, { fetchOpenTasksCount } from '../components/TasksPanel'
import DiaryRow, { formatTime, MOOD_LABEL } from '../components/manager/DiaryRow'
import FilterPanel, { EMPTY_FILTERS, todayFilters } from '../components/manager/FilterPanel'
import { exportDiariesPdf } from '../utils/exportPdf'

// ─── Costanti ────────────────────────────────────────────────────────────────

// Tab order for swipe gestures (settings excluded — accessed via icon)
const SWIPE_TABS = ['diary', 'shifts', 'residents', 'tasks']

const MOOD_CONFIG = {
  1: { label: 'Molto difficile', color: '#ef4444', bg: '#fef2f2', emoji: '😔' },
  2: { label: 'Difficile',       color: '#f97316', bg: '#fff7ed', emoji: '😕' },
  3: { label: 'Nella norma',     color: '#f59e0b', bg: '#fffbeb', emoji: '😐' },
  4: { label: 'Buono',           color: '#84cc16', bg: '#f7fee7', emoji: '🙂' },
  5: { label: 'Ottimo',          color: '#22c55e', bg: '#f0fdf4', emoji: '😊' },
}

const INCIDENT_LABELS = {
  conflitto_ragazzi: 'Conflitto tra ragazzi',
  fuga:              'Fuga',
  problema_esterno:  'Problema esterno',
  altro:             'Altro',
}

const SELECT_FIELDS = `
  id, operator_id, mood, has_incident, incident_type, incident_notes,
  handover_notes, manager_notes, created_at, edited_at, shift_start, shift_end,
  profiles!operator_id ( full_name )
`

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTime(t) {
  return t ? t.slice(0, 5) : null
}

function fmtClock(iso) {
  return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('it-IT', {
    weekday: 'short', day: '2-digit', month: 'short',
  })
}

function fmtAbsDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ─── Card singolo diario nella timeline ──────────────────────────────────────

function DiaryTimelineCard({ diary, isLatest, isFallback, compact = false }) {
  const mood = MOOD_CONFIG[diary.mood] ?? MOOD_CONFIG[3]
  const [showComments, setShowComments] = useState(false)
  const [commentCount, setCommentCount] = useState(null)

  return (
    <div className={`bg-white overflow-hidden
      ${compact ? '' : 'rounded-2xl shadow-sm'}
      ${isLatest && !isFallback && !compact ? 'border-2 border-[#1e3a5f]' : compact ? '' : 'border border-[#e2e8f0]'}`}
    >
      {/* Header */}
      <div className={`flex items-center gap-3 ${compact ? 'px-4 py-3' : 'px-4 py-3'}`}>
        <div
          className={`rounded-xl flex items-center justify-center shrink-0 leading-none
            ${compact ? 'w-8 h-8 text-base' : 'w-10 h-10 text-xl'}`}
          style={{ backgroundColor: mood.bg }}
        >
          {mood.emoji}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`font-semibold text-[#1a202c] ${compact ? 'text-xs' : 'text-sm'}`}>
              {diary.profiles?.full_name ?? 'Operatore'}
            </p>

            {(fmtTime(diary.shift_start) || fmtTime(diary.shift_end)) && (
              <span className="text-xs font-medium bg-[#eef2f7] text-[#1e3a5f] rounded-full px-2 py-0.5 shrink-0">
                {fmtTime(diary.shift_start) ?? '?'} – {fmtTime(diary.shift_end) ?? '?'}
              </span>
            )}

            {diary.has_incident && (
              <span className="text-xs font-semibold bg-red-100 text-red-600 rounded-full px-2 py-0.5 shrink-0">
                Episodio
              </span>
            )}

            {isFallback && (
              <span className="text-xs font-semibold bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 shrink-0">
                Turno precedente
              </span>
            )}

            {diary.edited_at && (
              <span className="text-xs text-[#a0aec0] shrink-0">✏️ modificato</span>
            )}
          </div>

          <p className="text-xs text-[#a0aec0] mt-0.5">
            {isFallback ? fmtDate(diary.created_at) + ' · ' : ''}
            {fmtClock(diary.created_at)}
          </p>
        </div>
      </div>

      {/* Corpo — in compact mostra solo se c'è qualcosa di rilevante */}
      {(!compact || diary.handover_notes || diary.has_incident) && (
        <div className={`border-t border-[#f0f4f8] flex flex-col gap-3
          ${compact ? 'px-4 py-2.5' : 'px-4 py-3'}`}
        >
          {diary.has_incident && (
            <div className="rounded-xl bg-red-50 border border-red-100 px-3 py-2.5">
              <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-1">
                {INCIDENT_LABELS[diary.incident_type] ?? diary.incident_type}
              </p>
              {diary.incident_notes && !compact && (
                <p className="text-sm text-[#1a202c] leading-relaxed">{diary.incident_notes}</p>
              )}
            </div>
          )}

          {diary.handover_notes ? (
            <div>
              {!compact && (
                <p className="text-xs font-semibold text-[#718096] uppercase tracking-wide mb-1.5">
                  Passaggio di consegne
                </p>
              )}
              <p className={`text-[#1a202c] leading-relaxed whitespace-pre-wrap
                ${compact ? 'text-xs line-clamp-2' : 'text-sm'}`}
              >
                {diary.handover_notes}
              </p>
            </div>
          ) : (
            !compact && <p className="text-xs text-[#a0aec0] italic">Nessun passaggio di consegne.</p>
          )}
        </div>
      )}

      {/* Sezione commenti — solo card non compatte */}
      {!compact && (
        <div className="border-t border-[#f0f4f8]">
          <button
            type="button"
            onClick={() => setShowComments(v => !v)}
            className="w-full px-4 py-2.5 flex items-center gap-2 text-left
                       active:bg-[#f8f9fa] transition-colors"
          >
            <svg className="w-3.5 h-3.5 text-[#a0aec0] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span className="text-xs font-medium text-[#718096]">
              {showComments ? 'Nascondi commenti' : (
                commentCount !== null
                  ? `Commenti${commentCount > 0 ? ` (${commentCount})` : ''}`
                  : 'Commenti'
              )}
            </span>
            <svg
              className={`w-3 h-3 text-[#a0aec0] ml-auto shrink-0 transition-transform ${showComments ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showComments && (
            <div className="px-4 pb-4">
              <DiaryComments
                diaryId={diary.id}
                onCountChange={setCommentCount}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Timeline con accordion per report precedenti ────────────────────────────

function DiaryTimeline({ diaries, isFallback }) {
  const [accordionOpen, setAccordionOpen] = useState(false)

  const latest = diaries[0]
  const rest   = diaries.slice(1) // tutti gli altri (oggi, escluso il primo)

  return (
    <div className="flex flex-col gap-3">

      {/* Ultimo report — sempre espanso */}
      <DiaryTimelineCard diary={latest} isLatest isFallback={isFallback} />

      {/* Accordion per i turni precedenti di oggi */}
      {rest.length > 0 && (
        <div className="rounded-2xl border border-[#e2e8f0] bg-white overflow-hidden shadow-sm">
          <button
            type="button"
            onClick={() => setAccordionOpen(v => !v)}
            className="w-full px-4 py-3 flex items-center justify-between gap-3
                       active:bg-[#f8f9fa] transition-colors text-left"
          >
            <span className="text-sm font-semibold text-[#1e3a5f]">
              Visualizza gli altri {rest.length} turni di oggi
            </span>
            <svg
              className={`w-4 h-4 text-[#a0aec0] shrink-0 transition-transform ${accordionOpen ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {accordionOpen && (
            <div className="border-t border-[#f0f4f8] flex flex-col divide-y divide-[#f0f4f8]">
              {rest.map(d => (
                <DiaryTimelineCard key={d.id} diary={d} isLatest={false} isFallback={false} compact />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Scheletro caricamento ────────────────────────────────────────────────────

function TimelineSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[1, 2].map(i => (
        <div key={i} className="rounded-2xl bg-white border border-[#e2e8f0] p-4 animate-pulse">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-[#e2e8f0]" />
            <div className="flex-1">
              <div className="h-3.5 bg-[#e2e8f0] rounded w-1/3 mb-2" />
              <div className="h-3 bg-[#e2e8f0] rounded w-1/4" />
            </div>
          </div>
          <div className="h-3 bg-[#e2e8f0] rounded w-full mb-2" />
          <div className="h-3 bg-[#e2e8f0] rounded w-3/4" />
        </div>
      ))}
    </div>
  )
}


// ─── Pagina principale ────────────────────────────────────────────────────────

export default function OperatorHome() {
  const { profile, signOut, userStructures, setActiveStructure } = useAuth()

  const isCoord = profile?.role === 'admin_secondary'

  const [activeTab,      setActiveTab]      = useState('diary') // 'diary' | 'shifts' | 'residents' | 'tasks'
  const [openTasksCount, setOpenTasksCount] = useState(0)
  const [slideClass,     setSlideClass]     = useState('')
  const [shiftWeekDate,  setShiftWeekDate]  = useState(null)   // ISO date string per navigazione da notifica
  const [showSwitcher,   setShowSwitcher]   = useState(false)  // dropdown cambio struttura

  // ── Struttura completa (solo coordinatore, per impostazioni struttura) ────────
  const [coordStructure, setCoordStructure] = useState(null)

  useEffect(() => {
    if (!isCoord || !profile?.structure_id) return
    supabase
      .from('structures')
      .select('*')
      .eq('id', profile.structure_id)
      .single()
      .then(({ data }) => { if (data) setCoordStructure(data) })
  }, [isCoord, profile?.structure_id])

  // ── Notifiche ────────────────────────────────────────────────────────────────
  const [notifications,  setNotifications]  = useState([])
  const [showNotifPanel, setShowNotifPanel] = useState(false)

  useEffect(() => {
    if (!profile?.id) return
    fetchNotifications(profile.id).then(setNotifications)
    const channel = subscribeNotifications(profile.id, n => {
      setNotifications(prev => [n, ...prev])
      if (n.type === 'task_assigned') {
        setOpenTasksCount(prev => prev + 1)
      }
    })
    return () => { supabase.removeChannel(channel) }
  }, [profile?.id])

  useEffect(() => {
    if (!profile?.structure_id) return
    fetchOpenTasksCount(profile.structure_id, profile.id, isCoord)
      .then(setOpenTasksCount)
  }, [profile?.structure_id, profile?.id, isCoord])

  async function openNotifPanel() {
    setShowNotifPanel(true)
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
    const [targetTab, param] = (notif.link ?? '').split(':')
    const tabMap = { diary: 'diary', diaries: 'diary', shifts: 'shifts', residents: 'residents', tasks: 'tasks' }
    if (tabMap[targetTab]) {
      if (targetTab === 'shifts' && param) setShiftWeekDate(param)
      setActiveTab(tabMap[targetTab])
    }
  }

  // ── Conteggio residenti (per empty state diario) ─────────────────────────────
  const [residentsCount, setResidentsCount] = useState(null) // null = loading

  useEffect(() => {
    if (!profile?.structure_id) return
    supabase
      .from('residents')
      .select('id', { count: 'exact', head: true })
      .eq('structure_id', profile.structure_id)
      .then(({ count }) => setResidentsCount(count ?? 0))
  }, [profile?.structure_id])

  // undefined = caricamento, [] = vuoto, [...] = diari
  const [diaries, setDiaries]     = useState(undefined)
  const [isFallback, setIsFallback] = useState(false)
  const [editing, setEditing]     = useState(false)
  const [diarySubView, setDiarySubView] = useState('oggi') // 'oggi' | 'archivio'
  const [archiveDiaries,    setArchiveDiaries]    = useState(null)  // null = non ancora caricato
  const [loadingArchive,    setLoadingArchive]    = useState(false)
  const [expandedArchiveId, setExpandedArchiveId] = useState(null)
  const [archiveFilters,    setArchiveFilters]    = useState(todayFilters())
  const [showArchiveFilters, setShowArchiveFilters] = useState(false)

  // ── Marca come letti (silenzioso, non blocca la UI) ───────────────────────
  async function markAsRead(diaryIds) {
    if (!profile?.id || !diaryIds.length) return
    for (const id of diaryIds) {
      await supabase
        .from('report_views')
        .upsert(
          { report_id: id, user_id: profile.id, viewed_at: new Date().toISOString() },
          { onConflict: 'report_id,user_id', ignoreDuplicates: true }
        )
    }
  }

  // ── Fetch diari di oggi (o fallback all'ultimo disponibile) ───────────────
  const fetchTodayDiaries = useCallback(async () => {
    setDiaries(undefined)
    setIsFallback(false)

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const { data: todayData, error } = await supabase.rpc('get_structure_diaries', {
      p_structure_id: profile.structure_id,
      p_date_from: todayStart.toISOString(),
      p_limit: 50,
    })

    if (error) {
      console.error('Errore timeline:', error.message)
      setDiaries([])
      return
    }

    const normalize = d => ({ ...d, profiles: { full_name: d.operator_name } })

    if (todayData && todayData.length > 0) {
      const list = todayData.map(normalize)
      setDiaries(list)
      markAsRead(list.map(d => d.id))
      return
    }

    // Nessun diario oggi → fallback all'ultimo in assoluto (turno notte)
    const { data: lastData } = await supabase.rpc('get_structure_diaries', {
      p_structure_id: profile.structure_id,
      p_limit: 1,
    })

    const last = lastData?.[0]
    if (last) {
      setDiaries([normalize(last)])
      setIsFallback(true)
      markAsRead([last.id])
    } else {
      setDiaries([])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.structure_id])

  useEffect(() => {
    fetchTodayDiaries()
  }, [fetchTodayDiaries])

  const fetchArchiveDiaries = useCallback(async () => {
    if (!profile?.structure_id) return
    setLoadingArchive(true)
    const normalize = d => ({ ...d, profiles: { full_name: d.operator_name } })
    const { data } = await supabase.rpc('get_structure_diaries', {
      p_structure_id: profile.structure_id,
      p_limit: 200,
    })
    setArchiveDiaries((data ?? []).map(normalize))
    setLoadingArchive(false)
  }, [profile?.structure_id])

  // Carica archivio la prima volta che l'utente apre la tab archivio
  useEffect(() => {
    if (diarySubView === 'archivio' && archiveDiaries === null) {
      fetchArchiveDiaries()
    }
  }, [diarySubView, archiveDiaries, fetchArchiveDiaries])

  // Controlla farmaci non somministrati ogni volta che l'operatore apre il diario
  useEffect(() => {
    if (activeTab === 'diary' && profile?.id) {
      void supabase.rpc('check_missed_medications')
    }
  }, [activeTab, profile?.id])

  // ── Archivio: valori derivati ─────────────────────────────────────────────
  const filteredArchive = useMemo(() => {
    if (!archiveDiaries) return []
    return archiveDiaries.filter(d => {
      if (archiveFilters.dateFrom) {
        const from = new Date(archiveFilters.dateFrom); from.setHours(0, 0, 0, 0)
        if (new Date(d.created_at) < from) return false
      }
      if (archiveFilters.dateTo) {
        const to = new Date(archiveFilters.dateTo); to.setHours(23, 59, 59, 999)
        if (new Date(d.created_at) > to) return false
      }
      if (archiveFilters.operatorId && d.operator_id !== archiveFilters.operatorId) return false
      if (archiveFilters.onlyIncidents && !d.has_incident) return false
      return true
    })
  }, [archiveDiaries, archiveFilters])

  const archiveOperators = useMemo(() => {
    if (!archiveDiaries) return []
    const seen = new Set()
    return archiveDiaries
      .filter(d => { if (seen.has(d.operator_id)) return false; seen.add(d.operator_id); return true })
      .map(d => ({ id: d.operator_id, name: d.profiles?.full_name ?? 'Operatore' }))
  }, [archiveDiaries])

  const archiveActiveCount = [
    archiveFilters.preset || archiveFilters.dateFrom || archiveFilters.dateTo,
    archiveFilters.operatorId,
    archiveFilters.onlyIncidents,
  ].filter(Boolean).length

  function exportArchiveCSV() {
    if (!filteredArchive.length) return
    const headers = ['Data', 'Ora', 'Operatore', 'Turno inizio', 'Turno fine', 'Umore (1-5)', 'Descrizione umore', 'Episodio critico', 'Tipo episodio', 'Descrizione episodio', 'Passaggio di consegne']
    const rows = filteredArchive.map(d => {
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
      ]
    })
    const csv = [headers, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\r\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `turno-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Il diario più recente in assoluto (primo della lista, ordinata desc)
  const mostRecent = diaries?.[0] ?? null

  // Modifica: solo sull'ultimo diario di oggi che appartiene all'operatore
  const canEdit = mostRecent?.operator_id === profile?.id && !isFallback

  function handleEdited() {
    setEditing(false)
    fetchTodayDiaries()
  }

  // ── Swipe navigation ─────────────────────────────────────────────────────
  const swipeTouchX   = useRef(null)
  const swipeTouchY   = useRef(null)
  const swipeBlocked  = useRef(false)

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
    // Block if inside a modal/fixed overlay
    if (e.target instanceof Element && e.target.closest('[role="dialog"], .fixed')) {
      swipeBlocked.current = true; return
    }
    // Block if inside a horizontally scrollable element
    if (e.target instanceof Element && hasHorizScrollAncestor(e.target)) {
      swipeBlocked.current = true; return
    }
    swipeTouchX.current = e.touches[0].clientX
    swipeTouchY.current = e.touches[0].clientY
  }

  function handleSwipeTouchEnd(e) {
    if (swipeBlocked.current || swipeTouchX.current === null) return
    const dx = e.changedTouches[0].clientX - swipeTouchX.current
    const dy = e.changedTouches[0].clientY - swipeTouchY.current
    swipeTouchX.current = null

    if (Math.abs(dx) < 50) return                    // too short
    if (Math.abs(dy) > Math.abs(dx) * 0.75) return   // too vertical

    const tabIdx = SWIPE_TABS.indexOf(activeTab)
    if (tabIdx === -1) return  // settings tab — no swipe

    if (dx < -50 && tabIdx < SWIPE_TABS.length - 1) {
      setSlideClass('slide-in-from-right')
      setActiveTab(SWIPE_TABS[tabIdx + 1])
    } else if (dx > 50 && tabIdx > 0) {
      setSlideClass('slide-in-from-left')
      setActiveTab(SWIPE_TABS[tabIdx - 1])
    } else if (dx > 80 && tabIdx === 0) {
      // Swipe destra sul primo tab (diario) → torna al menu strutture
      setActiveStructure(null)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f8f9fa]"
      onTouchStart={handleSwipeTouchStart}
      onTouchEnd={handleSwipeTouchEnd}
    >

      {/* Header */}
      <header className="bg-[#1e3a5f] px-4 flex items-center gap-2 sticky top-0 z-10 shadow-sm"
              style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)', paddingBottom: '0.75rem' }}>
        {/* Tasto torna al menu principale */}
        <button
          type="button"
          onClick={() => setActiveStructure(null)}
          className="w-9 h-9 flex items-center justify-center rounded-xl text-white/70
                     active:bg-white/10 transition-colors shrink-0 -ml-1"
          title="Menu principale"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Logo + struttura (cliccabile se multi-struttura) */}
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <img src={logo} alt="Turno" className="h-10 w-auto shrink-0 -ml-2" />

          <div className="relative min-w-0">
            {/* Nome struttura — chevron solo se 2+ strutture */}
            <button
              type="button"
              onClick={() => userStructures.length > 1 && setShowSwitcher(p => !p)}
              className={`flex items-center gap-1 leading-tight
                ${userStructures.length > 1 ? 'active:opacity-70 transition-opacity' : 'cursor-default pointer-events-none'}`}
            >
              <span className="text-white font-bold text-sm truncate max-w-[150px]">
                {userStructures.find(s => s.id === profile?.structure_id)?.name
                  ?? profile?.full_name ?? ''}
              </span>
              {userStructures.length > 1 && (
                <svg className="w-4 h-4 shrink-0 text-white/80" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              )}
            </button>
            {/* Nome utente sotto */}
            <p className="text-white/60 text-[11px] font-medium truncate max-w-[150px] leading-tight">
              {profile?.full_name ?? ''}
            </p>

            {/* Dropdown strutture */}
            {showSwitcher && userStructures.length > 1 && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowSwitcher(false)} />
                <div className="absolute top-full left-0 mt-2 w-60 bg-white rounded-2xl shadow-xl border border-[#e2e8f0] z-50 overflow-hidden py-1">
                  {userStructures.filter(s => s.id !== profile?.structure_id).map(s => (
                    <button key={s.id} type="button"
                      onClick={() => { setActiveStructure(s.id); setShowSwitcher(false) }}
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
                      onClick={() => { setActiveStructure(null); setShowSwitcher(false) }}
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
        </div>

        {/* Azioni destra */}
        <div className="flex items-center gap-2 shrink-0">
          <BellButton
            unreadCount={notifications.filter(n => !n.is_read).length}
            onClick={openNotifPanel}
          />
          <button
            onClick={() => setActiveTab('settings')}
            className={`w-10 h-10 flex items-center justify-center rounded-xl transition-colors
              ${activeTab === 'settings'
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

      <main className={`pb-24 mx-auto ${isCoord && activeTab === 'shifts' ? 'w-full max-w-[1600px] px-0 py-4' : 'max-w-lg'}`}>
      <div key={activeTab} className={slideClass} onAnimationEnd={() => setSlideClass('')}>

      {/* ── TAB: Turni ────────────────────────────────────────────────── */}
      {activeTab === 'shifts' && (
        isCoord
          ? <ShiftSchedule
              structures={userStructures.length > 0 ? userStructures : [{ id: profile?.structure_id }]}
              canWrite={true}
              defaultStructureId={profile?.structure_id}
            />
          : <MyShifts initialWeekDate={shiftWeekDate} />
      )}

      {/* ── TAB: Residenti ──────────────────────────────────────────────── */}
      {activeTab === 'residents' && profile?.structure_id && (
        <ResidentList
          structures={[{ id: profile.structure_id }]}
          canWrite={isCoord}
          canWriteDetail={true}
        />
      )}

      {/* ── TAB: Task ───────────────────────────────────────────────── */}
      {activeTab === 'tasks' && profile?.structure_id && (
        <div className="px-4 py-6">
          <TasksPanel
            structureId={profile.structure_id}
            profile={profile}
            onTaskCompleted={() => setOpenTasksCount(prev => Math.max(0, prev - 1))}
          />
        </div>
      )}

      {/* ── TAB: Impostazioni ──────────────────────────────────────────── */}
      {activeTab === 'settings' && (
        <div className="flex flex-col gap-6 pb-6">
          {isCoord && coordStructure && userStructures.length <= 1 && (
            <StructureInfoPage
              structure={coordStructure}
              profile={profile}
              onLogoChange={url => setCoordStructure(prev => ({ ...prev, logo_url: url }))}
              onDeleteSuccess={() => {}}
            />
          )}
          <OperatorSettingsPage signOut={signOut} />
        </div>
      )}

      {/* ── TAB: Diario ───────────────────────────────────────────────── */}
      {activeTab === 'diary' && <div className="px-4 py-6 flex flex-col gap-6">

        {/* Switcher Oggi / Archivio */}
        <div className="flex gap-1 p-1 bg-[#eef2f7] rounded-2xl">
          {[{ key: 'oggi', label: 'Oggi' }, { key: 'archivio', label: 'Archivio' }].map(t => (
            <button key={t.key} type="button" onClick={() => setDiarySubView(t.key)}
              className={`flex-1 h-9 rounded-xl text-sm font-semibold transition-colors
                ${diarySubView === t.key ? 'bg-white text-[#1e3a5f] shadow-sm' : 'text-[#718096]'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── SUB-VIEW: Oggi ─────────────────────────────────────────── */}
        {diarySubView === 'oggi' && <>

        {/* ── PANEL SOMMINISTRAZIONI ────────────────────────────────────── */}
        <MedPanel profile={profile} onDiaryCreated={fetchTodayDiaries} />

        {/* ── TIMELINE ─────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-xs font-semibold text-[#718096] uppercase tracking-wider">
                Cronologia consegne di oggi
              </h2>
              {isFallback && (
                <p className="text-xs text-amber-600 mt-0.5">
                  Nessun turno ancora oggi — mostra l'ultimo disponibile
                </p>
              )}
              {!isFallback && diaries && diaries.length > 1 && (
                <p className="text-xs text-[#a0aec0] mt-0.5">
                  {diaries.length} turni registrati oggi
                </p>
              )}
            </div>

            {canEdit && !editing && mostRecent && (
              <button
                onClick={() => setEditing(true)}
                className="text-xs font-semibold text-[#1e3a5f] border border-[#c7d7ea] rounded-lg px-2.5 py-1
                           active:bg-[#eef2f7] transition-colors"
              >
                Modifica
              </button>
            )}
          </div>

          {/* Form di modifica */}
          {editing && mostRecent ? (
            <DiaryEditForm
              diary={mostRecent}
              profile={profile}
              onEdited={handleEdited}
              onCancel={() => setEditing(false)}
            />
          ) : diaries === undefined ? (
            <TimelineSkeleton />
          ) : diaries.length === 0 && residentsCount === 0 ? (
            /* Nessun residente censito */
            <div className="rounded-2xl bg-white border border-dashed border-[#cbd5e0] px-6 py-10 flex flex-col items-center text-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-[#eef2f7] flex items-center justify-center">
                <svg className="w-7 h-7 text-[#a0aec0]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </div>
              <div>
                <p className="font-bold text-[#1a202c] text-sm">Nessun residente trovato</p>
                <p className="text-xs text-[#718096] mt-1.5 leading-relaxed max-w-[240px] mx-auto">
                  Per scrivere i diari di bordo, devi prima censire gli ospiti della struttura.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('residents')}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1e3a5f] text-white
                           font-semibold text-sm active:bg-[#152b47] transition-colors"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Censisci Residente
              </button>
            </div>
          ) : diaries.length === 0 ? (
            /* Residenti presenti ma nessuna nota oggi */
            <div className="rounded-2xl bg-white border border-dashed border-[#cbd5e0] px-6 py-10 flex flex-col items-center text-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-[#eef2f7] flex items-center justify-center">
                <svg className="w-7 h-7 text-[#a0aec0]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                </svg>
              </div>
              <div>
                <p className="font-bold text-[#1a202c] text-sm">Ancora nessuna nota per oggi</p>
                <p className="text-xs text-[#718096] mt-1.5 leading-relaxed max-w-[240px] mx-auto">
                  Sii il primo a scrivere come sta andando il turno!
                </p>
              </div>
            </div>
          ) : (
            <DiaryTimeline
              diaries={diaries}
              isFallback={isFallback}
            />
          )}
        </section>

        {/* ── NUOVO DIARIO ─────────────────────────────────────────────── */}
        {!editing && (
          <>
            <div className="border-t border-[#e2e8f0]" />
            <section>
              <h2 className="text-xs font-semibold text-[#718096] uppercase tracking-wider mb-5">
                Nuovo diario di turno
              </h2>
              <DiaryForm profile={profile} onSubmitted={fetchTodayDiaries} />
            </section>
          </>
        )}

        </>}{/* fine oggi */}

        {/* ── SUB-VIEW: Archivio ─────────────────────────────────────── */}
        {diarySubView === 'archivio' && (
          <>
            {/* Toolbar filtri + export */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowArchiveFilters(v => !v)}
                className={`flex items-center gap-1.5 h-9 px-3 rounded-xl border text-sm font-medium
                  transition-colors active:scale-95
                  ${showArchiveFilters || archiveActiveCount > 0
                    ? 'bg-[#1e3a5f] border-[#1e3a5f] text-white'
                    : 'bg-white border-[#e2e8f0] text-[#1a202c]'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M7 10h10M11 16h2" />
                </svg>
                Filtri
                {archiveActiveCount > 0 && (
                  <span className="ml-0.5 bg-white text-[#1e3a5f] text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center">
                    {archiveActiveCount}
                  </span>
                )}
              </button>
              <div className="flex-1" />
              <button
                onClick={exportArchiveCSV}
                disabled={filteredArchive.length === 0}
                className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-[#e2e8f0]
                  bg-white text-[#1a202c] text-sm font-medium
                  active:bg-[#f8f9fa] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4" />
                </svg>
                CSV
              </button>
              <button
                onClick={() => exportDiariesPdf(filteredArchive, null, null, null, null)}
                disabled={filteredArchive.length === 0}
                className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-[#e2e8f0]
                  bg-white text-[#1a202c] text-sm font-medium
                  active:bg-[#f8f9fa] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4" />
                </svg>
                PDF
              </button>
            </div>

            {showArchiveFilters && (
              <FilterPanel
                filters={archiveFilters}
                setFilters={setArchiveFilters}
                operators={archiveOperators}
              />
            )}

            {archiveActiveCount > 0 && !loadingArchive && archiveDiaries && (
              <p className="text-xs text-[#718096]">
                {filteredArchive.length} di {archiveDiaries.length} diari
              </p>
            )}

            {loadingArchive ? (
              <div className="flex flex-col gap-3 animate-pulse">
                {[1,2,3].map(i => <div key={i} className="h-20 rounded-2xl bg-white border border-[#e2e8f0]" />)}
              </div>
            ) : filteredArchive.length === 0 ? (
              <div className="rounded-2xl bg-white border border-dashed border-[#cbd5e0] p-8 text-center">
                <p className="text-[#718096] text-sm">
                  {archiveDiaries?.length === 0
                    ? 'Nessun diario registrato per questa struttura.'
                    : 'Nessun diario corrisponde ai filtri selezionati.'}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {filteredArchive.map(d => (
                  <DiaryRow
                    key={d.id}
                    diary={d}
                    views={[]}
                    expanded={expandedArchiveId === d.id}
                    onToggle={() => setExpandedArchiveId(p => p === d.id ? null : d.id)}
                    canViewManagerNotes={false}
                  />
                ))}
              </div>
            )}
          </>
        )}

      </div>}

      </div>{/* end animated tab wrapper */}
      </main>

      {/* ── BOTTOM TAB BAR ────────────────────────────────────────────── */}
      <nav className="fixed bottom-0 left-0 right-0 z-20 bg-white border-t border-[#e2e8f0]
                      flex safe-bottom shadow-[0_-2px_12px_rgba(0,0,0,0.06)] print:hidden">
        <button
          type="button"
          onClick={() => {
            const from = SWIPE_TABS.indexOf(activeTab), to = SWIPE_TABS.indexOf('diary')
            if (from !== -1 && to !== -1 && from !== to) setSlideClass(to > from ? 'slide-in-from-right' : 'slide-in-from-left')
            setActiveTab('diary')
          }}
          className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 transition-colors
            ${activeTab === 'diary' ? 'text-[#1e3a5f]' : 'text-[#a0aec0]'}`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0121 9.414V19a2 2 0 01-2 2z" />
          </svg>
          <span className="text-[10px] font-semibold tracking-wide uppercase">Diario</span>
          {activeTab === 'diary' && (
            <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-[#1e3a5f] rounded-full" />
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            const from = SWIPE_TABS.indexOf(activeTab), to = SWIPE_TABS.indexOf('shifts')
            if (from !== -1 && to !== -1 && from !== to) setSlideClass(to > from ? 'slide-in-from-right' : 'slide-in-from-left')
            setActiveTab('shifts')
          }}
          className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 relative transition-colors
            ${activeTab === 'shifts' ? 'text-[#1e3a5f]' : 'text-[#a0aec0]'}`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="18" rx="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16 2v4M8 2v4M3 10h18"/>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>
          </svg>
          <span className="text-[10px] font-semibold tracking-wide uppercase">{isCoord ? 'Turni' : 'I miei turni'}</span>
          {activeTab === 'shifts' && (
            <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-[#1e3a5f] rounded-full" />
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            const from = SWIPE_TABS.indexOf(activeTab), to = SWIPE_TABS.indexOf('residents')
            if (from !== -1 && to !== -1 && from !== to) setSlideClass(to > from ? 'slide-in-from-right' : 'slide-in-from-left')
            setActiveTab('residents')
          }}
          className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 relative transition-colors
            ${activeTab === 'residents' ? 'text-[#1e3a5f]' : 'text-[#a0aec0]'}`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
            <circle cx="9" cy="7" r="4" strokeLinecap="round" strokeLinejoin="round"/>
            <path strokeLinecap="round" strokeLinejoin="round" d="M23 21v-2a4 4 0 00-3-3.87"/>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16 3.13a4 4 0 010 7.75"/>
          </svg>
          <span className="text-[10px] font-semibold tracking-wide uppercase">Residenti</span>
          {activeTab === 'residents' && (
            <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-[#1e3a5f] rounded-full" />
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            const from = SWIPE_TABS.indexOf(activeTab), to = SWIPE_TABS.indexOf('tasks')
            if (from !== -1 && to !== -1 && from !== to) setSlideClass(to > from ? 'slide-in-from-right' : 'slide-in-from-left')
            setActiveTab('tasks')
            setOpenTasksCount(0)
          }}
          className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 relative transition-colors
            ${activeTab === 'tasks' ? 'text-[#1e3a5f]' : 'text-[#a0aec0]'}`}
        >
          {openTasksCount > 0 && activeTab !== 'tasks' && (
            <span className="absolute top-2 right-[calc(50%-16px)] min-w-[16px] h-4 px-0.5 rounded-full
                             bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
              {openTasksCount}
            </span>
          )}
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <span className="text-[10px] font-semibold tracking-wide uppercase">Task</span>
          {activeTab === 'tasks' && (
            <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-[#1e3a5f] rounded-full" />
          )}
        </button>

      </nav>
    </div>
  )
}
