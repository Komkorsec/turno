import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import WeeklyTasksPanel from './WeeklyTasksPanel'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return null
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}

function isOverdue(task) {
  if (!task.due_date || task.status === 'done') return false
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return new Date(task.due_date + 'T00:00:00') < today
}

function isDueToday(task) {
  if (!task.due_date || task.status === 'done') return false
  const today = new Date().toISOString().slice(0, 10)
  return task.due_date === today
}

// ─── TaskCard ─────────────────────────────────────────────────────────────────

function TaskCard({ task, canManage, onComplete, onUncomplete, onDelete, currentUserId }) {
  const [expanded, setExpanded] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [uncompleting, setUncompleting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const overdue = isOverdue(task)
  const today   = isDueToday(task)
  const done    = task.status === 'done'

  async function handleComplete() {
    setCompleting(true)
    await onComplete(task)
    setCompleting(false)
  }

  async function handleUncomplete() {
    setUncompleting(true)
    await onUncomplete(task)
    setUncompleting(false)
  }

  async function handleDelete() {
    setDeleting(true)
    await onDelete(task.id)
    setDeleting(false)
  }

  return (
    <div className={`rounded-2xl border transition-all ${done
      ? 'bg-[#f8f9fa] border-[#e2e8f0] opacity-60'
      : overdue
        ? 'bg-red-50 border-red-200'
        : 'bg-white border-[#e2e8f0]'
    }`}>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full px-4 py-3.5 flex items-start gap-3 text-left"
      >
        {/* Checkbox */}
        <div className={`mt-0.5 w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
          done ? 'bg-green-500 border-green-500' : overdue ? 'border-red-400' : 'border-[#cbd5e0]'
        }`}>
          {done && (
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>

        {/* Contenuto */}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold leading-snug ${done ? 'line-through text-[#a0aec0]' : 'text-[#1a202c]'}`}>
            {task.title}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 mt-1 min-w-0">
            {task.assigned?.full_name && (
              <span className="text-[10px] text-[#718096]">
                → {task.assigned.full_name}
              </span>
            )}
            {task.due_date && (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                overdue ? 'bg-red-100 text-red-600' :
                today   ? 'bg-amber-100 text-amber-700' :
                          'bg-[#f0f4f8] text-[#718096]'
              }`}>
                {overdue ? '⚠ Scaduta ' : today ? '⏰ Oggi ' : ''}{fmtDate(task.due_date)}
              </span>
            )}
            {done && task.completed_at && (
              <span className="text-[10px] text-green-600">
                ✓ {task.completer?.full_name ?? 'Operatore'} · {new Date(task.completed_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} alle {new Date(task.completed_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>

        {/* Chevron */}
        <svg className={`w-4 h-4 text-[#a0aec0] shrink-0 mt-0.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dettaglio espanso */}
      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-3 border-t border-[#f0f4f8]">
          {task.description && (
            <p className="text-sm text-[#718096] leading-relaxed pt-3 whitespace-pre-wrap">
              {task.description}
            </p>
          )}
          {task.creator?.full_name && (
            <p className="text-[10px] text-[#a0aec0]">Creata da {task.creator.full_name}</p>
          )}

          {/* Azioni */}
          {done ? (
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleUncomplete}
                disabled={uncompleting}
                className="flex-1 h-9 rounded-xl border border-[#e2e8f0] text-[#718096] text-xs font-semibold
                           active:bg-[#f0f4f8] disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
              >
                {uncompleting ? '…' : 'Riapri task'}
              </button>
            </div>
          ) : (
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleComplete}
                disabled={completing}
                className="flex-1 h-9 rounded-xl bg-green-500 text-white text-xs font-semibold
                           active:bg-green-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
              >
                {completing ? '…' : <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Segna come completata
                </>}
              </button>
              {canManage && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="w-9 h-9 rounded-xl bg-red-50 text-red-400 active:bg-red-100
                             disabled:opacity-50 transition-colors flex items-center justify-center shrink-0"
                >
                  {deleting ? '…' : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  )}
                </button>
              )}
            </div>
          )}
          {canManage && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="h-8 px-3 rounded-xl bg-[#f0f4f8] text-[#718096] text-xs font-semibold
                         active:bg-[#e2e8f0] disabled:opacity-50 transition-colors self-start"
            >
              {deleting ? '…' : 'Elimina'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Form nuova task ──────────────────────────────────────────────────────────

function NewTaskForm({ structureId, profileId, teamMembers, onSaved, onCancel }) {
  const [title,    setTitle]    = useState('')
  const [desc,     setDesc]     = useState('')
  const [assigned, setAssigned] = useState('')
  const [due,      setDue]      = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true); setError('')

    const { error: err } = await supabase.from('tasks').insert({
      structure_id: structureId,
      created_by:   profileId,
      assigned_to:  assigned || null,
      title:        title.trim(),
      description:  desc.trim() || null,
      due_date:     due || null,
      status:       'open',
    })

    if (err) { setError('Errore nella creazione. Riprova.'); setSaving(false); return }

    // Notifica in-app all'operatore assegnato
    if (assigned) {
      await supabase.from('notifications').insert({
        user_id: assigned,
        type:    'task_assigned',
        title:   'Nuova task assegnata',
        body:    title.trim(),
        link:    'tasks',
      })
    }

    setSaving(false)
    onSaved()
  }

  const inputCls = `w-full h-11 px-4 rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c] text-base
    outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 transition-colors
    placeholder:text-[#a0aec0]`

  return (
    <form onSubmit={handleSubmit}
      className="bg-[#f8f9fa] rounded-2xl border border-[#e2e8f0] p-4 flex flex-col gap-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#a0aec0]">Nuova task</p>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-[#718096]">Titolo *</label>
        <input
          type="text"
          required
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Es. Compilare registro presenze"
          className={inputCls}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-[#718096]">Istruzioni (opzionale)</label>
        <textarea
          value={desc}
          onChange={e => setDesc(e.target.value)}
          placeholder="Descrivi cosa deve fare l'operatore…"
          rows={3}
          className={`${inputCls} h-auto py-3 resize-none`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <label className="text-xs font-semibold text-[#718096]">Assegna a</label>
          <select
            value={assigned}
            onChange={e => setAssigned(e.target.value)}
            className={`${inputCls} pr-8`}
          >
            <option value="">— Nessuno —</option>
            {teamMembers.map(m => (
              <option key={m.id} value={m.id}>{m.full_name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 min-w-0 overflow-hidden rounded-xl">
          <label className="text-xs font-semibold text-[#718096]">Scadenza</label>
          <input
            type="date"
            value={due}
            onChange={e => setDue(e.target.value)}
            min={new Date().toISOString().slice(0, 10)}
            className={`${inputCls} w-full`}
            style={{ minWidth: 0, maxWidth: '100%' }}
          />
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
          {saving ? 'Salvataggio…' : 'Crea task'}
        </button>
      </div>
    </form>
  )
}

// ─── Componente principale ────────────────────────────────────────────────────

export default function TasksPanel({ structureId, profile, onTaskCompleted }) {
  const canManage = profile?.role === 'manager' || profile?.role === 'admin_secondary'

  const [tasks,       setTasks]       = useState([])
  const [loading,     setLoading]     = useState(true)
  const [teamMembers, setTeamMembers] = useState([])
  const [showForm,    setShowForm]    = useState(false)
  const [showDone,    setShowDone]    = useState(false)
  const [section,     setSection]     = useState('weekly')

  const cleanup = useCallback(async () => {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    await supabase
      .from('tasks')
      .delete()
      .eq('structure_id', structureId)
      .eq('status', 'done')
      .lt('completed_at', cutoff)
  }, [structureId])

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('tasks')
      .select('id, title, description, due_date, status, completed_at, completed_by, created_at, created_by, assigned_to, assigned:profiles!assigned_to(full_name), creator:profiles!created_by(full_name), completer:profiles!completed_by(full_name)')
      .eq('structure_id', structureId)
      .order('status', { ascending: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
    setTasks(data ?? [])
    setLoading(false)
  }, [structureId, canManage, profile?.id])

  useEffect(() => {
    if (!structureId) return
    if (canManage) cleanup()   // solo manager/coord eliminano, evita conflitti RLS
    load()
    if (canManage) loadTeam()
  }, [structureId, load, cleanup, canManage])

  async function loadTeam() {
    const { data } = await supabase
      .rpc('get_team_members', { p_structure_id: structureId })
    setTeamMembers((data ?? []).filter(m => m.role === 'operator' || m.role === 'admin_secondary'))
  }

  async function handleComplete(task) {
    await supabase
      .from('tasks')
      .update({ status: 'done', completed_at: new Date().toISOString(), completed_by: profile.id })
      .eq('id', task.id)

    if (task.created_by && task.created_by !== profile.id) {
      await supabase.from('notifications').insert({
        user_id: task.created_by,
        type:    'task_completed',
        title:   'Task completata',
        body:    task.title,
        link:    'tasks',
      })
    }
    load()
    onTaskCompleted?.()
  }

  async function handleUncomplete(task) {
    await supabase
      .from('tasks')
      .update({ status: 'todo', completed_at: null, completed_by: null })
      .eq('id', task.id)
    load()
  }

  async function handleDelete(taskId) {
    const task = tasks.find(t => t.id === taskId)
    await supabase.from('tasks').delete().eq('id', taskId)

    if (task) {
      const notifs = []
      if (task.assigned_to && task.assigned_to !== profile.id) {
        notifs.push({
          user_id: task.assigned_to,
          type:    'task_deleted',
          title:   'Task eliminata',
          body:    task.title,
          link:    'tasks',
        })
      }
      if (task.created_by && task.created_by !== profile.id && task.created_by !== task.assigned_to) {
        notifs.push({
          user_id: task.created_by,
          type:    'task_deleted',
          title:   'Task eliminata',
          body:    task.title,
          link:    'tasks',
        })
      }
      if (notifs.length > 0) await supabase.from('notifications').insert(notifs)
    }

    load()
  }

  const openTasks = tasks.filter(t => t.status === 'open')
  const doneTasks = tasks.filter(t => t.status === 'done')
  const overdueCt = openTasks.filter(isOverdue).length

  return (
    <div className="flex flex-col gap-4">

      {/* Tab switcher Mansioni / Straordinarie */}
      <div className="flex bg-[#f0f4f8] rounded-2xl p-1 gap-1">
        <button type="button" onClick={() => setSection('weekly')}
          className={`flex-1 h-9 rounded-xl text-xs font-semibold transition-colors
            ${section === 'weekly' ? 'bg-white text-[#1e3a5f] shadow-sm' : 'text-[#718096] active:bg-white/50'}`}>
          Mansioni
        </button>
        <button type="button" onClick={() => setSection('extra')}
          className={`flex-1 h-9 rounded-xl text-xs font-semibold transition-colors relative
            ${section === 'extra' ? 'bg-white text-[#1e3a5f] shadow-sm' : 'text-[#718096] active:bg-white/50'}`}>
          Straordinarie
          {overdueCt > 0 && section !== 'extra' && (
            <span className="absolute top-1.5 right-4 w-2 h-2 rounded-full bg-red-500" />
          )}
        </button>
      </div>

      {section === 'weekly' && (
        <WeeklyTasksPanel structureId={structureId} profile={profile} />
      )}
      {section === 'extra' && <>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-[#1a202c]">
            {canManage ? 'Bacheca task' : 'Le mie task'}
          </h2>
          {openTasks.length > 0 && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
              overdueCt > 0 ? 'bg-red-100 text-red-600' : 'bg-[#eef2f7] text-[#1e3a5f]'
            }`}>
              {openTasks.length} aperte{overdueCt > 0 ? ` · ${overdueCt} scadute` : ''}
            </span>
          )}
        </div>
        {canManage && !showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-[#1e3a5f] text-white
                       text-xs font-semibold active:bg-[#152b47] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Nuova task
          </button>
        )}
      </div>

      {/* Form creazione */}
      {showForm && (
        <NewTaskForm
          structureId={structureId}
          profileId={profile.id}
          teamMembers={teamMembers}
          onSaved={() => { setShowForm(false); load() }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Lista */}
      {loading ? (
        <div className="flex flex-col gap-2 animate-pulse">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 rounded-2xl bg-[#e2e8f0]" />
          ))}
        </div>
      ) : openTasks.length === 0 && doneTasks.length === 0 ? (
        <div className="rounded-2xl bg-white border border-[#e2e8f0] px-6 py-10 text-center">
          <p className="text-3xl mb-3">✅</p>
          <p className="text-sm font-semibold text-[#1a202c]">Nessuna task</p>
          <p className="text-xs text-[#a0aec0] mt-1">
            {canManage ? 'Crea la prima task per il tuo team.' : 'Non hai task assegnate.'}
          </p>
        </div>
      ) : (
        <>
          {/* Task aperte */}
          {openTasks.length > 0 && (
            <div className="flex flex-col gap-2">
              {openTasks.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  canManage={canManage}
                  onComplete={handleComplete}
                  onUncomplete={handleUncomplete}
                  onDelete={handleDelete}
                  currentUserId={profile.id}
                />
              ))}
            </div>
          )}

          {/* Storico task completate (visibile a tutti) */}
          {doneTasks.length > 0 && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setShowDone(v => !v)}
                className="flex items-center gap-2 text-xs font-semibold text-[#a0aec0] active:text-[#718096] transition-colors"
              >
                <svg className={`w-3.5 h-3.5 transition-transform ${showDone ? 'rotate-180' : ''}`}
                  fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
                Storico ultimi 30 giorni ({doneTasks.length})
              </button>
              {showDone && (
                <>
                  <p className="text-[10px] text-[#a0aec0] -mt-1">
                    Le task completate vengono eliminate automaticamente dopo 30 giorni.
                  </p>
                  {doneTasks.map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      canManage={canManage}
                      onComplete={handleComplete}
                      onDelete={handleDelete}
                      currentUserId={profile.id}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </>
      )}
      </>}
    </div>
  )
}

// ─── Export helper per contare task aperte (usato per badge) ──────────────────

export async function fetchOpenTasksCount(structureId, userId, isManager) {
  let q = supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('structure_id', structureId)
    .eq('status', 'open')
  if (!isManager) q = q.eq('assigned_to', userId)
  const { count } = await q
  return count ?? 0
}
