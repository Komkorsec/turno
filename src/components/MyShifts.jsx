import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { getTagColor } from './manager/TagManager'

// ─── Costanti ─────────────────────────────────────────────────────────────────

const FIXED_SHIFTS = [
  { type: 'mattina',    label: 'Mattina',    hours: '08–14', icon: '🌅' },
  { type: 'pomeriggio', label: 'Pomeriggio', hours: '14–20', icon: '☀️'  },
  { type: 'notte',      label: 'Notte',      hours: '20–08', icon: '🌙' },
]

const SHIFT_ICON = { mattina: '🌅', pomeriggio: '☀️', notte: '🌙', speciale: '⭐' }

// ─── Date helpers ──────────────────────────────────────────────────────────────

function getMondayOf(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return d
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function toISO(date) {
  const y  = date.getFullYear()
  const m  = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function isToday(dateISO) {
  return dateISO === toISO(new Date())
}

function fmtWeekRange(weekStart) {
  const end = addDays(weekStart, 6)
  return (
    weekStart.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }) +
    ' – ' +
    end.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
  )
}

function fmtDayLong(dateISO) {
  return new Date(dateISO + 'T00:00:00').toLocaleDateString('it-IT', {
    weekday: 'long', day: '2-digit', month: 'long',
  })
}

// ─── Agenda helpers ───────────────────────────────────────────────────────────

function parseSpecialLabel(label = '') {
  const [title, timeRange] = label.split(' · ')
  if (!timeRange) return { title: label, timeRange: '' }
  const [s, e] = timeRange.split('–')
  return { title, timeRange: e ? `${s} – ${e}` : s }
}

function MiniApptCard({ appt }) {
  const start = new Date(appt.start_datetime)
    .toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  const end = appt.end_datetime
    ? new Date(appt.end_datetime).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    : null
  return (
    <div className="flex items-start gap-1.5 rounded-lg bg-indigo-50 border border-indigo-200
                    border-l-[3px] border-l-indigo-400 px-2.5 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-indigo-700 leading-tight">
          📅 {appt.title}{start ? ` | ${start}${end ? `–${end}` : ''}` : ''}
        </p>
        {(appt.residentName || appt.location) && (
          <p className="text-[10px] text-indigo-400 leading-tight mt-0.5 truncate">
            {appt.residentName}{appt.location ? ` · ${appt.location}` : ''}
          </p>
        )}
      </div>
    </div>
  )
}

function MiniSpecialCard({ row }) {
  const { title, timeRange } = parseSpecialLabel(row.label)
  return (
    <div className="flex items-start gap-1.5 rounded-lg bg-orange-50 border border-orange-200
                    border-l-[3px] border-l-orange-400 px-2.5 py-1.5">
      <p className="text-[11px] font-semibold text-orange-700 leading-tight">
        ⭐ {title}{timeRange ? ` | ${timeRange}` : ''}
      </p>
    </div>
  )
}

function MiniAgendaSection({ specials = [], appointments = [] }) {
  const total = specials.length + appointments.length
  if (total === 0) return null
  return (
    <div className="mx-4 mb-3 rounded-xl border border-dashed border-orange-200 bg-[#fffbf7] px-3 pt-2 pb-2.5">
      <p className="text-[9px] font-bold uppercase tracking-wide text-orange-400 leading-none mb-1.5">
        Agenda ed eventi
      </p>
      <div className="flex flex-col gap-1">
        {appointments.map(a => <MiniApptCard key={`a-${a.id}`} appt={a} />)}
        {specials.map(s => <MiniSpecialCard key={`s-${s.id}`} row={s} />)}
      </div>
    </div>
  )
}

// ─── Chip nome operatore (read-only) ──────────────────────────────────────────

function ReadOnlyChip({ name, isMe }) {
  const parts = name.split(' ')
  const firstName = parts[0]
  const lastInitial = parts[1]?.[0]
  const display = lastInitial ? `${firstName} ${lastInitial}.` : firstName

  if (isMe) {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold
                        bg-[#1e3a5f] text-white shrink-0 leading-none">
        {display}
        <span className="text-[9px] bg-white/20 rounded px-1 py-0.5 leading-tight">Tu</span>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center rounded-lg px-2 py-1 text-[11px] font-medium
                      bg-[#dbeafe] text-[#1d4ed8] shrink-0 leading-none">
      {display}
    </span>
  )
}

// ─── Card singolo turno per "I miei turni" ────────────────────────────────────

function MyShiftCard({ schedule, schedules, myId, tagsByUser, mySpecialsByDate, myApptsByDate }) {
  const shift = FIXED_SHIFTS.find(f => f.type === schedule.shift_type)
  const today = isToday(schedule.date)
  const colleagues = schedules.filter(
    x => x.date === schedule.date && x.shift_type === schedule.shift_type && x.user_id !== myId
  )
  const daySpecials = mySpecialsByDate?.[schedule.date] ?? []
  const dayAppts    = myApptsByDate?.[schedule.date]    ?? []

  return (
    <div className={`rounded-2xl overflow-hidden
      ${today ? 'bg-[#1e3a5f] shadow-md' : 'bg-white border border-[#e2e8f0]'}`}>

      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-xl leading-none
          ${today ? 'bg-white/15' : 'bg-[#f0f4f8]'}`}>
          {SHIFT_ICON[schedule.shift_type] ?? '⭐'}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`font-bold text-sm ${today ? 'text-white' : 'text-[#1a202c]'}`}>
              {shift?.label ?? 'Speciale'}
            </p>
            {today && (
              <span className="text-[10px] font-bold bg-white/20 text-white rounded-full px-2 py-0.5 shrink-0">
                OGGI
              </span>
            )}
            {schedule.label && (
              <span className={`text-xs rounded-full px-2 py-0.5 shrink-0
                ${today ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700'}`}>
                {schedule.label}
              </span>
            )}
          </div>
          <p className={`text-xs mt-0.5 ${today ? 'text-[#93c5fd]' : 'text-[#718096]'}`}>
            {fmtDayLong(schedule.date)}
            {shift?.hours ? ` · ${shift.hours}` : ''}
          </p>
        </div>
      </div>

      {/* Colleghi */}
      <div className="px-4 pb-3">
        <p className={`text-xs font-medium mb-1.5
          ${today ? 'text-[#93c5fd]' : 'text-[#a0aec0]'}`}>
          {colleagues.length > 0 ? 'Con:' : 'Solo in turno'}
        </p>
        {colleagues.length > 0 && (
          <div className="flex flex-col gap-2">
            {colleagues.map(c => {
              const cTags = tagsByUser?.[c.user_id] ?? []
              return (
                <div key={c.user_id} className="flex items-start gap-2 flex-wrap">
                  <span className={`text-xs rounded-lg px-2 py-0.5 font-medium shrink-0
                    ${today ? 'bg-white/20 text-white' : 'bg-[#eef2f7] text-[#1e3a5f]'}`}>
                    {c.full_name.split(' ')[0]} {c.full_name.split(' ')[1]?.[0] ?? ''}.
                  </span>
                  {cTags.map(tag => {
                    const col = getTagColor(tag.color)
                    return (
                      <span
                        key={tag.id}
                        style={{ backgroundColor: col.bg, color: col.text }}
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none self-center"
                      >
                        {tag.label}
                      </span>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Agenda ed eventi del giorno assegnati all'operatore */}
      <MiniAgendaSection specials={daySpecials} appointments={dayAppts} />
    </div>
  )
}

// ─── "I tuoi turni questa settimana" (sezione in cima) ───────────────────────

function MyShiftsSummary({ schedules, myId, tagsByUser, mySpecialsByDate, myApptsByDate, isWeekPublished }) {
  const mine = useMemo(
    () => schedules
      .filter(s => s.user_id === myId)
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date)
        const order = { mattina: 0, pomeriggio: 1, notte: 2, speciale: 3 }
        return (order[a.shift_type] ?? 9) - (order[b.shift_type] ?? 9)
      }),
    [schedules, myId]
  )

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-xs font-semibold text-[#718096] uppercase tracking-wider">
          I tuoi turni questa settimana
        </h2>
        {mine.length > 0 && (
          <span className="text-xs font-bold bg-[#1e3a5f] text-white rounded-full px-2.5 py-0.5">
            {mine.length}
          </span>
        )}
      </div>

      {mine.length === 0 && !isWeekPublished && (
        <div className="rounded-2xl bg-white border border-dashed border-[#cbd5e0] px-6 py-10 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-[#eef2f7] flex items-center justify-center">
            <svg className="w-7 h-7 text-[#a0aec0]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-[#1a202c]">Calendario in fase di pianificazione</p>
            <p className="text-xs text-[#718096] mt-1.5 leading-relaxed max-w-[240px] mx-auto">
              Non appena il manager pubblicherà i turni, li vedrai apparire qui.
            </p>
          </div>
        </div>
      )}

      {mine.length === 0 && isWeekPublished && (
        <div className="rounded-2xl bg-white border border-dashed border-[#cbd5e0] px-6 py-10 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center">
            <svg className="w-7 h-7 text-amber-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-[#1a202c]">Nessun turno per questa settimana</p>
            <p className="text-xs text-[#718096] mt-1.5 leading-relaxed max-w-[240px] mx-auto">
              Non hai turni assegnati in questo periodo. Goditi il tuo tempo libero!
            </p>
          </div>
        </div>
      )}

      {mine.length > 0 && (
        <div className="flex flex-col gap-2">
          {mine.map(s => (
            <MyShiftCard key={s.id} schedule={s} schedules={schedules} myId={myId}
              tagsByUser={tagsByUser}
              mySpecialsByDate={mySpecialsByDate}
              myApptsByDate={myApptsByDate} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Card giorno (read-only) — visualizzazione giorno per giorno ──────────────

function ReadOnlyDayCard({ day, scheduleMap, myId, allSpecialsByDate, allApptsByDate }) {
  const dateISO  = toISO(day)
  const today    = isToday(dateISO)
  const hasMine  = FIXED_SHIFTS.some(shift =>
    (scheduleMap[dateISO]?.[shift.type] ?? []).some(r => r.user_id === myId)
  )
  const specials = allSpecialsByDate?.[dateISO] ?? []
  const appts    = allApptsByDate?.[dateISO]    ?? []

  return (
    <div className={`rounded-2xl overflow-hidden border
      ${today
        ? 'border-[#1e3a5f] shadow-md'
        : hasMine
          ? 'border-[#93c5fd]'
          : 'border-[#e2e8f0]'}`}>

      {/* Header giorno */}
      <div className={`px-3 py-2.5 flex items-center justify-between gap-2
        ${today ? 'bg-[#1e3a5f]' : 'bg-[#f8f9fa] border-b border-[#e2e8f0]'}`}>
        <div>
          <p className={`text-[10px] font-bold uppercase tracking-wide leading-none
            ${today ? 'text-[#93c5fd]' : 'text-[#718096]'}`}>
            {day.toLocaleDateString('it-IT', { weekday: 'long' }).replace('.', '')}
          </p>
          <p className={`font-black text-base leading-tight mt-0.5
            ${today ? 'text-white' : 'text-[#1a202c]'}`}>
            {day.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}
          </p>
        </div>
        {today && (
          <span className="text-[10px] font-bold bg-white/20 text-white rounded-full px-2.5 py-0.5 shrink-0">
            OGGI
          </span>
        )}
        {!today && hasMine && (
          <span className="text-[10px] font-bold bg-[#dbeafe] text-[#1e3a5f] rounded-full px-2.5 py-0.5 shrink-0">
            Lavori
          </span>
        )}
      </div>

      {/* Corpo: tre slot turno */}
      <div className="flex flex-col gap-1.5 p-2 bg-white">
        {FIXED_SHIFTS.map(shift => {
          const rows  = scheduleMap[dateISO]?.[shift.type] ?? []
          const isMine = rows.some(r => r.user_id === myId)

          return (
            <div
              key={shift.type}
              className={`rounded-xl border p-2.5
                ${isMine
                  ? 'bg-[#eef2f7] border-[#bfdbfe]'
                  : 'bg-[#f8f9fa] border-[#f0f4f8]'}`}
            >
              {/* Label slot */}
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-sm leading-none">{shift.icon}</span>
                <p className="text-[10px] font-bold text-[#1e3a5f] leading-none">{shift.label}</p>
                <p className="text-[9px] text-[#a0aec0] leading-none ml-0.5">{shift.hours}</p>
                {isMine && (
                  <span className="ml-auto text-[9px] font-bold text-[#1e3a5f] bg-[#dbeafe] rounded px-1.5 py-0.5 leading-none">
                    Il tuo turno
                  </span>
                )}
              </div>

              {/* Operatori */}
              {rows.length === 0 ? (
                <p className="text-[10px] text-[#cbd5e0] italic">—</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {[...rows]
                    .sort((a, b) => (a.user_id === myId ? -1 : b.user_id === myId ? 1 : 0))
                    .map(row => (
                      <ReadOnlyChip
                        key={row.id}
                        name={row.full_name}
                        isMe={row.user_id === myId}
                      />
                    ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Agenda ed eventi del giorno */}
      {(specials.length > 0 || appts.length > 0) && (
        <div className="px-2 pb-2">
          <MiniAgendaSection specials={specials} appointments={appts} />
        </div>
      )}
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-[#e2e8f0] overflow-hidden animate-pulse">
      <div className="h-12 bg-[#e2e8f0]" />
      <div className="p-2 flex flex-col gap-1.5">
        {[1, 2, 3].map(i => <div key={i} className="h-14 rounded-xl bg-[#f0f4f8]" />)}
      </div>
    </div>
  )
}

function SummarySkeleton() {
  return (
    <div className="flex flex-col gap-2 animate-pulse">
      {[1, 2].map(i => (
        <div key={i} className="rounded-2xl border border-[#e2e8f0] overflow-hidden">
          <div className="h-16 bg-[#e2e8f0]" />
          <div className="px-4 pb-3 h-6 bg-[#f8f9fa]" />
        </div>
      ))}
    </div>
  )
}

// ─── Componente principale ────────────────────────────────────────────────────

export default function MyShifts({ initialWeekDate = null }) {
  const { profile } = useAuth()

  const [weekStart,     setWeekStart]     = useState(() =>
    initialWeekDate ? getMondayOf(new Date(initialWeekDate + 'T00:00:00')) : getMondayOf(new Date())
  )
  const [schedules,     setSchedules]     = useState([])
  const [loading,       setLoading]       = useState(true)
  const [tagsByUser,    setTagsByUser]    = useState({})
  const [myApptsByDate, setMyApptsByDate] = useState({})
  const [structureName, setStructureName] = useState('')

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  )

  const loadSchedules = useCallback(() => {
    if (!profile?.structure_id) { setLoading(false); return }
    supabase
      .rpc('get_week_schedules', {
        p_structure_id: profile.structure_id,
        p_week_start:   toISO(weekStart),
      })
      .then(({ data }) => {
        setSchedules(data ?? [])
        setLoading(false)
      })
  }, [profile?.structure_id, weekStart])

  useEffect(() => {
    if (!profile?.structure_id) { setLoading(false); return }
    setLoading(true)
    loadSchedules()
  }, [loadSchedules])

  // Realtime: aggiorna istantaneamente quando il manager pubblica i turni
  useEffect(() => {
    if (!profile?.structure_id) return
    const channel = supabase
      .channel(`myshifts-${profile.structure_id}-${toISO(weekStart)}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'schedules',
          filter: `structure_id=eq.${profile.structure_id}`,
        },
        () => { loadSchedules() }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile?.structure_id, weekStart, loadSchedules])

  // Fetch tag colleghi (una sola volta per struttura)
  useEffect(() => {
    if (!profile?.structure_id) return
    supabase
      .from('operator_tags')
      .select('*')
      .eq('structure_id', profile.structure_id)
      .then(({ data }) => {
        const byUser = {}
        for (const tag of (data ?? [])) {
          if (!byUser[tag.profile_id]) byUser[tag.profile_id] = []
          byUser[tag.profile_id].push(tag)
        }
        setTagsByUser(byUser)
      })
  }, [profile?.structure_id])

  // Fetch nome struttura (per stampa)
  useEffect(() => {
    if (!profile?.structure_id) return
    supabase
      .from('structures').select('name').eq('id', profile.structure_id).single()
      .then(({ data }) => setStructureName(data?.name ?? ''))
  }, [profile?.structure_id])

  // Fetch appuntamenti assegnati all'operatore per la settimana
  useEffect(() => {
    if (!profile?.id || !profile?.structure_id) return
    const weekStart = toISO(weekDays[0])
    const weekEnd   = toISO(weekDays[6])

    async function fetchMyAppts() {
      // Trova i residenti della struttura
      const { data: resRows } = await supabase
        .from('residents')
        .select('id, nome, cognome')
        .eq('structure_id', profile.structure_id)
        .eq('is_archived', false)
      if (!resRows?.length) { setMyApptsByDate({}); return }
      const resLookup = Object.fromEntries(resRows.map(r => [r.id, r]))

      const { data: appts } = await supabase
        .from('resident_appointments')
        .select('id, title, start_datetime, end_datetime, location, resident_id')
        .in('resident_id', resRows.map(r => r.id))
        .gte('start_datetime', weekStart + 'T00:00:00')
        .lte('start_datetime', weekEnd + 'T23:59:59')
        .neq('status', 'cancelled')
        .order('start_datetime')

      const map = {}
      for (const appt of (appts ?? [])) {
        const date = appt.start_datetime.slice(0, 10)
        if (!map[date]) map[date] = []
        const res = resLookup[appt.resident_id]
        map[date].push({ ...appt, residentName: res ? `${res.nome} ${res.cognome}` : '' })
      }
      setMyApptsByDate(map)
    }
    fetchMyAppts()
  }, [profile?.id, profile?.structure_id, weekDays])

  const scheduleMap = useMemo(() => {
    const map = {}
    for (const s of schedules) {
      if (!map[s.date])               map[s.date] = {}
      if (!map[s.date][s.shift_type]) map[s.date][s.shift_type] = []
      map[s.date][s.shift_type].push(s)
    }
    return map
  }, [schedules])

  // Eventi speciali assegnati all'operatore corrente, raggruppati per data
  const mySpecialsByDate = useMemo(() => {
    const map = {}
    for (const s of schedules) {
      if (s.shift_type !== 'speciale' || s.user_id !== profile?.id) continue
      if (!map[s.date]) map[s.date] = []
      map[s.date].push(s)
    }
    return map
  }, [schedules, profile?.id])

  // Tutti gli eventi speciali della struttura (per la griglia), raggruppati per data
  const allSpecialsByDate = useMemo(() => {
    const map = {}
    for (const s of schedules) {
      if (s.shift_type !== 'speciale') continue
      if (!map[s.date]) map[s.date] = []
      map[s.date].push(s)
    }
    return map
  }, [schedules])

  if (!profile?.structure_id) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-[#718096]">Account non ancora associato a una struttura.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 py-4 pb-8">

      {/* ── Header solo stampa ───────────────────────────────────────────── */}
      <div className="hidden print:block px-4 pb-3 border-b border-[#e2e8f0]">
        <p className="text-lg font-black text-[#1e3a5f]">{structureName}</p>
        <p className="text-sm text-[#718096]">Turni settimanali · {fmtWeekRange(weekStart)}</p>
      </div>

      {/* ── Navigazione settimana ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 print:hidden">
        <button
          type="button"
          onClick={() => setWeekStart(d => addDays(d, -7))}
          className="w-9 h-9 flex items-center justify-center rounded-xl border border-[#e2e8f0]
                     bg-white active:bg-[#f0f4f8] transition-colors shrink-0"
        >
          <svg className="w-4 h-4 text-[#1e3a5f]" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex-1 text-center">
          <p className="text-sm font-bold text-[#1a202c]">{fmtWeekRange(weekStart)}</p>
          <div className="flex items-center justify-center gap-3 mt-0.5">
            <span className="inline-flex items-center gap-1 text-[10px] text-[#718096]">
              <span className="w-3 h-3 rounded bg-[#1e3a5f] inline-block" /> I tuoi
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] text-[#718096]">
              <span className="w-3 h-3 rounded bg-[#dbeafe] inline-block" /> Colleghi
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setWeekStart(d => addDays(d, 7))}
          className="w-9 h-9 flex items-center justify-center rounded-xl border border-[#e2e8f0]
                     bg-white active:bg-[#f0f4f8] transition-colors shrink-0"
        >
          <svg className="w-4 h-4 text-[#1e3a5f]" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => window.print()}
          className="w-9 h-9 flex items-center justify-center rounded-xl border border-[#e2e8f0]
                     bg-white active:bg-[#f0f4f8] transition-colors shrink-0"
          title="Stampa / PDF"
        >
          <svg className="w-4 h-4 text-[#718096]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" />
          </svg>
        </button>
      </div>

      {/* ── I tuoi turni questa settimana (in cima) ───────────────────────── */}
      <div className="px-4 print:hidden">
        {loading
          ? (
            <>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-3 w-40 bg-[#e2e8f0] rounded animate-pulse" />
              </div>
              <SummarySkeleton />
            </>
          )
          : <MyShiftsSummary schedules={schedules} myId={profile.id} tagsByUser={tagsByUser}
              mySpecialsByDate={mySpecialsByDate} myApptsByDate={myApptsByDate}
              isWeekPublished={schedules.length > 0} />
        }
      </div>

      {/* ── Griglia giorno per giorno ─────────────────────────────────────── */}
      <div className="px-4">
        <h2 className="text-xs font-semibold text-[#718096] uppercase tracking-wider mb-3 print:hidden">
          Griglia settimanale
        </h2>
        {loading ? (
          <div className="flex flex-col gap-3 print:hidden">
            {[1, 2, 3].map(i => <CardSkeleton key={i} />)}
          </div>
        ) : (
          <div className="flex flex-col gap-3 print:grid print:grid-cols-7 print:gap-1.5">
            {weekDays.map(day => (
              <ReadOnlyDayCard
                key={toISO(day)}
                day={day}
                scheduleMap={scheduleMap}
                myId={profile.id}
                allSpecialsByDate={allSpecialsByDate}
                allApptsByDate={myApptsByDate}
              />
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
