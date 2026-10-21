import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

// ─── Costanti ────────────────────────────────────────────────────────────────

const MOOD_EMOJI = { 1: '😔', 2: '😐', 3: '🙂', 4: '😊', 5: '😄' }

const DAY_ABBR = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function startOfDayISO(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function endOfDayISO(date) {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

function formatTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}

function initials(name) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({ label, value, color }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e2e8f0] shadow-sm px-4 py-5 flex flex-col gap-1 flex-1 min-w-0">
      <p className="text-xs text-[#a0aec0] uppercase tracking-wide leading-none">{label}</p>
      <p className={`text-2xl font-bold leading-tight ${color ?? 'text-[#1e3a5f]'}`}>{value}</p>
    </div>
  )
}

// ─── Loading skeleton ────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="animate-pulse bg-[#e2e8f0] rounded-xl h-24" />
      ))}
    </div>
  )
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function Empty({ text }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <svg className="w-10 h-10 text-[#cbd5e0] mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-3-3v6m-7 4h16a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      <p className="text-sm text-[#a0aec0]">{text}</p>
    </div>
  )
}

// ─── Tab "Oggi" ──────────────────────────────────────────────────────────────

function TabOggi({ structureId }) {
  const [loading, setLoading] = useState(true)
  const [diaries, setDiaries] = useState([])
  const [openTasks, setOpenTasks] = useState([])

  useEffect(() => {
    if (!structureId) return
    setLoading(true)

    const now = new Date()
    const startOfDay = startOfDayISO(now)
    const endOfDay = endOfDayISO(now)

    Promise.all([
      supabase
        .from('diaries')
        .select('id, created_at, profiles!user_id(full_name), has_incident, mood')
        .eq('structure_id', structureId)
        .gte('created_at', startOfDay)
        .lte('created_at', endOfDay)
        .order('created_at', { ascending: false }),
      supabase
        .from('tasks')
        .select('id, title, status, assigned:profiles!assigned_to(full_name)')
        .eq('structure_id', structureId)
        .eq('status', 'open'),
    ]).then(([diariesRes, tasksRes]) => {
      setDiaries(diariesRes.data ?? [])
      setOpenTasks(tasksRes.data ?? [])
      setLoading(false)
    })
  }, [structureId])

  if (loading) return <Skeleton />

  const incidents = diaries.filter(d => d.has_incident).length

  return (
    <div className="flex flex-col gap-5">
      {/* Stat cards */}
      <div className="flex gap-3">
        <StatCard label="Diari oggi" value={diaries.length} />
        <StatCard
          label="Episodi critici"
          value={incidents}
          color={incidents > 0 ? 'text-red-600' : 'text-[#1e3a5f]'}
        />
        <StatCard label="Task aperte" value={openTasks.length} />
      </div>

      {/* Lista diari */}
      <div>
        <p className="text-xs font-semibold text-[#718096] uppercase tracking-wider mb-3">
          Diari di oggi
        </p>
        {diaries.length === 0 ? (
          <Empty text="Nessun diario scritto oggi." />
        ) : (
          <div className="flex flex-col gap-2">
            {diaries.map(d => (
              <div key={d.id} className="bg-white rounded-2xl border border-[#e2e8f0] shadow-sm px-4 py-3 flex items-center gap-3">
                <div className="flex flex-col items-center shrink-0 w-10">
                  <span className="text-xs text-[#a0aec0]">{formatTime(d.created_at)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#1a202c] truncate">
                    {d.profiles?.full_name ?? 'Operatore'}
                  </p>
                </div>
                <span className="text-xl shrink-0">{MOOD_EMOJI[d.mood] ?? '—'}</span>
                {d.has_incident && (
                  <span className="shrink-0 text-[10px] font-bold bg-red-50 text-red-600 border border-red-200 rounded-full px-2 py-0.5">
                    ⚠ Critico
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lista task aperte */}
      <div>
        <p className="text-xs font-semibold text-[#718096] uppercase tracking-wider mb-3">
          Task aperte
        </p>
        {openTasks.length === 0 ? (
          <Empty text="Nessuna task aperta." />
        ) : (
          <div className="flex flex-col gap-2">
            {openTasks.map(t => (
              <div key={t.id} className="bg-white rounded-2xl border border-[#e2e8f0] shadow-sm px-4 py-3 flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#1a202c] truncate">{t.title}</p>
                  {t.assigned?.full_name && (
                    <p className="text-xs text-[#718096] mt-0.5 truncate">{t.assigned.full_name}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Tab "Settimana" ─────────────────────────────────────────────────────────

function TabSettimana({ structureId }) {
  const [loading, setLoading] = useState(true)
  const [diaries, setDiaries] = useState([])
  const [doneTasks, setDoneTasks] = useState([])

  useEffect(() => {
    if (!structureId) return
    setLoading(true)

    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
    sevenDaysAgo.setHours(0, 0, 0, 0)
    const sevenDaysAgoISO = sevenDaysAgo.toISOString()

    Promise.all([
      supabase
        .from('diaries')
        .select('id, created_at, has_incident, user_id, profiles!user_id(full_name)')
        .eq('structure_id', structureId)
        .gte('created_at', sevenDaysAgoISO)
        .order('created_at', { ascending: true }),
      supabase
        .from('tasks')
        .select('id, completed_at, completed_by')
        .eq('structure_id', structureId)
        .eq('status', 'done')
        .gte('completed_at', sevenDaysAgoISO),
    ]).then(([diariesRes, tasksRes]) => {
      setDiaries(diariesRes.data ?? [])
      setDoneTasks(tasksRes.data ?? [])
      setLoading(false)
    })
  }, [structureId])

  if (loading) return <Skeleton />

  // Costruisci array degli ultimi 7 giorni
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - 6 + i)
    d.setHours(0, 0, 0, 0)
    return d
  })

  const dayData = days.map(d => {
    const iso = d.toISOString().slice(0, 10)
    const dayDiaries = diaries.filter(diary => diary.created_at?.slice(0, 10) === iso)
    return {
      label: DAY_ABBR[d.getDay()],
      count: dayDiaries.length,
      hasIncident: dayDiaries.some(diary => diary.has_incident),
    }
  })

  const maxCount = Math.max(...dayData.map(d => d.count), 1)

  // Operatori attivi
  const operatorMap = {}
  for (const d of diaries) {
    const name = d.profiles?.full_name ?? 'Operatore'
    if (!operatorMap[d.user_id]) operatorMap[d.user_id] = { name, count: 0 }
    operatorMap[d.user_id].count++
  }
  const operators = Object.values(operatorMap).sort((a, b) => b.count - a.count)

  const totalIncidents = diaries.filter(d => d.has_incident).length

  // Altezze barre: area utile 100px
  const BAR_MAX_H = 100

  return (
    <div className="flex flex-col gap-5">
      {/* Grafico a barre */}
      <div className="bg-white rounded-2xl border border-[#e2e8f0] shadow-sm px-4 py-5">
        <p className="text-xs font-semibold text-[#718096] uppercase tracking-wider mb-4">
          Diari per giorno
        </p>
        <svg
          width="100%"
          viewBox={`0 0 ${7 * 48} ${BAR_MAX_H + 40}`}
          preserveAspectRatio="xMidYMid meet"
          className="overflow-visible"
        >
          {dayData.map((day, i) => {
            const barH = maxCount > 0 ? Math.round((day.count / maxCount) * BAR_MAX_H) : 0
            const x = i * 48 + 8
            const barW = 32
            const y = BAR_MAX_H - barH
            const fill = day.hasIncident ? '#ef4444' : '#1e3a5f'
            return (
              <g key={i}>
                {/* Numero sopra la barra */}
                {day.count > 0 && (
                  <text
                    x={x + barW / 2}
                    y={y - 4}
                    textAnchor="middle"
                    fontSize="10"
                    fill="#718096"
                    fontWeight="600"
                  >
                    {day.count}
                  </text>
                )}
                {/* Barra */}
                <rect
                  x={x}
                  y={barH > 0 ? y : BAR_MAX_H}
                  width={barW}
                  height={barH > 0 ? barH : 2}
                  rx="4"
                  fill={barH > 0 ? fill : '#e2e8f0'}
                />
                {/* Label giorno */}
                <text
                  x={x + barW / 2}
                  y={BAR_MAX_H + 16}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#a0aec0"
                  fontWeight="500"
                >
                  {day.label}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Stat cards */}
      <div className="flex gap-3">
        <StatCard label="Diari settimana" value={diaries.length} />
        <StatCard
          label="Episodi critici"
          value={totalIncidents}
          color={totalIncidents > 0 ? 'text-red-600' : 'text-[#1e3a5f]'}
        />
        <StatCard label="Op. attivi" value={operators.length} />
      </div>

      {/* Operatori attivi */}
      <div>
        <p className="text-xs font-semibold text-[#718096] uppercase tracking-wider mb-3">
          Operatori attivi
        </p>
        {operators.length === 0 ? (
          <Empty text="Nessun operatore attivo questa settimana." />
        ) : (
          <div className="flex flex-col gap-2">
            {operators.map((op, i) => (
              <div key={i} className="bg-white rounded-2xl border border-[#e2e8f0] shadow-sm px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#eef2f7] flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-[#1e3a5f]">{initials(op.name)}</span>
                </div>
                <p className="flex-1 text-sm font-semibold text-[#1a202c] truncate">{op.name}</p>
                <span className="text-xs font-bold text-[#1e3a5f] bg-[#eef2f7] px-2 py-0.5 rounded-full shrink-0">
                  {op.count} diari
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Ore standard per tipo turno
const SHIFT_HOURS = { mattina: 8, pomeriggio: 8, notte: 10, speciale: 8 }

// ─── Tab "HR" ────────────────────────────────────────────────────────────────

function TabHR({ structureId }) {
  const [period, setPeriod] = useState(7)
  const [loading, setLoading] = useState(true)
  const [schedules, setSchedules] = useState([])
  const [diaries, setDiaries] = useState([])
  const [tasks, setTasks] = useState([])

  useEffect(() => {
    if (!structureId) return
    setLoading(true)

    const periodStart = new Date()
    periodStart.setDate(periodStart.getDate() - (period - 1))
    periodStart.setHours(0, 0, 0, 0)
    const periodStartISO = periodStart.toISOString()
    const periodStartDate = periodStart.toISOString().slice(0, 10)

    const today = new Date().toISOString().slice(0, 10)

    Promise.all([
      supabase.rpc('get_month_schedules', {
        p_structure_id: structureId,
        p_month_start:  periodStartDate,
        p_month_end:    today,
      }),
      supabase
        .from('diaries')
        .select('id, user_id, has_incident, profiles!user_id(full_name)')
        .eq('structure_id', structureId)
        .gte('created_at', periodStartISO),
      supabase
        .from('tasks')
        .select('id, completed_by')
        .eq('structure_id', structureId)
        .eq('status', 'done')
        .gte('completed_at', periodStartISO),
    ]).then(([schRes, diaryRes, taskRes]) => {
      setSchedules(schRes.data ?? [])
      setDiaries(diaryRes.data ?? [])
      setTasks(taskRes.data ?? [])
      setLoading(false)
    })
  }, [structureId, period])

  // Aggregazione per operatore
  const operatorMap = {}

  for (const s of schedules) {
    const name = s.full_name ?? 'Operatore'
    if (!operatorMap[s.user_id]) operatorMap[s.user_id] = { name, hours: 0, shifts: 0, diaries: 0, tasks: 0, incidents: 0 }
    operatorMap[s.user_id].hours += SHIFT_HOURS[s.shift_type] ?? 8
    operatorMap[s.user_id].shifts++
  }

  for (const d of diaries) {
    const name = d.profiles?.full_name ?? 'Operatore'
    if (!operatorMap[d.user_id]) operatorMap[d.user_id] = { name, hours: 0, shifts: 0, diaries: 0, tasks: 0, incidents: 0 }
    operatorMap[d.user_id].diaries++
    if (d.has_incident) operatorMap[d.user_id].incidents++
  }

  for (const t of tasks) {
    if (!t.completed_by) continue
    if (!operatorMap[t.completed_by]) operatorMap[t.completed_by] = { name: 'Operatore', hours: 0, diaries: 0, tasks: 0, incidents: 0 }
    operatorMap[t.completed_by].tasks++
  }

  const operators = Object.values(operatorMap).sort((a, b) => b.hours - a.hours || b.diaries - a.diaries)
  const maxHours = Math.max(...operators.map(o => o.hours), 1)

  if (loading) return <Skeleton />

  return (
    <div className="flex flex-col gap-5">
      {/* Selettore periodo */}
      <div className="flex gap-1.5">
        {[
          { label: '7 giorni', value: 7 },
          { label: '30 giorni', value: 30 },
        ].map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setPeriod(opt.value)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors
              ${period === opt.value
                ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                : 'bg-white text-[#718096] border-[#e2e8f0] active:bg-[#f0f4f8]'}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {operators.length === 0 ? (
        <Empty text="Nessun dato disponibile per questo periodo." />
      ) : (
        <>
          {/* Grafico a barre orizzontali — ore lavorate */}
          {operators.some(o => o.hours > 0) && (
            <div className="bg-white rounded-2xl border border-[#e2e8f0] shadow-sm px-4 py-5">
              <p className="text-xs font-semibold text-[#718096] uppercase tracking-wider mb-4">
                Ore lavorate
              </p>
              <svg
                width="100%"
                viewBox={`0 0 280 ${operators.length * 36}`}
                preserveAspectRatio="xMidYMid meet"
                className="overflow-visible"
              >
                {operators.map((op, i) => {
                  const barW = maxHours > 0 ? Math.round((op.hours / maxHours) * 180) : 0
                  const y = i * 36
                  return (
                    <g key={i}>
                      {/* Nome */}
                      <text x="0" y={y + 14} fontSize="10" fill="#4a5568" fontWeight="500">
                        {op.name.split(' ')[0]}
                      </text>
                      {/* Track */}
                      <rect x="80" y={y + 4} width="180" height="14" rx="4" fill="#eef2f7" />
                      {/* Barra */}
                      {barW > 0 && (
                        <rect x="80" y={y + 4} width={barW} height="14" rx="4" fill="#1e3a5f" />
                      )}
                      {/* Valore */}
                      <text x="268" y={y + 14} fontSize="10" fill="#718096" fontWeight="600" textAnchor="end">
                        {op.hours > 0 ? `${op.hours.toFixed(0)}h` : '—'}
                      </text>
                    </g>
                  )
                })}
              </svg>
            </div>
          )}

          {/* Card per operatore */}
          <div className="flex flex-col gap-3">
            {operators.map((op, i) => (
              <div key={i} className="bg-white rounded-2xl border border-[#e2e8f0] shadow-sm px-4 py-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-full bg-[#eef2f7] flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-[#1e3a5f]">{initials(op.name)}</span>
                  </div>
                  <p className="text-sm font-bold text-[#1a202c] flex-1 truncate">{op.name}</p>
                  {op.incidents > 0 && (
                    <span className="text-[10px] font-bold bg-red-50 text-red-600 border border-red-200 rounded-full px-2 py-0.5 shrink-0">
                      ⚠ {op.incidents}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <div className="flex flex-col items-center bg-[#f8f9fa] rounded-xl py-2 px-1">
                    <p className="text-base font-bold text-[#1e3a5f]">
                      {op.hours > 0 ? `${op.hours}h` : '—'}
                    </p>
                    <p className="text-[10px] text-[#a0aec0] uppercase tracking-wide mt-0.5">Ore</p>
                  </div>
                  <div className="flex flex-col items-center bg-[#f8f9fa] rounded-xl py-2 px-1">
                    <p className="text-base font-bold text-[#1e3a5f]">{op.shifts}</p>
                    <p className="text-[10px] text-[#a0aec0] uppercase tracking-wide mt-0.5">Turni</p>
                  </div>
                  <div className="flex flex-col items-center bg-[#f8f9fa] rounded-xl py-2 px-1">
                    <p className="text-base font-bold text-[#1e3a5f]">{op.diaries}</p>
                    <p className="text-[10px] text-[#a0aec0] uppercase tracking-wide mt-0.5">Diari</p>
                  </div>
                  <div className="flex flex-col items-center bg-[#f8f9fa] rounded-xl py-2 px-1">
                    <p className="text-base font-bold text-[#1e3a5f]">{op.tasks}</p>
                    <p className="text-[10px] text-[#a0aec0] uppercase tracking-wide mt-0.5">Task</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── OrgDashboard ────────────────────────────────────────────────────────────

export default function OrgDashboard({ structures, orgInfo, profile }) {
  const [selectedStructureId, setSelectedStructureId] = useState(structures[0]?.id ?? null)
  const [activeTab, setActiveTab] = useState('oggi')

  const TABS = [
    { key: 'oggi',     label: 'Oggi' },
    { key: 'settimana', label: 'Settimana' },
    { key: 'hr',       label: 'HR' },
  ]

  return (
    <div className="flex flex-col gap-5">
      {/* Selettore struttura — pill tabs orizzontali scrollabili */}
      {structures.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-0 scrollbar-none"
             style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {structures.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedStructureId(s.id)}
              className={`shrink-0 px-4 py-2 rounded-xl text-sm font-semibold border transition-colors
                ${selectedStructureId === s.id
                  ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                  : 'bg-white text-[#718096] border-[#e2e8f0] active:bg-[#f0f4f8]'}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-[#eef2f7] rounded-2xl">
        {TABS.map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 h-9 rounded-xl text-sm font-semibold transition-colors
              ${activeTab === tab.key
                ? 'bg-white text-[#1e3a5f] shadow-sm'
                : 'text-[#718096] hover:text-[#1a202c]'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Contenuto tab */}
      {selectedStructureId ? (
        <>
          {activeTab === 'oggi'      && <TabOggi key={`oggi-${selectedStructureId}`} structureId={selectedStructureId} />}
          {activeTab === 'settimana' && <TabSettimana key={`sett-${selectedStructureId}`} structureId={selectedStructureId} />}
          {activeTab === 'hr'        && <TabHR key={`hr-${selectedStructureId}`} structureId={selectedStructureId} />}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-[#a0aec0]">Nessuna struttura disponibile.</p>
        </div>
      )}
    </div>
  )
}
