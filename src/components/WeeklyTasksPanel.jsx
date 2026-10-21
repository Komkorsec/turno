import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ─── Costanti ──────────────────────────────────────────────────────────────────

const DAYS   = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica']
const SHIFTS = ['mattina', 'pomeriggio', 'notte']
const SHIFT_LABEL = { mattina: 'Mattina', pomeriggio: 'Pomeriggio', notte: 'Notte' }
const SHIFT_BADGE = {
  mattina:    'bg-amber-100 text-amber-700',
  pomeriggio: 'bg-sky-100   text-sky-700',
  notte:      'bg-indigo-100 text-indigo-700',
}
const SHIFT_SECTION = {
  mattina:    'bg-amber-50  border-amber-100',
  pomeriggio: 'bg-sky-50    border-sky-100',
  notte:      'bg-indigo-50 border-indigo-100',
}

function getWeekStart() {
  const d = new Date()
  const day = d.getDay() // 0=Dom
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d.toISOString().slice(0, 10)
}

function getTodayDow() {
  const day = new Date().getDay()
  return day === 0 ? 7 : day
}

// ─── CheckIcon ─────────────────────────────────────────────────────────────────

function CheckIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

// ─── ShiftSection ─────────────────────────────────────────────────────────────

function ShiftSection({ shift, tasks, logs, canComplete, onComplete, onUncomplete, completingId }) {
  if (tasks.length === 0) return null

  return (
    <div className={`rounded-2xl border p-3 flex flex-col gap-2 ${SHIFT_SECTION[shift]}`}>
      <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full self-start ${SHIFT_BADGE[shift]}`}>
        {SHIFT_LABEL[shift]}
      </span>

      {tasks.map(task => {
        const log  = logs.find(l => l.weekly_task_id === task.id)
        const done = !!log
        const completedAt = log?.completed_at
          ? new Date(log.completed_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
          : null

        return (
          <div key={task.id}
            className={`flex items-start gap-3 bg-white rounded-xl border border-white/80 px-3 py-2.5 transition-opacity ${done ? 'opacity-70' : ''}`}>

            {canComplete ? (
              <button
                type="button"
                disabled={completingId === task.id}
                onClick={() => done ? onUncomplete(log) : onComplete(task)}
                className={`mt-0.5 w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors
                  ${done
                    ? 'bg-green-500 border-green-500 active:bg-green-600'
                    : completingId === task.id
                      ? 'border-[#1e3a5f] animate-pulse'
                      : 'border-[#cbd5e0] active:border-[#1e3a5f]'
                  }`}
              >
                {done && <CheckIcon className="w-3 h-3 text-white" />}
              </button>
            ) : (
              <div className={`mt-0.5 w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center
                ${done ? 'bg-green-500 border-green-500' : 'border-[#cbd5e0]'}`}>
                {done && <CheckIcon className="w-3 h-3 text-white" />}
              </div>
            )}

            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold leading-snug text-[#1a202c] ${done ? 'line-through' : ''}`}>
                {task.title}
              </p>
              {task.description && !done && (
                <p className="text-xs text-[#718096] mt-0.5 leading-relaxed">{task.description}</p>
              )}
              {done && (
                <p className="text-[10px] text-green-600 mt-0.5">
                  Completata{log?.completer?.full_name ? ` da ${log.completer.full_name}` : ''}
                  {completedAt ? ` alle ${completedAt}` : ''}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Form nuova/modifica mansione ─────────────────────────────────────────────

function TaskForm({ structureId, profileId, initial, onSaved, onCancel }) {
  const [title,  setTitle]  = useState(initial?.title       ?? '')
  const [desc,   setDesc]   = useState(initial?.description ?? '')
  const [day,    setDay]    = useState(initial?.day_of_week ?? 1)
  const [shift,  setShift]  = useState(initial?.shift       ?? 'mattina')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const inputCls = `w-full h-11 px-4 rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c] text-base
    outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 transition-colors placeholder:text-[#a0aec0]`

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true); setError('')

    const payload = {
      structure_id: structureId,
      created_by:   profileId,
      title:        title.trim(),
      description:  desc.trim() || null,
      day_of_week:  Number(day),
      shift,
    }

    const { error: err } = initial?.id
      ? await supabase.from('weekly_tasks').update(payload).eq('id', initial.id)
      : await supabase.from('weekly_tasks').insert(payload)

    if (err) { setError('Errore nel salvataggio. Riprova.'); setSaving(false); return }
    setSaving(false)
    onSaved()
  }

  return (
    <form onSubmit={handleSubmit}
      className="bg-[#f8f9fa] rounded-2xl border border-[#e2e8f0] p-4 flex flex-col gap-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#a0aec0]">
        {initial?.id ? 'Modifica mansione' : 'Nuova mansione'}
      </p>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-[#718096]">Titolo *</label>
        <input type="text" required value={title} onChange={e => setTitle(e.target.value)}
          placeholder="Es. Pulizia bagni" className={inputCls} />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-[#718096]">Istruzioni (opzionale)</label>
        <textarea value={desc} onChange={e => setDesc(e.target.value)}
          placeholder="Dettagli operativi…" rows={2}
          className={`${inputCls} h-auto py-3 resize-none`} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-[#718096]">Giorno</label>
          <select value={day} onChange={e => setDay(e.target.value)} className={`${inputCls} pr-8`}>
            {DAYS.map((d, i) => <option key={i + 1} value={i + 1}>{d}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-[#718096]">Turno</label>
          <select value={shift} onChange={e => setShift(e.target.value)} className={`${inputCls} pr-8`}>
            {SHIFTS.map(s => <option key={s} value={s}>{SHIFT_LABEL[s]}</option>)}
          </select>
        </div>
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>}

      <div className="flex gap-2 mt-1">
        <button type="button" onClick={onCancel}
          className="flex-1 h-10 rounded-xl border border-[#e2e8f0] text-sm font-semibold text-[#718096]
                     active:bg-[#f0f4f8] transition-colors">
          Annulla
        </button>
        <button type="submit" disabled={saving || !title.trim()}
          className="flex-[2] h-10 rounded-xl bg-[#1e3a5f] text-white text-sm font-semibold
                     active:bg-[#152b47] disabled:opacity-60 transition-colors">
          {saving ? 'Salvataggio…' : initial?.id ? 'Salva modifiche' : 'Crea mansione'}
        </button>
      </div>
    </form>
  )
}

// ─── Componente principale ─────────────────────────────────────────────────────

export default function WeeklyTasksPanel({ structureId, profile }) {
  const canManage  = profile?.role === 'manager' || profile?.role === 'admin_secondary'
  const weekStart  = getWeekStart()
  const todayDow   = getTodayDow()

  const [tasks,        setTasks]        = useState([])
  const [logs,         setLogs]         = useState([])
  const [loading,      setLoading]      = useState(true)
  const [manageView,   setManageView]   = useState(false)
  const [showForm,     setShowForm]     = useState(false)
  const [editTask,     setEditTask]     = useState(null)
  const [completingId, setCompletingId] = useState(null)
  const [expandedDays, setExpandedDays] = useState({ [todayDow]: true })

  const load = useCallback(async () => {
    setLoading(true)
    const { data: t } = await supabase
      .from('weekly_tasks')
      .select('id, title, description, day_of_week, shift, created_by')
      .eq('structure_id', structureId)
      .order('day_of_week')
      .order('shift')
      .order('title')

    const taskIds = (t ?? []).map(x => x.id)
    const { data: l } = taskIds.length > 0
      ? await supabase
          .from('weekly_task_logs')
          .select('id, weekly_task_id, completed_by, completed_at, completer:profiles!weekly_task_logs_completed_by_fkey(full_name)')
          .eq('week_start', weekStart)
          .in('weekly_task_id', taskIds)
      : { data: [] }

    setTasks(t ?? [])
    setLogs(l ?? [])
    setLoading(false)
  }, [structureId, weekStart])

  useEffect(() => { if (structureId) load() }, [structureId, load])

  async function handleComplete(task) {
    setCompletingId(task.id)
    await supabase.from('weekly_task_logs').insert({
      weekly_task_id: task.id,
      completed_by:   profile.id,
      week_start:     weekStart,
      completed_at:   new Date().toISOString(),
    })
    await load()
    setCompletingId(null)
  }

  async function handleUncomplete(log) {
    setCompletingId(log.weekly_task_id)
    await supabase.from('weekly_task_logs').delete().eq('id', log.id)
    await load()
    setCompletingId(null)
  }

  async function handleDelete(taskId) {
    await supabase.from('weekly_tasks').delete().eq('id', taskId)
    load()
  }

  function toggleDay(dow) {
    setExpandedDays(prev => ({ ...prev, [dow]: !prev[dow] }))
  }

  function switchToManage() {
    setManageView(true); setShowForm(false); setEditTask(null)
  }
  function switchToWeek() {
    setManageView(false); setShowForm(false); setEditTask(null)
  }

  // ── Skeleton loading ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col gap-2 animate-pulse">
        {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-2xl bg-[#e2e8f0]" />)}
      </div>
    )
  }

  // ── Vista operatore (solo oggi) ────────────────────────────────────────────
  if (!canManage) {
    const todayTasks = tasks.filter(t => t.day_of_week === todayDow)
    const doneCt     = todayTasks.filter(t => logs.some(l => l.weekly_task_id === t.id)).length

    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-[#1a202c]">Mansioni di oggi</h2>
          {todayTasks.length > 0 && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
              doneCt === todayTasks.length
                ? 'bg-green-100 text-green-700'
                : 'bg-[#eef2f7] text-[#1e3a5f]'
            }`}>
              {doneCt}/{todayTasks.length} completate
            </span>
          )}
        </div>

        {todayTasks.length === 0 ? (
          <div className="rounded-2xl bg-white border border-[#e2e8f0] px-6 py-10 text-center">
            <p className="text-sm font-semibold text-[#1a202c]">Nessuna mansione per oggi</p>
            <p className="text-xs text-[#a0aec0] mt-1">
              Non ci sono mansioni programmate per {DAYS[todayDow - 1]}.
            </p>
          </div>
        ) : (
          SHIFTS.map(shift => (
            <ShiftSection
              key={shift}
              shift={shift}
              tasks={todayTasks.filter(t => t.shift === shift)}
              logs={logs}
              canComplete
              onComplete={handleComplete}
              onUncomplete={handleUncomplete}
              completingId={completingId}
            />
          ))
        )}
      </div>
    )
  }

  // ── Vista manager ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">

      {/* Header con toggle Settimana / Gestisci */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-[#1a202c]">Mansioni settimanali</h2>
        <div className="flex gap-1 bg-[#f0f4f8] rounded-xl p-1">
          <button type="button" onClick={switchToWeek}
            className={`h-7 px-3 rounded-lg text-xs font-semibold transition-colors
              ${!manageView ? 'bg-white text-[#1e3a5f] shadow-sm' : 'text-[#718096] active:bg-white/50'}`}>
            Settimana
          </button>
          <button type="button" onClick={switchToManage}
            className={`h-7 px-3 rounded-lg text-xs font-semibold transition-colors
              ${manageView ? 'bg-white text-[#1e3a5f] shadow-sm' : 'text-[#718096] active:bg-white/50'}`}>
            Gestisci
          </button>
        </div>
      </div>

      {/* ── Vista settimana ── */}
      {!manageView && (
        <>
          {tasks.length === 0 ? (
            <div className="rounded-2xl bg-white border border-[#e2e8f0] px-6 py-8 text-center">
              <p className="text-sm font-semibold text-[#1a202c]">Nessuna mansione configurata</p>
              <p className="text-xs text-[#a0aec0] mt-1">
                Vai su "Gestisci" per aggiungere le mansioni ricorrenti.
              </p>
            </div>
          ) : (
            DAYS.map((dayName, idx) => {
              const dow       = idx + 1
              const dayTasks  = tasks.filter(t => t.day_of_week === dow)
              if (dayTasks.length === 0) return null

              const isToday   = dow === todayDow
              const expanded  = expandedDays[dow] ?? false
              const doneCt    = dayTasks.filter(t => logs.some(l => l.weekly_task_id === t.id)).length
              const totalCt   = dayTasks.length
              const allDone   = doneCt === totalCt

              return (
                <div key={dow} className={`rounded-2xl border overflow-hidden ${isToday ? 'border-[#1e3a5f]' : 'border-[#e2e8f0]'}`}>
                  <button type="button" onClick={() => toggleDay(dow)}
                    className={`w-full px-4 py-3 flex items-center gap-3 text-left
                      ${isToday ? 'bg-[#1e3a5f] text-white' : 'bg-white text-[#1a202c]'}`}>
                    <span className="flex-1 text-sm font-bold">
                      {dayName}{isToday ? ' · Oggi' : ''}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      isToday
                        ? allDone ? 'bg-green-400/30 text-green-100' : 'bg-white/20 text-white'
                        : allDone ? 'bg-green-100 text-green-700'   : 'bg-[#f0f4f8] text-[#718096]'
                    }`}>
                      {doneCt}/{totalCt}
                    </span>
                    <svg className={`w-4 h-4 transition-transform shrink-0 ${expanded ? 'rotate-180' : ''} ${isToday ? 'text-white/70' : 'text-[#a0aec0]'}`}
                      fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {expanded && (
                    <div className="p-3 flex flex-col gap-2 bg-white">
                      {SHIFTS.map(shift => (
                        <ShiftSection
                          key={shift}
                          shift={shift}
                          tasks={dayTasks.filter(t => t.shift === shift)}
                          logs={logs}
                          canComplete
                          onComplete={handleComplete}
                          onUncomplete={handleUncomplete}
                          completingId={completingId}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </>
      )}

      {/* ── Gestisci mansioni ── */}
      {manageView && (
        <div className="flex flex-col gap-3">

          {!showForm && !editTask && (
            <button type="button" onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-[#1e3a5f] text-white
                         text-xs font-semibold active:bg-[#152b47] transition-colors self-start">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Nuova mansione
            </button>
          )}

          {showForm && (
            <TaskForm
              structureId={structureId}
              profileId={profile.id}
              onSaved={() => { setShowForm(false); load() }}
              onCancel={() => setShowForm(false)}
            />
          )}

          {editTask && (
            <TaskForm
              structureId={structureId}
              profileId={profile.id}
              initial={editTask}
              onSaved={() => { setEditTask(null); load() }}
              onCancel={() => setEditTask(null)}
            />
          )}

          {tasks.length === 0 ? (
            <div className="rounded-2xl bg-white border border-[#e2e8f0] px-6 py-8 text-center">
              <p className="text-sm font-semibold text-[#1a202c]">Nessuna mansione configurata</p>
              <p className="text-xs text-[#a0aec0] mt-1">Aggiungi le mansioni ricorrenti del tuo team.</p>
            </div>
          ) : (
            DAYS.map((dayName, idx) => {
              const dow       = idx + 1
              const dayTasks  = tasks.filter(t => t.day_of_week === dow)
              if (dayTasks.length === 0) return null

              return (
                <div key={dow} className="flex flex-col gap-2">
                  <p className="text-xs font-bold text-[#718096] uppercase tracking-widest pt-1">{dayName}</p>

                  {SHIFTS.map(shift => {
                    const shiftTasks = dayTasks.filter(t => t.shift === shift)
                    if (shiftTasks.length === 0) return null
                    return (
                      <div key={shift} className="flex flex-col gap-1.5">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full self-start ${SHIFT_BADGE[shift]}`}>
                          {SHIFT_LABEL[shift]}
                        </span>
                        {shiftTasks.map(task => (
                          <div key={task.id}
                            className={`flex items-center gap-3 bg-white rounded-xl border border-[#e2e8f0] px-3 py-2.5
                              ${editTask?.id === task.id ? 'opacity-40 pointer-events-none' : ''}`}>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-[#1a202c] leading-snug">{task.title}</p>
                              {task.description && (
                                <p className="text-xs text-[#718096] mt-0.5 truncate">{task.description}</p>
                              )}
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <button type="button"
                                onClick={() => { setEditTask(task); setShowForm(false) }}
                                className="w-8 h-8 rounded-lg bg-[#f0f4f8] text-[#718096] active:bg-[#e2e8f0]
                                           flex items-center justify-center transition-colors">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round"
                                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                              <button type="button"
                                onClick={() => handleDelete(task.id)}
                                className="w-8 h-8 rounded-lg bg-red-50 text-red-400 active:bg-red-100
                                           flex items-center justify-center transition-colors">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round"
                                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
