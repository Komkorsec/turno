import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from '../lib/supabase'
import { generateWeeklySchedule } from '../utils/generateWeeklySchedule'
import { generateMonthlySchedule } from '../utils/generateMonthlySchedule'
import { getMonthBounds, extractSundayWorkedIds as _extractSundayWorkedIds, computeMonthHoursFromSchedules } from '../utils/scheduleHelpers'
import { playAudio } from '../utils/audio'

// ─── Costanti ─────────────────────────────────────────────────────────────────

const WEEK_DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica']

const ABSENCE_STATUS_CFG = {
  pending:  { label: 'In attesa', bg: '#fef3c7', text: '#92400e' },
  approved: { label: 'Approvata', bg: '#d1fae5', text: '#065f46' },
  rejected: { label: 'Rifiutata', bg: '#fee2e2', text: '#991b1b' },
}

const FIXED_SHIFTS = [
  { type: 'mattina',    label: 'Mattina',    hours: '08–14', icon: '🌅' },
  { type: 'pomeriggio', label: 'Pomeriggio', hours: '14–20', icon: '☀️'  },
  { type: 'notte',      label: 'Notte',      hours: '20–08', icon: '🌙' },
]

const ROLE_IT = {
  operator:        'Operatore',
  admin_secondary: 'Coordinatore',
  coordinator:     'Coordinatore',
  manager:         'Manager',
}

// ─── Calcolo durata turno ─────────────────────────────────────────────────────
// Converte 'HH' o 'HH:MM' in ore decimali
function _toH(s) {
  const [h, m = '0'] = String(s).split(':')
  return parseInt(h, 10) + parseInt(m, 10) / 60
}
// Restituisce la durata in ore; gestisce il wraparound a mezzanotte
function getDuration(startHHMM, endHHMM) {
  const diff = _toH(endHHMM) - _toH(startHHMM)
  return diff <= 0 ? diff + 24 : diff
}
// Formatta ore: interi senza decimali, decimali con 1dp
function fmtH(h) { return Number.isInteger(h) ? String(h) : h.toFixed(1) }

// Mappa shift_type → durata ore, calcolata dai FIXED_SHIFTS (evita valori hardcoded)
// es. '08–14' → 6h, '20–08' → 12h
const SHIFT_DURATION = (() => {
  const map = {}
  for (const s of FIXED_SHIFTS) {
    const parts = s.hours.split('–')   // en-dash
    if (parts.length === 2) {
      map[s.type] = getDuration(parts[0].trim(), parts[1].trim())
    }
  }
  return map
})()

const OP_PALETTE = [
  ['#dbeafe', '#1d4ed8'],
  ['#d1fae5', '#065f46'],
  ['#fce7f3', '#9d174d'],
  ['#fef3c7', '#92400e'],
  ['#ede9fe', '#5b21b6'],
  ['#fee2e2', '#991b1b'],
  ['#cffafe', '#164e63'],
  ['#f3f4f6', '#374151'],
]

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
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}
function isToday(date) { return toISO(date) === toISO(new Date()) }
function fmtAbsDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtWeekRange(weekStart) {
  const end = addDays(weekStart, 6)
  return (
    weekStart.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }) +
    ' – ' +
    end.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
  )
}

// ─── Label / parsing evento speciale ──────────────────────────────────────────
// Formato stored: "Titolo · HH:MM–HH:MM"

function buildSpecialLabel(title, start, end) {
  return `${title} · ${start}–${end}`
}

function parseSpecialLabel(label = '') {
  const [title, timeRange] = label.split(' · ')
  if (!timeRange) return { title: label, timeRange: '' }
  const [s, e] = timeRange.split('–')
  return { title, timeRange: e ? `${s} – ${e}` : s }
}



// ─── Chip operatore ────────────────────────────────────────────────────────────

function LockIcon({ locked }) {
  return locked ? (
    <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
    </svg>
  ) : (
    <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
      <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z"/>
    </svg>
  )
}

function OperatorChip({ name, colorIdx, onRemove, isLocked, onToggleLock, canWrite }) {
  const [bg, text] = OP_PALETTE[colorIdx % OP_PALETTE.length]
  const chipStyle  = isLocked
    ? { backgroundColor: '#fef3c7', color: '#92400e' }
    : { backgroundColor: bg, color: text }

  return (
    <span
      className={`flex items-center gap-1 w-full rounded-lg px-2 py-1 text-xs font-medium
                  ${isLocked ? 'ring-1 ring-inset ring-amber-300' : ''}`}
      style={chipStyle}>
      {isLocked && <LockIcon locked />}
      <span className="truncate min-w-0 flex-1">{name}</span>
      {canWrite && (
        <span className="shrink-0 flex items-center gap-0.5">
          {/* Tasto lucchetto */}
          <button type="button" title={isLocked ? 'Sblocca turno' : 'Blocca turno'}
            onClick={e => { e.stopPropagation(); onToggleLock?.() }}
            className={`w-4 h-4 flex items-center justify-center rounded-full transition-colors
              ${isLocked
                ? 'text-amber-600 hover:bg-amber-200'
                : 'opacity-30 hover:opacity-80 hover:bg-black/10'}`}>
            <LockIcon locked={isLocked} />
          </button>
          {/* Rimozione (solo se non bloccato) */}
          {!isLocked && onRemove && (
            <button type="button" onClick={e => { e.stopPropagation(); onRemove() }}
              className="w-4 h-4 flex items-center justify-center rounded-full
                         hover:bg-black/10 transition-colors text-[11px] leading-none">
              ×
            </button>
          )}
        </span>
      )}
      {/* Read-only */}
      {!canWrite && onRemove && (
        <button type="button" onClick={e => { e.stopPropagation(); onRemove() }}
          className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full
                     hover:bg-black/10 transition-colors text-[11px] leading-none">
          ×
        </button>
      )}
    </span>
  )
}

// ─── Card appuntamento residente (read-only) ──────────────────────────────────

function AppointmentCard({ appt, onClick }) {
  const start = new Date(appt.start_datetime)
    .toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  const end = appt.end_datetime
    ? new Date(appt.end_datetime).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    : null
  return (
    <div onClick={onClick} className="flex items-start gap-1.5 w-full rounded-lg
                    bg-indigo-50 border border-indigo-200 border-l-[3px] border-l-indigo-400
                    px-2 py-1.5 cursor-pointer active:opacity-70">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-indigo-700 leading-tight truncate">
          📅 {appt.title}
          {start ? ` | ${start}${end ? `–${end}` : ''}` : ''}
        </p>
        <p className="text-[10px] text-indigo-400 leading-tight mt-0.5 truncate">
          {appt.residentName}
          {appt.location ? ` · ${appt.location}` : ''}
          {appt.operator?.full_name ? ` · ${appt.operator.full_name}` : ''}
        </p>
      </div>
    </div>
  )
}

// ─── Modal dettaglio evento ───────────────────────────────────────────────────

function EventDetailModal({ event, onClose, onDelete, onEdit }) {
  const rows = [
    event.timeRange   && { label: 'Orario',    value: event.timeRange },
    event.operator    && { label: 'Operatore', value: event.operator },
    event.residents   && { label: 'Residenti', value: event.residents },
    event.location    && { label: 'Luogo',     value: event.location },
  ].filter(Boolean)

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-bold text-[#1a202c] text-base leading-snug">
            {event.icon} {event.title}
          </h3>
          <button type="button" onClick={onClose}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-xl
                       bg-[#f0f4f8] text-[#718096] text-lg leading-none">
            ×
          </button>
        </div>
        {rows.map(({ label, value }) => (
          <div key={label}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#a0aec0] mb-0.5">
              {label}
            </p>
            <p className="text-sm text-[#2d3748]">{value}</p>
          </div>
        ))}
        {(onEdit || onDelete) && (
          <div className="flex gap-2 pt-1 border-t border-[#e2e8f0]">
            {onEdit && (
              <button type="button" onClick={onEdit}
                className="flex-1 h-9 rounded-xl bg-[#f0f4f8] text-[#1e3a5f] text-sm font-semibold
                           hover:bg-[#e2e8f0] transition-colors">
                Modifica
              </button>
            )}
            {onDelete && (
              <button type="button" onClick={onDelete}
                className="flex-1 h-9 rounded-xl bg-red-50 text-red-600 text-sm font-semibold
                           hover:bg-red-100 transition-colors">
                Elimina
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

// ─── Card evento speciale (slim) ──────────────────────────────────────────────

function SpecialEventCard({ row, onRemove, onClick }) {
  const { title, timeRange } = parseSpecialLabel(row.label)
  return (
    <div onClick={onClick} className="flex items-center justify-between gap-1.5 w-full rounded-lg
                    bg-orange-50 border border-orange-200 border-l-[3px] border-l-orange-400
                    px-2 py-1.5 cursor-pointer active:opacity-70">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-orange-700 leading-tight truncate">
          ⭐ {title}{timeRange ? ` | ${timeRange}` : ''}
        </p>
        {row.full_name && <p className="text-[10px] text-orange-400 leading-tight mt-0.5 truncate">{row.full_name}</p>}
      </div>
      {onRemove && (
        <button type="button" onClick={e => { e.stopPropagation(); onRemove(row.id) }}
          className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full
                     text-orange-400 hover:bg-orange-100 text-[11px] leading-none">
          ×
        </button>
      )}
    </div>
  )
}

// ─── Sezione Agenda ed Eventi ─────────────────────────────────────────────────

function AgendaSection({ specials, appointments = [], onRemove, onEditSpecial, compact }) {
  const [detail, setDetail] = useState(null) // { type: 'special'|'appt', data }
  const total = specials.length + appointments.length

  function openSpecialDetail(row) {
    const { title, timeRange } = parseSpecialLabel(row.label)
    setDetail({
      type: 'special',
      data: row,
      event: { icon: '⭐', title, timeRange: timeRange || null, operator: row.full_name || null },
    })
  }

  function openApptDetail(appt) {
    const start = new Date(appt.start_datetime).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    const end = appt.end_datetime
      ? new Date(appt.end_datetime).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
      : null
    setDetail({
      type: 'appt',
      data: appt,
      event: {
        icon: '📅',
        title: appt.title,
        timeRange: end ? `${start} – ${end}` : start,
        operator: appt.operator?.full_name || null,
        residents: appt.residentName || null,
        location: appt.location || null,
      },
    })
  }

  return (
    <>
      <div className={`rounded-xl border border-dashed border-orange-200 bg-[#fffbf7]
                       ${compact ? 'px-2 pt-1 pb-1.5' : 'px-3 pt-2 pb-2.5'}`}>
        <p className="text-[9px] font-bold uppercase tracking-wide text-orange-400 leading-none mb-1.5">
          Agenda ed eventi
        </p>
        {total === 0 ? (
          <p className="text-[10px] text-[#cbd5e0] italic">Nessun evento</p>
        ) : (
          <div className="flex flex-col gap-1">
            {specials.map(row => (
              <SpecialEventCard key={row.id} row={row} onRemove={onRemove} onClick={() => openSpecialDetail(row)} />
            ))}
            {appointments.map(appt => (
              <AppointmentCard key={`appt-${appt.id}`} appt={appt} onClick={() => openApptDetail(appt)} />
            ))}
          </div>
        )}
      </div>
      {detail && (
        <EventDetailModal
          event={detail.event}
          onClose={() => setDetail(null)}
          onDelete={() => { detail.type === 'special' ? onRemove?.(detail.data.id) : null; setDetail(null) }}
          onEdit={detail.type === 'special' ? () => { onEditSpecial?.(detail.data); setDetail(null) } : null}
        />
      )}
    </>
  )
}

// ─── Picker operatori ──────────────────────────────────────────────────────────

function OperatorPicker({ anchorRef, assignedIds, sameDayIds = [], operators, colorMap,
                          onSelect, onClose, weeklyHoursMap = {},
                          dateISO = '', shiftType = '', checkAvailability = null,
                          weekendPrioritySet = new Set(), otherWeekendIds = new Set() }) {
  const menuRef   = useRef(null)
  const [pos, setPos]               = useState({ top: 0, left: 0, width: 0 })
  const [pendingUid,           setPending]           = useState(null)
  const [pendingReason,        setPendingReason]      = useState(null) // 'hours'|'collision'|'weekend'  (not 'absence' — hard block)
  const [pendingStructureName, setPendingStructureName] = useState(null)
  // Assenze approvate per la data specifica: query fresca al mount del picker
  const [leaveSet, setLeaveSet] = useState(new Set())

  useEffect(() => {
    if (!dateISO || !operators.length) return
    const ids = operators.map(o => o.id)
    supabase.rpc('get_approved_absences', { p_user_ids: ids })
      .then(({ data }) => {
        const set = new Set((data ?? [])
          .filter(a =>
            a.start_date <= dateISO && a.end_date >= dateISO &&
            (a.is_full_day !== false ||
             a.slot_type === 'giorno_intero' ||
             a.slot_type === shiftType ||
             a.slot_type === 'personalizzata')
          )
          .map(a => a.user_id))
        setLeaveSet(set)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // una sola volta al mount — dateISO, shiftType, operators sono stabili durante la vita del picker

  useEffect(() => {
    if (anchorRef?.current) {
      const r = anchorRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + window.scrollY + 4, left: r.left + window.scrollX, width: Math.max(r.width, 240) })
    }
  }, [anchorRef])

  useEffect(() => {
    function h(e) {
      if (
        menuRef.current && !menuRef.current.contains(e.target) &&
        anchorRef?.current && !anchorRef.current.contains(e.target)
      ) onClose()
    }
    document.addEventListener('mousedown', h)
    document.addEventListener('touchstart', h)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('touchstart', h) }
  }, [onClose, anchorRef])

  const pendingOp = pendingUid ? operators.find(o => o.id === pendingUid) : null
  // Sabato (dow=6) e Domenica (dow=0)
  const isWeekendSlot = dateISO
    ? [0, 6].includes(new Date(dateISO + 'T12:00:00').getDay())
    : false

  return createPortal(
    <div ref={menuRef}
      style={{ position: 'absolute', top: pos.top, left: pos.left, minWidth: pos.width, zIndex: 9999 }}
      className="bg-white rounded-xl shadow-xl border border-[#e2e8f0] overflow-hidden">

      {/* ── Hard block: collisione cross-struttura ── */}
      {pendingOp && pendingReason === 'collision' && (
        <div className="px-3 py-3 border-b bg-red-50 border-red-200">
          <p className="text-xs font-semibold leading-snug mb-1 text-red-800">
            🚫 Operazione non consentita
          </p>
          <p className="text-[11px] mb-2.5 text-red-700 leading-relaxed">
            <strong>{pendingOp.full_name}</strong> ha già un turno attivo
            {pendingStructureName ? <> in <strong>{pendingStructureName}</strong></> : ' in un\'altra struttura'}
            {' '}per questa fascia oraria. L&apos;assegnazione è bloccata.
          </p>
          <button type="button"
            onClick={() => { setPending(null); setPendingReason(null); setPendingStructureName(null) }}
            className="w-full text-xs font-semibold py-1.5 rounded-lg border border-red-300
                       bg-white hover:bg-red-50 text-red-700 transition-colors">
            Chiudi
          </button>
        </div>
      )}

      {/* ── Conferma superamento limite / avviso riposo ── */}
      {pendingOp && pendingReason !== 'collision' && (() => {
        const usedH = weeklyHoursMap[pendingOp.id] ?? 0
        const maxH  = pendingOp.max_hours_per_week ?? 0
        return (
        <div className={`px-3 py-3 border-b ${pendingReason === 'weekend' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
          <p className={`text-xs font-semibold leading-snug mb-1 ${pendingReason === 'weekend' ? 'text-red-800' : 'text-amber-800'}`}>
            ⚠ {pendingOp.full_name}
          </p>
          <p className={`text-[11px] mb-2.5 ${pendingReason === 'weekend' ? 'text-red-700' : 'text-amber-700'}`}>
            {pendingReason === 'weekend' &&
              'Attenzione: l\'operatore deve rispettare il riposo del weekend (ha lavorato il weekend scorso).'}
            {pendingReason === 'hours' && isWeekendSlot && weekendPrioritySet.has(pendingOp.id) && <>
              <strong>In Rotazione Weekend:</strong> {pendingOp.full_name} è in turno questo weekend
              ma ha raggiunto il limite ore (<strong>{fmtH(usedH)}/{fmtH(maxH)}h</strong>).
              <br />Per rispettare la rotazione, libera un turno feriale — oppure assegna comunque.
            </>}
            {pendingReason === 'hours' && !(isWeekendSlot && weekendPrioritySet.has(pendingOp.id)) && <>
              <strong>Limite Ore Superato:</strong> ore assegnate <strong>{fmtH(usedH)}</strong> / limite <strong>{fmtH(maxH)}h</strong>.
              <br />Vuoi procedere comunque?
            </>}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setPending(null); setPendingReason(null); setPendingStructureName(null) }}
              className="flex-1 text-xs font-semibold py-1.5 rounded-lg border border-[#e2e8f0]
                         bg-white hover:bg-[#f8f9fa] text-[#718096] transition-colors">
              Annulla
            </button>
            <button type="button" onClick={() => { onSelect(pendingUid); onClose() }}
              className={`flex-1 text-xs font-semibold py-1.5 rounded-lg text-white transition-colors
                ${pendingReason === 'weekend' ? 'bg-red-500 hover:bg-red-600' : 'bg-amber-500 hover:bg-amber-600'}`}>
              Assegna comunque
            </button>
          </div>
        </div>
        )
      })()}

      {/* ── Lista operatori ── */}
      {!pendingOp && (
        operators.length === 0
          ? <p className="px-3 py-3 text-xs text-[#a0aec0] italic">Nessun operatore disponibile</p>
          : (
            <div className="max-h-64 overflow-y-auto">
              {operators.map(op => {
                const inSlot    = assignedIds.includes(op.id)
                const inDay     = !inSlot && sameDayIds.includes(op.id)
                const used      = weeklyHoursMap[op.id] ?? 0
                const max       = op.max_hours_per_week ?? 0
                const overLimit = max > 0 && used >= max
                const nearLimit = max > 0 && !overLimit && used >= max * 0.75
                const avail     = !inSlot && checkAvailability
                  ? checkAvailability(op.id, dateISO, shiftType)
                  : { available: true }
                const isOnLeave      = leaveSet.has(op.id)
                const isCollision    = !avail.available && avail.reason === 'collision'  // hard block cross-struttura
                const unavailable    = !avail.available && avail.reason !== 'absence' && !isOnLeave
                const inRotazione    = isWeekendSlot && weekendPrioritySet.has(op.id)
                const weCompleto     = isWeekendSlot && otherWeekendIds.has(op.id)
                const riposoWeekend  = unavailable && avail.reason === 'weekend'
                const hardBlocked    = inSlot || isOnLeave || isCollision  // non selezionabile in nessun caso
                const [bg, text] = OP_PALETTE[(colorMap[op.id] ?? 0) % OP_PALETTE.length]
                return (
                  <button key={op.id} type="button"
                    disabled={hardBlocked}
                    title={
                      isCollision && avail.structureName ? `Impegnato in: ${avail.structureName} — assegnazione bloccata`
                      : isOnLeave ? 'Questo operatore ha un permesso approvato per oggi'
                      : undefined
                    }
                    onClick={() => {
                      if (hardBlocked) return
                      if (unavailable) { setPending(op.id); setPendingReason(avail.reason); setPendingStructureName(avail.structureName ?? null); return }
                      if (overLimit)   { setPending(op.id); setPendingReason('hours'); setPendingStructureName(null); return }
                      onSelect(op.id); onClose()
                    }}
                    className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors
                      ${hardBlocked ? 'opacity-50 cursor-not-allowed bg-gray-50' : 'hover:bg-[#f8f9fa]'}
                      ${inRotazione && !overLimit && !unavailable && !isCollision ? 'bg-teal-50' : ''}`}>
                    <span className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0"
                      style={{ backgroundColor: bg, color: text }}>
                      {op.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate leading-tight
                        ${isOnLeave                        ? 'text-[#a0aec0] line-through'
                        : riposoWeekend                    ? 'text-[#718096]'
                        : unavailable                      ? 'text-red-600'
                        : overLimit                        ? 'text-red-600'
                        : inRotazione                      ? 'text-teal-700'
                        :                                    'text-[#1a202c]'}`}>
                        {op.full_name}
                      </p>
                      {/* Didascalia principale */}
                      <p className={`text-[10px] leading-tight
                        ${isCollision   ? 'text-red-500'
                        : isOnLeave     ? 'text-[#a0aec0]'
                        : riposoWeekend ? 'text-[#a0aec0]'
                        : unavailable   ? 'text-red-400'
                        : overLimit     ? 'text-red-400'
                        : inRotazione   ? 'text-teal-600'
                        : nearLimit     ? 'text-amber-500'
                        :                'text-[#a0aec0]'}`}>
                        {ROLE_IT[op.role] ?? op.role}
                        {max > 0 && ` · ${fmtH(used)}/${fmtH(max)}h`}
                        {inSlot                                      && ' · già in questo turno'}
                        {inDay                                       && ' · già in turno oggi'}
                        {isOnLeave                                   && ' · Non Disponibile · In Ferie'}
                        {!isOnLeave && isCollision                   && ' · 🚫 Occupato in altra sede'}
                        {!isOnLeave && riposoWeekend                 && ' · Riposo Weekend'}
                        {!unavailable && overLimit && inRotazione    && ' · In Rotazione · Limite Ore Superato'}
                        {!unavailable && overLimit && !inRotazione   && ' · Limite Ore Superato'}
                        {!unavailable && !overLimit && inRotazione   && ' · In Rotazione Weekend'}
                        {weCompleto                                  && ' · WE Completo'}
                      </p>
                      {/* Micro-didascalia collisione cross-struttura */}
                      {isCollision && avail.structureName && (
                        <p className="text-[9px] font-semibold text-red-500 leading-tight mt-0.5">
                          Impegnato in {avail.structureName}
                        </p>
                      )}
                    </div>
                    {isCollision
                      ? <span className="shrink-0 text-[9px] font-bold text-red-700 bg-red-100
                                         border border-red-300 rounded px-1 py-0.5 leading-none">🚫</span>
                      : isOnLeave
                        ? <span className="shrink-0 text-[9px] font-bold text-[#718096] bg-[#f0f4f8]
                                           border border-[#e2e8f0] rounded px-1 py-0.5 leading-none">Ferie</span>
                      : riposoWeekend
                        ? <span className="shrink-0 text-[9px] font-bold text-[#718096] bg-[#f0f4f8]
                                           border border-[#e2e8f0] rounded px-1 py-0.5 leading-none">Riposo</span>
                      : unavailable
                        ? <span className="shrink-0 text-[9px] font-bold text-red-600 bg-red-50
                                           border border-red-200 rounded px-1 py-0.5 leading-none">⚠</span>
                      : overLimit
                        ? <span className="shrink-0 text-[9px] font-bold text-red-600 bg-red-50
                                           border border-red-200 rounded px-1 py-0.5 leading-none">⚠</span>
                      : weCompleto
                        ? <span className="shrink-0 text-[9px] font-bold text-orange-600 bg-orange-50
                                           border border-orange-200 rounded px-1 py-0.5 leading-none">WE ●●</span>
                      : inRotazione
                        ? <span className="shrink-0 text-[9px] font-bold text-teal-700 bg-teal-50
                                           border border-teal-200 rounded px-1 py-0.5 leading-none">↻</span>
                      : inDay
                        ? <span className="shrink-0 text-[9px] font-bold text-amber-600 bg-amber-50
                                           border border-amber-200 rounded px-1 py-0.5 leading-none">⚠</span>
                      : null}
                  </button>
                )
              })}
            </div>
          )
      )}
    </div>,
    document.body
  )
}

// ─── Blocco turno standard ────────────────────────────────────────────────────

function ShiftBlock({ shift, rows, operators, colorMap, dateISO, onAdd, onRemove, onToggleLock,
                      saving, compact, canWrite, draftSlot, isDraftDay = false, onDraftChange,
                      sameDayRows = [], onDraftAddExtra, onDraftRemoveExtra, weeklyHoursMap = {},
                      checkAvailability = null, weekendPrioritySet = new Set(),
                      otherWeekendIds = new Set() }) {
  const [pickerOpen,     setPickerOpen]     = useState(false)
  const [draftEditOpen,  setDraftEditOpen]  = useState(false)
  const [draftExtraOpen, setDraftExtraOpen] = useState(false)
  const addBtnRef      = useRef(null)
  const editBtnRef     = useRef(null)
  const draftAddBtnRef = useRef(null)

  const assignedIds = rows.map(r => r.user_id)
  const sameDayIds  = sameDayRows.filter(r => r.shift_type !== shift.type).map(r => r.user_id)
  const allAssigned = operators.length > 0 && assignedIds.length >= operators.length
  const hasLocked   = rows.some(r => r.is_locked)
  const empty       = rows.length === 0

  // IDs già occupati nello slot bozza (AI + extra) → impedisce duplicati nel picker
  const draftAssignedIds = draftSlot
    ? [draftSlot.operatorId, ...(draftSlot.extras ?? []).map(e => e.operatorId)]
    : []

  return (
    <div className={`rounded-xl border bg-white
                     ${hasLocked ? 'border-amber-300' : draftSlot ? 'border-indigo-300 border-dashed' : 'border-[#e2e8f0]'}
                     ${compact ? 'px-2 pt-1 pb-1.5' : 'px-3 pt-2 pb-2.5'}`}>
      {/* Label */}
      <div className="flex items-center gap-1 mb-1.5">
        <span className="text-[11px]">{shift.icon}</span>
        <p className="text-[10px] font-bold text-[#1e3a5f] leading-none">{shift.label}</p>
        <p className="text-[9px] text-[#a0aec0] leading-none ml-1">{shift.hours}</p>
        {hasLocked && <span className="text-[9px] text-amber-600 font-bold ml-auto">🔒</span>}
      </div>
      <div className="flex flex-col gap-1">

        {/* Chips turni pubblicati */}
        {rows.map(row => (
          <OperatorChip key={row.id} name={row.full_name}
            colorIdx={colorMap[row.user_id] ?? 0}
            isLocked={!!row.is_locked}
            canWrite={canWrite && !draftSlot}
            onToggleLock={() => onToggleLock?.(row.id, !!row.is_locked)}
            onRemove={draftSlot || row.is_locked ? undefined : () => onRemove(row.id)} />
        ))}

        {/* + button (modalità non-bozza) — nascosto se il solver ha lasciato lo slot vuoto */}
        {!draftSlot && !allAssigned && !(isDraftDay && rows.length === 0) && (
          <>
            <button ref={addBtnRef} type="button" disabled={saving}
              onClick={() => setPickerOpen(v => !v)}
              className={`flex items-center gap-1 rounded-lg border border-dashed border-[#cbd5e0]
                text-[#a0aec0] text-xs hover:border-[#1e3a5f] hover:text-[#1e3a5f]
                hover:bg-[#f0f4f8] transition-colors disabled:opacity-40
                ${empty ? 'w-full justify-center py-1' : 'px-2 py-0.5'}`}>
              <span>+</span>
              {empty && <span className="text-[10px]">Aggiungi</span>}
            </button>
            {pickerOpen && (
              <OperatorPicker anchorRef={addBtnRef} assignedIds={assignedIds} sameDayIds={sameDayIds}
                operators={operators} colorMap={colorMap} weeklyHoursMap={weeklyHoursMap}
                dateISO={dateISO} shiftType={shift.type} checkAvailability={checkAvailability}
                weekendPrioritySet={weekendPrioritySet}
                otherWeekendIds={otherWeekendIds}
                onSelect={uid => onAdd(dateISO, shift.type, uid)}
                onClose={() => setPickerOpen(false)} />
            )}
          </>
        )}

        {/* Modalità bozza AI */}
        {draftSlot && (
          <>
            {/* Chip principale AI */}
            <div className="flex items-center gap-1 w-full rounded-lg px-2 py-1
                            bg-indigo-50 border border-dashed border-indigo-300 text-indigo-700">
              <span className="shrink-0 text-[8px] font-bold bg-indigo-500 text-white
                               px-1 py-0.5 rounded leading-none">AI</span>
              <span className="flex-1 text-xs font-medium truncate min-w-0">
                {draftSlot.operatorName}
              </span>
              <button ref={editBtnRef} type="button" title="Cambia operatore AI"
                onClick={() => setDraftEditOpen(v => !v)}
                className="shrink-0 text-indigo-400 hover:text-indigo-600 transition-colors">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a4 4 0 01-1.414.94l-3.536.884.884-3.536a4 4 0 01.94-1.414z" />
                </svg>
              </button>
              {draftEditOpen && (
                <OperatorPicker anchorRef={editBtnRef} assignedIds={draftAssignedIds} sameDayIds={sameDayIds}
                  operators={operators} colorMap={colorMap} weeklyHoursMap={weeklyHoursMap}
                  dateISO={dateISO} shiftType={shift.type} checkAvailability={checkAvailability}
                  weekendPrioritySet={weekendPrioritySet}
                  otherWeekendIds={otherWeekendIds}
                  onSelect={uid => { onDraftChange(uid); setDraftEditOpen(false) }}
                  onClose={() => setDraftEditOpen(false)} />
              )}
            </div>

            {/* Chip operatori extra aggiunti manualmente */}
            {(draftSlot.extras ?? []).map(e => {
              const [bg, txtClr] = OP_PALETTE[(colorMap[e.operatorId] ?? 0) % OP_PALETTE.length]
              return (
                <span key={e.operatorId}
                  className="flex items-center gap-1 w-full rounded-lg px-2 py-1 text-xs font-medium"
                  style={{ backgroundColor: bg, color: txtClr }}>
                  <span className="truncate min-w-0 flex-1">{e.operatorName}</span>
                  <button type="button"
                    onClick={() => onDraftRemoveExtra?.(dateISO, shift.type, e.operatorId)}
                    className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full
                               hover:bg-black/10 transition-colors text-[11px] leading-none">
                    ×
                  </button>
                </span>
              )
            })}

            {/* + aggiungi operatore extra in bozza */}
            <>
              <button ref={draftAddBtnRef} type="button"
                onClick={() => setDraftExtraOpen(v => !v)}
                className="flex items-center gap-1 rounded-lg border border-dashed border-indigo-200
                  text-indigo-400 text-xs hover:border-indigo-400 hover:text-indigo-600
                  hover:bg-indigo-50 transition-colors px-2 py-0.5">
                <span>+</span>
                <span className="text-[10px]">Aggiungi operatore</span>
              </button>
              {draftExtraOpen && (
                <OperatorPicker anchorRef={draftAddBtnRef} assignedIds={draftAssignedIds} sameDayIds={sameDayIds}
                  operators={operators} colorMap={colorMap} weeklyHoursMap={weeklyHoursMap}
                  dateISO={dateISO} shiftType={shift.type} checkAvailability={checkAvailability}
                  weekendPrioritySet={weekendPrioritySet}
                  otherWeekendIds={otherWeekendIds}
                  onSelect={uid => { onDraftAddExtra?.(dateISO, shift.type, uid); setDraftExtraOpen(false) }}
                  onClose={() => setDraftExtraOpen(false)} />
              )}
            </>
          </>
        )}

        {/* Slot vuoto nella bozza: il solver non ha trovato un operatore */}
        {!draftSlot && isDraftDay && rows.length === 0 && (
          <div className="flex items-center gap-1.5 w-full rounded-lg px-2 py-1.5
                          bg-red-50 border border-red-300 border-dashed">
            <span className="text-xs">⚠️</span>
            <span className="text-[11px] font-semibold text-red-600 leading-tight">
              Non assegnato
            </span>
            <button ref={editBtnRef} type="button" title="Assegna manualmente"
              onClick={() => setDraftEditOpen(v => !v)}
              className="shrink-0 ml-auto text-red-400 hover:text-red-600 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
            {draftEditOpen && (
              <OperatorPicker anchorRef={editBtnRef} assignedIds={[]} sameDayIds={sameDayIds}
                operators={operators} colorMap={colorMap} weeklyHoursMap={weeklyHoursMap}
                dateISO={dateISO} shiftType={shift.type} checkAvailability={checkAvailability}
                weekendPrioritySet={weekendPrioritySet}
                otherWeekendIds={otherWeekendIds}
                onSelect={uid => { onDraftChange(uid); setDraftEditOpen(false) }}
                onClose={() => setDraftEditOpen(false)} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Colonna giorno (desktop + mobile condivisi) ──────────────────────────────

function DayColumn({ day, scheduleMap, operators, colorMap,
                     onAdd, onRemove, onToggleLock, onAddSpecial, savingSlot, compact, canWrite,
                     draftDay, onDraftChange, onDraftAddExtra, onDraftRemoveExtra, weeklyHoursMap = {},
                     apptMap = {}, checkAvailability = null, weekendPrioritySet = new Set(),
                     otherWeekendDayAssignedIds = null, unassignedDays = new Set(),
                     onEditSpecial }) {
  const dateISO = toISO(day)
  const today   = isToday(day)
  const hasUnassigned = unassignedDays.has(dateISO)
  // Operatori già assegnati all'ALTRO giorno del weekend (per avviso "weekend completo" nel picker)
  const dow = new Date(dateISO + 'T12:00:00').getDay()
  const otherWeekendIds =
    dow === 6 ? (otherWeekendDayAssignedIds?.sun ?? new Set()) :  // Sab → controlla Dom
    dow === 0 ? (otherWeekendDayAssignedIds?.sat ?? new Set()) :  // Dom → controlla Sab
    new Set()
  const specials     = scheduleMap[dateISO]?.speciale ?? []
  const appointments = apptMap[dateISO]  ?? []

  return (
    <div className={`flex flex-col gap-0 rounded-2xl overflow-hidden border-2
      ${hasUnassigned ? 'border-red-400 shadow-md shadow-red-100'
        : today ? 'border-[#1e3a5f] shadow-md'
        : 'border-[#e2e8f0]'}`}>

      {/* Header giorno */}
      <div className={`px-3 py-2 flex items-center justify-between gap-2
        ${hasUnassigned ? 'bg-red-50 border-b border-red-200'
          : today ? 'bg-[#1e3a5f]'
          : 'bg-[#f8f9fa] border-b border-[#e2e8f0]'}`}>
        <div className="flex items-center gap-1.5">
          {hasUnassigned && <span className="text-sm" title="Turni non assegnati">⚠️</span>}
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-wide leading-none
              ${hasUnassigned ? 'text-red-600' : today ? 'text-[#93c5fd]' : 'text-[#718096]'}`}>
              {day.toLocaleDateString('it-IT', { weekday: compact ? 'short' : 'long' }).replace('.', '')}
            </p>
            <p className={`font-black leading-tight mt-0.5
              ${compact ? 'text-sm' : 'text-base'} ${hasUnassigned ? 'text-red-700' : today ? 'text-white' : 'text-[#1a202c]'}`}>
              {day.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}
            </p>
          </div>
        </div>
        <button type="button" onClick={() => onAddSpecial(dateISO)}
          className={`shrink-0 text-[10px] font-semibold px-2 py-1 rounded-lg border transition-colors
            ${today
              ? 'border-white/30 text-[#93c5fd] hover:bg-white/10'
              : 'border-orange-200 text-orange-600 bg-orange-50 hover:bg-orange-100'}`}>
          {compact ? '⭐+' : '+ Aggiungi evento'}
        </button>
      </div>

      {/* Corpo: turni fissi + sezione agenda */}
      <div className="flex flex-col gap-1.5 p-2 bg-white">
        {FIXED_SHIFTS.map(shift => (
          <ShiftBlock key={shift.type}
            shift={shift}
            rows={scheduleMap[dateISO]?.[shift.type] ?? []}
            operators={operators}
            colorMap={colorMap}
            dateISO={dateISO}
            onAdd={onAdd}
            onRemove={onRemove}
            onToggleLock={onToggleLock}
            saving={savingSlot === `${dateISO}|${shift.type}`}
            compact={compact}
            canWrite={canWrite}
            draftSlot={draftDay?.[shift.type]}
            isDraftDay={!!draftDay}
            onDraftChange={uid => onDraftChange(dateISO, shift.type, uid)}
            sameDayRows={Object.values(scheduleMap[dateISO] ?? {}).flat()}
            onDraftAddExtra={onDraftAddExtra}
            onDraftRemoveExtra={onDraftRemoveExtra}
            weeklyHoursMap={weeklyHoursMap}
            checkAvailability={checkAvailability}
            weekendPrioritySet={weekendPrioritySet}
            otherWeekendIds={otherWeekendIds}
          />
        ))}
        <AgendaSection specials={specials} appointments={appointments} onRemove={onRemove}
          onEditSpecial={onEditSpecial} compact={compact} />
      </div>
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function GridSkeleton({ count }) {
  return (
    <div className="flex gap-2 animate-pulse">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex-1 rounded-2xl border border-[#e2e8f0] overflow-hidden min-w-[110px]">
          <div className="h-14 bg-[#e2e8f0]" />
          <div className="p-2 flex flex-col gap-1.5">
            {[1, 2, 3].map(j => <div key={j} className="h-14 rounded-xl bg-[#f0f4f8]" />)}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Modal evento speciale ────────────────────────────────────────────────────

function SpecialEventModal({ operators, defaultDate, onSave, onClose, initialValues }) {
  const [form, setForm] = useState({
    date:      initialValues?.date      ?? defaultDate,
    userId:    initialValues?.userId    ?? '',
    title:     initialValues?.title     ?? '',
    startTime: initialValues?.startTime ?? '',
    endTime:   initialValues?.endTime   ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  function set(k, v) { setForm(p => ({ ...p, [k]: v })) }

  async function handleSave() {
    if (!form.userId)       { setError('Seleziona un operatore.'); return }
    if (!form.title.trim()) { setError('Inserisci il titolo.'); return }
    if (!form.startTime)    { setError("Inserisci l'orario di inizio."); return }
    if (!form.endTime)      { setError("Inserisci l'orario di fine."); return }
    setSaving(true); setError('')
    await onSave({
      date:      form.date,
      userId:    form.userId,
      label:     buildSpecialLabel(form.title.trim(), form.startTime, form.endTime),
      title:     form.title.trim(),
      startTime: form.startTime,
      endTime:   form.endTime,
    })
    setSaving(false)
  }

  const inputCls = `w-full h-11 px-3 rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c] text-sm
    outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 transition-colors`

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-[#1a202c] text-base">
            {initialValues ? '⭐ Modifica evento' : '⭐ Nuovo evento speciale'}
          </h3>
          <button type="button" onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#f0f4f8]
                       text-[#718096] text-lg leading-none">×</button>
        </div>

        <div>
          <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">Data</label>
          <input type="date" value={form.date} onChange={e => set('date', e.target.value)} className={inputCls} />
        </div>

        <div>
          <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">Operatore</label>
          <select value={form.userId} onChange={e => set('userId', e.target.value)}
            className={inputCls + ' appearance-none'}>
            <option value="">Seleziona operatore…</option>
            {operators.map(op => <option key={op.id} value={op.id}>{op.full_name}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">Titolo</label>
          <input type="text" value={form.title} onChange={e => set('title', e.target.value)}
            placeholder="Es. Riunione, Formazione, Uscita…" className={inputCls} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">
              Inizio <span className="text-red-400">*</span>
            </label>
            <input type="time" value={form.startTime} onChange={e => set('startTime', e.target.value)}
              className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#718096] uppercase tracking-wide block mb-1.5">
              Fine <span className="text-red-400">*</span>
            </label>
            <input type="time" value={form.endTime} onChange={e => set('endTime', e.target.value)}
              className={inputCls} />
          </div>
        </div>

        {error && <p className="text-xs text-red-500 -mt-1">{error}</p>}

        <button type="button" disabled={saving} onClick={handleSave}
          className="w-full h-12 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                     active:bg-[#152b47] disabled:opacity-60 transition-colors mt-1">
          {saving ? 'Salvataggio…' : 'Salva evento'}
        </button>
      </div>
    </div>
  )
}

// (GenerateModal rimosso — sostituito da modalità bozza inline)

// ─── Modale Diagnostica Solver ────────────────────────────────────────────────

function SolverDiagModal({ diag, onClose }) {
  const { opsWithoutHours, totalContractHours, requiredHours, opsOnLeaveCount, criticalDays, solverError } = diag
  const missingHours = Math.max(0, requiredHours - totalContractHours)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-t-3xl flex flex-col gap-5
                      max-h-[90vh] overflow-y-auto px-5 pt-5 pb-10 shadow-2xl">

        {/* Handle */}
        <div className="flex justify-center -mt-1 mb-0">
          <div className="w-10 h-1 rounded-full bg-[#e2e8f0]" />
        </div>

        {/* Titolo */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-4">
          <p className="text-base font-bold text-amber-900">⚠️ Impossibile generare il turno</p>
          <p className="text-sm text-amber-700 mt-1 leading-snug">
            L'AI non riesce a trovare una combinazione valida con i dati attuali.
            Ecco un'analisi del problema.
          </p>
          {solverError && (
            <p className="text-xs font-mono text-amber-800 mt-2 bg-amber-100 rounded-lg px-3 py-2 break-all">
              {solverError}
            </p>
          )}
        </div>

        {/* Riepilogo numerico */}
        <div>
          <p className="text-[11px] font-bold text-[#718096] uppercase tracking-wider mb-2.5">
            Riepilogo diagnostico
          </p>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between bg-[#f8f9fa] rounded-xl px-4 py-3">
              <span className="text-sm text-[#718096]">Fabbisogno settimana</span>
              <span className="text-sm font-bold text-[#1a202c]">{requiredHours}h · 21 turni</span>
            </div>
            <div className={`flex items-center justify-between rounded-xl px-4 py-3
              ${totalContractHours < requiredHours ? 'bg-red-50 border border-red-200' : 'bg-[#f8f9fa]'}`}>
              <span className="text-sm text-[#718096]">Ore contratto totali</span>
              <span className={`text-sm font-bold ${totalContractHours < requiredHours ? 'text-red-600' : 'text-[#1a202c]'}`}>
                {totalContractHours}h
              </span>
            </div>
            {opsOnLeaveCount > 0 && (
              <div className="flex items-center justify-between bg-amber-50 rounded-xl px-4 py-3">
                <span className="text-sm text-[#718096]">Operatori in ferie questa settimana</span>
                <span className="text-sm font-bold text-amber-700">{opsOnLeaveCount}</span>
              </div>
            )}
            {criticalDays.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <p className="text-xs font-bold text-red-700 mb-0.5">Giorni critici (meno di 3 operatori disponibili)</p>
                <p className="text-xs text-red-600">{criticalDays.join(', ')}</p>
              </div>
            )}
            {missingHours > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <p className="text-sm font-bold text-red-700">
                  Mancano circa {missingHours}h per coprire tutti i turni.
                </p>
                <p className="text-xs text-red-600 mt-1">
                  Hai troppi operatori in ferie o contratti troppo bassi.
                </p>
              </div>
            )}
            {opsWithoutHours.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
                <p className="text-xs font-bold text-orange-800 mb-1.5">
                  Operatori senza ore contratto ({opsWithoutHours.length})
                </p>
                {opsWithoutHours.map(op => (
                  <p key={op.id} className="text-xs text-orange-700 leading-relaxed">· {op.full_name}</p>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Suggerimenti */}
        <div>
          <p className="text-[11px] font-bold text-[#718096] uppercase tracking-wider mb-2.5">
            Cosa puoi fare
          </p>
          <div className="flex flex-col gap-2">
            {[
              { icon: '👤', text: 'Controlla se ci sono operatori con 0 ore impostate nel Team.' },
              { icon: '🏖️', text: 'Riduci o sposta le ferie approvate per questa settimana.' },
              { icon: '📈', text: 'Aumenta temporaneamente il limite ore di un collaboratore.' },
              ...(criticalDays.length > 0
                ? [{ icon: '➕', text: 'Aggiungere un operatore extra per i giorni critici indicati.' }]
                : []),
            ].map((s, i) => (
              <div key={i} className="flex items-start gap-3 bg-[#f0f4f8] rounded-xl px-4 py-3">
                <span className="text-lg leading-none shrink-0 mt-0.5">{s.icon}</span>
                <p className="text-sm text-[#1a202c] leading-snug">{s.text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <button
          type="button"
          onClick={onClose}
          className="w-full py-4 rounded-2xl bg-[#1e3a5f] text-white font-bold text-base
                     active:bg-[#152b47] transition-colors"
        >
          Ho capito, vado a correggere
        </button>
      </div>
    </div>
  )
}

// ─── Modale Imposta Vincoli ───────────────────────────────────────────────────

const fieldCls = `w-full h-10 px-3 rounded-xl border border-[#e2e8f0] bg-white text-sm
  text-[#1a202c] outline-none focus:border-[#1e3a5f] appearance-none transition-colors`

function AddRecurringRowV({ onAdd }) {
  const [day,   setDay]   = useState(WEEK_DAYS[0])
  const [shift, setShift] = useState('mattina')
  const selCls = `flex-1 h-8 px-2 rounded-lg border border-[#e2e8f0] bg-white
    text-[11px] outline-none focus:border-[#1e3a5f] appearance-none`
  return (
    <div className="flex items-center gap-2">
      <select value={day} onChange={e => setDay(e.target.value)} className={selCls}>
        {WEEK_DAYS.map(d => <option key={d} value={d}>{d}</option>)}
      </select>
      <select value={shift} onChange={e => setShift(e.target.value)} className={selCls}>
        <option value="mattina">Mattina</option>
        <option value="pomeriggio">Pomeriggio</option>
        <option value="notte">Notte</option>
      </select>
      <button type="button" onClick={() => onAdd({ day, shift })}
        className="shrink-0 h-8 px-3 rounded-lg bg-[#1e3a5f] text-white text-[11px] font-semibold
                   active:bg-[#152b47] transition-colors whitespace-nowrap">
        + Aggiungi
      </button>
    </div>
  )
}

function VincoliModal({ operators, structureId, approvedAbsences = [], onSaved, onClose }) {
  const [tab,             setTab]             = useState('vincoli')
  const [constraints,     setConstraints]     = useState({})
  const [initialConstraints, setInitialConstraints] = useState({})
  const [saving,          setSaving]          = useState(false)
  const [saved,           setSaved]           = useState(false)
  const [error,           setError]           = useState('')
  const [showExitConfirm, setShowExitConfirm] = useState(false)

  function isDirty() {
    return JSON.stringify(constraints) !== JSON.stringify(initialConstraints)
  }

  function handleClose() {
    if (tab === 'vincoli' && isDirty()) {
      setShowExitConfirm(true)
    } else {
      onClose()
    }
  }

  // Inizializza i constraint una sola volta all'apertura del modal.
  // NON dipende da [operators] per evitare il reset quando il parent
  // chiama setOperators() dopo il salvataggio.
  // operators è già caricato quando il modal viene aperto (showVincoli=true
  // avviene solo dopo fetchOperators completato), quindi [] è sicuro.
  useEffect(() => {
    if (!operators.length) return
    const ids = operators.map(o => o.id)
    const map = {}
    for (const op of operators) {
      map[op.id] = {
        max_hours_per_week: op.max_hours_per_week?.toString() ?? '',
        weekly_rest_day:    op.weekly_rest_day    ?? '',
        shift_preference:   op.shift_preference   ?? '',
        shift_avoid:        op.shift_avoid        ?? '',
        recurring_shifts:   op.recurring_shifts   ?? [],
      }
    }
    setConstraints(map)
    setInitialConstraints(JSON.parse(JSON.stringify(map)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])  // [] = solo al mount — operators è stabile all'apertura del modal

  function setCon(uid, field, val) {
    setConstraints(p => ({ ...p, [uid]: { ...p[uid], [field]: val } }))
  }

  async function saveConstraints() {
    setSaving(true); setError(''); setSaved(false)
    const entries = Object.entries(constraints)
    if (!entries.length) {
      setError('Nessun operatore caricato — riapri il pannello.'); setSaving(false); return
    }

    // Salva sempre via RPC SECURITY DEFINER — bypassa RLS, nessuna ambiguità
    // La vecchia strategia (update diretto → fallback RPC) causava persistenza
    // inconsistente: il direct update poteva "riuscire" (RLS permissiva) ma
    // scrivere su structure_id errato; onSaved riceveva i valori del form (non
    // dal DB), quindi al prossimo fetchOperators i vecchi valori tornavano.
    for (const [uid, vals] of entries) {
      const maxHours = vals.max_hours_per_week ? parseInt(vals.max_hours_per_week, 10) : null
      const { error: rpcErr } = await supabase.rpc('save_operator_constraints', {
        p_user_id:          uid,
        p_structure_id:     structureId,
        p_max_hours:        maxHours,
        p_rest_day:         vals.weekly_rest_day  || null,
        p_shift_preference: vals.shift_preference || null,
        p_shift_avoid:      vals.shift_avoid      || null,
        p_recurring_shifts: vals.recurring_shifts ?? [],
      })
      if (rpcErr) {
        console.error('[VincoliModal] save_operator_constraints errore per', uid, rpcErr)
        setError('Errore nel salvataggio: ' + rpcErr.message)
        setSaving(false); return
      }
      console.log('[VincoliModal] salvato OK per', uid, '→ max_hours:', maxHours)
    }

    setSaving(false); setSaved(true)
    setInitialConstraints(JSON.parse(JSON.stringify(constraints)))
    setTimeout(() => setSaved(false), 2000)

    // Passa la mappa dei constraint al parent per l'aggiornamento in-memory.
    // NON usiamo un re-fetch dal DB: il useEffect del modal è su [] (solo mount),
    // quindi non si resetta, ma il parent deve comunque aggiornare operators
    // così la sidebar e il solver vedono i nuovi valori senza aspettare il
    // prossimo fetchOperators.
    onSaved?.(constraints)
  }

  const opName = uid => operators.find(o => o.id === uid)?.full_name ?? '—'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
      <div className="relative w-full max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl
                      flex flex-col max-h-[92vh]">

        {/* Dialog conferma uscita con modifiche non salvate */}
        {showExitConfirm && (
          <div className="absolute inset-0 z-10 bg-white/90 backdrop-blur-sm rounded-t-3xl sm:rounded-2xl
                          flex flex-col items-center justify-center px-6 gap-5">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200
                            flex items-center justify-center text-3xl shrink-0">
              ⚠️
            </div>
            <div className="text-center">
              <p className="font-bold text-[#1a202c] text-base leading-snug">
                Modifiche non salvate
              </p>
              <p className="text-sm text-[#718096] mt-1.5 leading-relaxed">
                Hai modificato i vincoli senza salvare.<br />Vuoi salvare prima di uscire?
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-xs">
              <button
                type="button"
                disabled={saving}
                onClick={async () => { await saveConstraints(); setShowExitConfirm(false); onClose() }}
                className="w-full h-12 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                           active:bg-[#152b47] disabled:opacity-60 transition-colors"
              >
                {saving ? 'Salvataggio…' : 'Salva e chiudi'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-full h-12 rounded-xl border border-[#e2e8f0] text-[#718096]
                           font-semibold text-sm active:bg-[#f0f4f8] transition-colors"
              >
                Esci senza salvare
              </button>
              <button
                type="button"
                onClick={() => setShowExitConfirm(false)}
                className="w-full h-10 text-sm text-[#a0aec0] font-medium
                           active:text-[#718096] transition-colors"
              >
                Annulla
              </button>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0 border-b border-[#f0f4f8]">
          <div>
            <h3 className="font-bold text-[#1a202c] text-base">Imposta Vincoli</h3>
            <p className="text-[10px] text-[#a0aec0] mt-0.5">Input per lo scheduling automatico</p>
          </div>
          <button type="button" onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#f0f4f8]
                       text-[#718096] text-lg leading-none">×</button>
        </div>

        {/* Tab bar */}
        {(() => {
          const todayISO = new Date().toISOString().slice(0, 10)
          const pendingCount = approvedAbsences.filter(a => ((a.end_date ?? a.start_date) ?? '').slice(0, 10) >= todayISO).length
          return (
            <div className="flex gap-1.5 px-6 pt-4 pb-0 shrink-0">
              {[['vincoli', '⚙️ Vincoli Solver'], ['assenze', '🗓 Ferie & Permessi']].map(([id, lbl]) => (
                <button key={id} type="button" onClick={() => setTab(id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold
                    py-2.5 rounded-xl transition-colors
                    ${tab === id
                      ? 'bg-[#1e3a5f] text-white'
                      : 'bg-[#f0f4f8] text-[#718096] hover:text-[#1e3a5f]'}`}>
                  {lbl}
                  {id === 'assenze' && pendingCount > 0 && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none
                      ${tab === 'assenze' ? 'bg-white/25 text-white' : 'bg-amber-400 text-white'}`}>
                      {pendingCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )
        })()}

        {/* Body scrollabile */}
        <div className="overflow-y-auto px-6 py-4 flex flex-col gap-3 flex-1">

          {/* ── Tab vincoli ── */}
          {tab === 'vincoli' && (
            <>
              <p className="text-[10px] text-[#a0aec0] leading-relaxed -mt-1">
                Configura i parametri usati dall'AI per generare la proposta settimanale.
              </p>

              {operators.length === 0 ? (
                <p className="text-xs text-[#a0aec0] italic text-center py-8">
                  Nessun operatore nella struttura.
                </p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {operators.map((op, i) => {
                    const [bg, text] = OP_PALETTE[i % OP_PALETTE.length]
                    const con = constraints[op.id] ?? {
                      max_hours_per_week: '', weekly_rest_day: '',
                      shift_preference: '', shift_avoid: '', recurring_shifts: [],
                    }
                    const recShifts = con.recurring_shifts ?? []
                    return (
                      <div key={op.id} className="bg-[#f8f9fa] rounded-2xl p-3 flex flex-col gap-2.5">
                        {/* Nome operatore */}
                        <div className="flex items-center gap-2">
                          <span className="w-7 h-7 rounded-full flex items-center justify-center
                                           text-[11px] font-bold shrink-0"
                            style={{ backgroundColor: bg, color: text }}>
                            {op.full_name.charAt(0).toUpperCase()}
                          </span>
                          <p className="text-sm font-semibold text-[#1a202c] truncate">{op.full_name}</p>
                          {op.role === 'manager' && (
                            <span className="shrink-0 text-[9px] font-bold bg-[#1e3a5f] text-white
                                             px-1.5 py-0.5 rounded-full leading-none uppercase tracking-wide">
                              Manager
                            </span>
                          )}
                        </div>

                        {/* Ore + Giorno riposo */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-semibold text-[#718096] uppercase
                                              tracking-wide block mb-1">
                              Max ore / settimana
                            </label>
                            <input type="number" min="0" max="80" step="1"
                              value={con.max_hours_per_week}
                              onChange={e => setCon(op.id, 'max_hours_per_week', e.target.value)}
                              placeholder="Es. 36" className={fieldCls} />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-[#718096] uppercase
                                              tracking-wide block mb-1">
                              Giorno di riposo
                            </label>
                            <select value={con.weekly_rest_day}
                              onChange={e => setCon(op.id, 'weekly_rest_day', e.target.value)}
                              className={fieldCls}>
                              <option value="">Nessuno</option>
                              {WEEK_DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                          </div>
                        </div>

                        {/* Turno Preferito + Turno da Evitare */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-semibold text-[#718096] uppercase
                                              tracking-wide block mb-1">
                              Turno Preferito
                            </label>
                            <select value={con.shift_preference}
                              onChange={e => setCon(op.id, 'shift_preference', e.target.value)}
                              className={fieldCls}>
                              <option value="">—</option>
                              <option value="mattina">Mattina</option>
                              <option value="pomeriggio">Pomeriggio</option>
                              <option value="notte">Notte</option>
                            </select>
                            <p className="text-[9px] text-[#a0aec0] mt-0.5">Soft — rilassato se necessario</p>
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-[#718096] uppercase
                                              tracking-wide block mb-1">
                              Turno da Evitare
                            </label>
                            <select value={con.shift_avoid}
                              onChange={e => setCon(op.id, 'shift_avoid', e.target.value)}
                              className={fieldCls}>
                              <option value="">—</option>
                              <option value="mattina">Mattina</option>
                              <option value="pomeriggio">Pomeriggio</option>
                              <option value="notte">Notte</option>
                            </select>
                            <p className="text-[9px] text-[#a0aec0] mt-0.5">Hard — mai assegnato</p>
                          </div>
                        </div>

                        {/* Vincoli Ricorrenti */}
                        <div>
                          <label className="text-[10px] font-semibold text-[#718096] uppercase
                                            tracking-wide block mb-1.5">
                            Turni Fissi
                          </label>
                          {recShifts.length > 0 && (
                            <div className="flex flex-col gap-1 mb-2">
                              {recShifts.map((rs, j) => (
                                <div key={j} className="flex items-center justify-between gap-2
                                                         bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5">
                                  <span className="text-[11px] font-semibold text-amber-800">
                                    🔒 {rs.day} — {rs.shift.charAt(0).toUpperCase() + rs.shift.slice(1)}
                                  </span>
                                  <button type="button"
                                    onClick={() => setCon(op.id, 'recurring_shifts',
                                      recShifts.filter((_, k) => k !== j))}
                                    className="text-amber-500 hover:text-amber-700 text-xs font-bold transition-colors">
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          <AddRecurringRowV onAdd={rs => {
                            const already = recShifts.some(r => r.day === rs.day && r.shift === rs.shift)
                            if (!already) setCon(op.id, 'recurring_shifts', [...recShifts, rs])
                          }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {error && <p className="text-xs text-red-500">{error}</p>}

              <button type="button" disabled={saving || operators.length === 0} onClick={saveConstraints}
                className={`w-full h-12 rounded-xl font-semibold text-sm transition-colors mt-1
                  ${saved
                    ? 'bg-green-500 text-white'
                    : 'bg-[#1e3a5f] text-white active:bg-[#152b47] disabled:opacity-60'}`}>
                {saving ? 'Salvataggio…' : saved ? '✓ Vincoli salvati' : 'Salva vincoli'}
              </button>
            </>
          )}

          {/* ── Tab assenze ── */}
          {tab === 'assenze' && (() => {
            const todayISO = new Date().toISOString().slice(0, 10)
            // approvedAbsences viene dal RPC SECURITY DEFINER — contiene solo approvate
            const futureAbs = approvedAbsences.filter(a =>
              ((a.end_date ?? a.start_date) ?? '').slice(0, 10) >= todayISO
            )

            // Raggruppa per operatore mantenendo l'ordine degli operatori
            const byOp = {}
            for (const abs of futureAbs) {
              if (!byOp[abs.user_id]) byOp[abs.user_id] = []
              byOp[abs.user_id].push(abs)
            }
            const opsWithAbs = operators.filter(op => byOp[op.id]?.length > 0)

            if (opsWithAbs.length === 0) {
              return (
                <div className="flex flex-col items-center py-10 text-center">
                  <p className="text-3xl mb-2">🗓</p>
                  <p className="font-semibold text-sm text-[#1a202c]">Nessuna assenza in corso o futura</p>
                  <p className="text-xs text-[#a0aec0] mt-1">
                    Le assenze si gestiscono dal profilo di ogni operatore.
                  </p>
                </div>
              )
            }

            return (
              <div className="flex flex-col gap-4">
                {opsWithAbs.map(op => (
                  <div key={op.id}>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[#718096] mb-1.5">
                      {op.full_name}
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {byOp[op.id].map(abs => (
                        <div key={abs.id} className="rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5">
                          <p className="text-xs font-semibold text-[#1a202c]">
                            {fmtAbsDate(abs.start_date)}
                            {abs.end_date && abs.end_date !== abs.start_date && (
                              <span className="text-[#718096]"> → {fmtAbsDate(abs.end_date)}</span>
                            )}
                          </p>
                          {abs.reason && (
                            <p className="text-[10px] text-[#a0aec0] mt-0.5 truncate">{abs.reason}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}

        </div>
      </div>
    </div>
  )
}

// Normalizza shift_type legacy → enum DB (robusto a en-dash, case, spazi)
function normalizeShift(s) {
  const l = (s ?? '').toLowerCase()
  if (l.startsWith('mattina'))    return 'mattina'
  if (l.startsWith('pomeriggio')) return 'pomeriggio'
  if (l.startsWith('notte'))      return 'notte'
  if (l.startsWith('speciale'))   return 'speciale'
  return s
}

// ─── Modal: Logica e Regole del Solver ───────────────────────────────────────

const SOLVER_RULES = [
  {
    icon: '🌙',
    title: 'Riposo Obbligatorio',
    desc:  'Minimo 11 ore di riposo tra la fine di un turno e l\'inizio del successivo.',
  },
  {
    icon: '🛡️',
    title: 'Copertura Garantita',
    desc:  'Almeno 1 operatore assegnato per ogni fascia oraria (Mattina, Pomeriggio, Notte) in ogni giorno della settimana.',
  },
  {
    icon: '🏖️',
    title: 'Priorità Assenze',
    desc:  'La generazione blocca automaticamente gli operatori con ferie o permessi approvati: non possono essere assegnati nei giorni di assenza.',
  },
  {
    icon: '⚖️',
    title: 'Equità Weekend',
    desc:  'Distribuzione bilanciata dei sabati e delle domeniche. Il sistema tiene traccia di chi non ha mai avuto un weekend libero e lo prioritizza.',
  },
  {
    icon: '⏱️',
    title: 'Tetto Orario',
    desc:  'Il numero di turni assegnati rispetta il monte ore settimanale (max_hours_per_week) configurato per ogni operatore.',
  },
  {
    icon: '🔒',
    title: 'Turni Bloccati',
    desc:  'I turni contrassegnati come bloccati (🔒) vengono preservati e non sovrascrittti dalla generazione automatica.',
  },
  {
    icon: '🔄',
    title: 'Turni Fissi Ricorrenti',
    desc:  'Gli operatori con vincoli ricorrenti (es. sempre Mattina il Lunedì) vengono assegnati per primi, prima degli altri slot liberi.',
  },
  {
    icon: '🏢',
    title: 'Controllo Multi-Struttura',
    desc:  'Prima di assegnare un operatore, il Solver verifica che non sia già in turno in un\'altra struttura della cooperativa per lo stesso giorno e fascia oraria.',
  },
  {
    icon: '🔁',
    title: 'Riposo Weekend Alternato',
    desc:  'Gli operatori che hanno lavorato il Sabato o la Domenica della settimana precedente non vengono assegnati al weekend corrente, garantendo un weekend libero su due.',
  },
]

function SolverRulesModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Pannello */}
      <div className="relative w-full max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl
                      flex flex-col max-h-[90vh]">

        {/* Handle mobile */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden shrink-0">
          <div className="w-10 h-1 rounded-full bg-[#e2e8f0]" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-4 pb-4 shrink-0
                        border-b border-[#f0f4f8]">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <svg className="w-4 h-4 text-[#1e3a5f] shrink-0" fill="none" stroke="currentColor"
                   strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <h3 className="font-bold text-[#1a202c] text-base">Logica e Regole del Solver</h3>
            </div>
            <p className="text-[11px] text-[#a0aec0]">
              Regole attive nel motore di scheduling automatico
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#f0f4f8]
                       text-[#718096] text-lg leading-none active:bg-[#e2e8f0] transition-colors shrink-0 ml-3">
            ×
          </button>
        </div>

        {/* Body scrollabile */}
        <div className="overflow-y-auto px-6 py-5 flex flex-col gap-3 flex-1">

          {SOLVER_RULES.map((rule, i) => (
            <div key={i}
              className="flex items-start gap-3.5 bg-[#f8f9fa] rounded-2xl px-4 py-3.5 border border-[#f0f4f8]">

              {/* Icona */}
              <span className="text-xl leading-none shrink-0 mt-0.5">{rule.icon}</span>

              {/* Testo */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <p className="text-sm font-bold text-[#1a202c] leading-tight">{rule.title}</p>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold
                                   bg-green-100 text-green-700 rounded-full px-2 py-0.5 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                    Attiva
                  </span>
                </div>
                <p className="text-xs text-[#718096] leading-relaxed">{rule.desc}</p>
              </div>
            </div>
          ))}

          {/* Nota di sistema */}
          <div className="mt-1 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3
                          flex items-start gap-2.5">
            <span className="text-base leading-none shrink-0 mt-0.5">⚙️</span>
            <p className="text-xs text-amber-800 leading-relaxed">
              <span className="font-semibold">Configurazione di sistema.</span>{' '}
              Queste regole sono integrate nel motore di scheduling e non sono modificabili
              in questa versione. I parametri personalizzabili per ogni operatore (ore, riposi,
              preferenze) si configurano in <span className="font-semibold">Imposta Vincoli</span>.
            </p>
          </div>
        </div>

        {/* Footer con tasto chiudi */}
        <div className="px-6 py-4 border-t border-[#f0f4f8] shrink-0">
          <button type="button" onClick={onClose}
            className="w-full h-11 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                       active:bg-[#152b47] transition-colors">
            Chiudi
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Riepilogo mese mobile ────────────────────────────────────────────────────

function MobileRiepilogo({ operators, monthlyHoursMap, monthlySundayStats, weeks }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="lg:hidden bg-white rounded-2xl border border-[#e2e8f0] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#f8f9fa] transition-colors"
      >
        <span className="text-sm font-bold text-[#1e3a5f]">Riepilogo mese</span>
        <svg className={`w-4 h-4 text-[#a0aec0] transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-[#f0f4f8] px-4 py-3 flex flex-col gap-3">
          {operators.map(op => {
            const assignedH = monthlyHoursMap[op.id] ?? 0
            const contractH = (op.max_hours_per_week ?? 0) * weeks.length
            const rawPct    = contractH > 0 ? Math.round(assignedH / contractH * 100) : 0
            const pct       = Math.min(100, rawPct)
            const over      = rawPct > 100
            const freeSun   = monthlySundayStats.freeSundays[op.id] ?? 0
            const totalSun  = weeks.length
            const hasSplit  = monthlySundayStats.splitWeeks[op.id] ?? false
            const barColor  = over ? 'bg-red-400' : rawPct >= 85 ? 'bg-amber-400' : 'bg-green-400'
            const textColor = over ? 'text-red-500' : rawPct >= 85 ? 'text-amber-500' : 'text-[#718096]'

            return (
              <div key={op.id}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-[#1a202c] truncate max-w-[160px]">
                    {op.full_name}
                  </span>
                  <span className={`text-xs shrink-0 ml-2 ${hasSplit ? 'text-amber-500 font-semibold' : 'text-[#718096]'}`}>
                    {freeSun}/{totalSun} Dom.{hasSplit ? ' ⚠' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={`text-xs shrink-0 font-medium ${textColor}`}>
                    {fmtH(assignedH)}{contractH > 0 ? `/${fmtH(contractH)}h` : 'h'}{over ? ' !' : ''}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Componente principale ────────────────────────────────────────────────────

export default function ShiftSchedule({ structures, canWrite = false, defaultStructureId, onGoToTeam }) {
  const [structureId, setStructureId] = useState(defaultStructureId ?? structures[0]?.id ?? null)
  const structure = structures.find(s => s.id === structureId) ?? null

  const _now = new Date()
  const [selectedYear,  setSelectedYear]  = useState(_now.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(_now.getMonth()) // 0-based
  const [expandedWeekIdx, setExpandedWeekIdx] = useState(null) // null = auto
  const weekRefs = useRef([])

  const [schedules,  setSchedules]  = useState([])
  const [operators,  setOperators]  = useState([])
  const [loading,    setLoading]    = useState(false)
  const [savingSlot, setSavingSlot] = useState(null)
  const [specialDate, setSpecialDate] = useState(null)
  const [editSpecialRow, setEditSpecialRow] = useState(null)
  const [showVincoli,      setShowVincoli]      = useState(false)
  const [showSolverRules,  setShowSolverRules]  = useState(false)
  const [draftSchedule,     setDraftSchedule]     = useState(null)
  const [draftWeekIdx,      setDraftWeekIdx]      = useState(null) // indice settimana in bozza
  const [draftRestored,     setDraftRestored]     = useState(false)
  const [generating,     setGenerating]     = useState(false)
  const [generatingWeekIdx, setGeneratingWeekIdx] = useState(null)
  const [publishing,     setPublishing]     = useState(false)
  const [weekendOffIdsByWeek, setWeekendOffIdsByWeek] = useState([]) // string[][]
  const [weekendOnIdsByWeek,  setWeekendOnIdsByWeek]  = useState([]) // string[][]
  const [weekendViolations,   setWeekendViolations]   = useState([])
  const [splitWeekendNames,   setSplitWeekendNames]   = useState([])
  const [relaxedPreferences,  setRelaxedPreferences]  = useState([])
  const [weekEquityWarnings,  setWeekEquityWarnings]  = useState([])
  const [sundayWarnings,      setSundayWarnings]      = useState([])
  const [showUnassignedAlert, setShowUnassignedAlert] = useState(false)
  const [collisionBlock,      setCollisionBlock]      = useState(null)  // { opName, structureName, shiftLabel, soft?, pendingUserId?, pendingShiftType?, pendingDateISO? }
  const [apptMap,    setApptMap]    = useState({})
  const [residents,  setResidents]  = useState([])
  const [error, setError] = useState('')
  const [solverDiag, setSolverDiag] = useState(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [clearing,         setClearing]         = useState(false)
  const [clearSuccess,     setClearSuccess]      = useState(false)
  // Dati cross-struttura per availability check e solver
  const [crossThisMonthSlots,   setCrossThisMonthSlots]   = useState([])
  const [crossPrevWeekSlots,    setCrossPrevWeekSlots]    = useState([])
  // Conteggio turni weekend lavorati negli ultimi 4 weekend (tiebreaker rotazione)
  const [recentWeekendCounts,   setRecentWeekendCounts]   = useState({})
  // Assenze approvate per il picker manuale
  const [approvedAbsences,    setApprovedAbsences]    = useState([])

  // ── Chiave localStorage per la bozza turni ──────────────────────────────────
  const draftKey = structureId
    ? `turno_draft_${structureId}_${selectedYear}_${selectedMonth}`
    : null

  // Ripristina bozza da localStorage quando cambia struttura/mese/anno
  useEffect(() => {
    if (!draftKey) return
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw) {
        setDraftSchedule(null)
        setDraftWeekIdx(null)
        setDraftRestored(false)
        setWeekendOffIdsByWeek([])
        setWeekendOnIdsByWeek([])
        setWeekendViolations([])
        setSplitWeekendNames([])
        setRelaxedPreferences([])
        setWeekEquityWarnings([])
        setSundayWarnings([])
        return
      }
      const saved = JSON.parse(raw)
      setDraftSchedule(saved.draftSchedule ?? null)
      setDraftWeekIdx(saved.draftWeekIdx ?? null)
      setWeekendOffIdsByWeek(saved.weekendOffIdsByWeek ?? [])
      setWeekendOnIdsByWeek(saved.weekendOnIdsByWeek ?? [])
      setWeekendViolations(saved.weekendViolations ?? [])
      setSplitWeekendNames(saved.splitWeekendNames ?? [])
      setRelaxedPreferences(saved.relaxedPreferences ?? [])
      setWeekEquityWarnings(saved.weekEquityWarnings ?? [])
      setSundayWarnings(saved.sundayWarnings ?? [])
      if (saved.draftSchedule) {
        setDraftRestored(true)
        setTimeout(() => setDraftRestored(false), 4000)
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])

  // Persiste bozza su localStorage a ogni modifica
  useEffect(() => {
    if (!draftKey) return
    try {
      if (draftSchedule) {
        localStorage.setItem(draftKey, JSON.stringify({
          draftSchedule,
          draftWeekIdx,
          weekendOffIdsByWeek,
          weekendOnIdsByWeek,
          weekendViolations,
          splitWeekendNames,
          relaxedPreferences,
          weekEquityWarnings,
          sundayWarnings,
        }))
      } else {
        localStorage.removeItem(draftKey)
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftSchedule, draftKey])

  // ── Bounds del mese selezionato ──────────────────────────────────────────────
  const monthBounds = useMemo(
    () => getMonthBounds(selectedYear, selectedMonth),
    [selectedYear, selectedMonth]
  )
  const { monthStart, monthEnd, monthDays, weeks } = monthBounds

  // Auto-espandi la settimana che contiene oggi al cambio mese
  useEffect(() => {
    const todayISO = toISO(new Date())
    const idx = weeks.findIndex(w => w.includes(todayISO))
    setExpandedWeekIdx(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear, selectedMonth])

  // Settimana correntemente espansa (come Date[], per i sotto-componenti che si aspettano Date[])
  const activeWeekIdx = expandedWeekIdx ?? 0
  const weekDays = useMemo(
    () => (weeks[activeWeekIdx] ?? weeks[0] ?? []).map(iso => new Date(iso + 'T12:00:00')),
    [weeks, activeWeekIdx]
  )

  const fetchOperators = useCallback(async () => {
    if (!structureId) return
    const { data } = await supabase.rpc('get_team_members', { p_structure_id: structureId })
    console.log('[fetchOperators] valori max_hours_per_week dal DB:',
      (data ?? []).map(m => `${m.full_name}: ${m.max_hours_per_week}`))
    setOperators((data ?? []).filter(m => ['operator', 'admin_secondary', 'coordinator', 'manager'].includes(m.role)))
  }, [structureId])

  // Range di fetch esteso alle settimane complete (include giorni di overflow adiacenti al mese)
  const fetchStart = weeks[0]?.[0]                          ?? monthStart
  const fetchEnd   = weeks[weeks.length - 1]?.[6]           ?? monthEnd

  const fetchSchedules = useCallback(async () => {
    if (!structureId) return
    setLoading(true); setError('')
    const { data, error: err } = await supabase.rpc('get_month_schedules', {
      p_structure_id: structureId,
      p_month_start:  fetchStart,
      p_month_end:    fetchEnd,
    })
    if (err) setError('Errore nel caricamento turni.')
    setSchedules(data ?? [])
    setLoading(false)
  }, [structureId, fetchStart, fetchEnd])

  const fetchAppointments = useCallback(async () => {
    if (!structureId) return
    const { data: resRows } = await supabase
      .from('residents')
      .select('id, nome, cognome')
      .eq('structure_id', structureId)
      .eq('is_archived', false)
    setResidents(resRows ?? [])
    const resIds = (resRows ?? []).map(r => r.id)
    if (!resIds.length) { setApptMap({}); return }
    const resLookup = Object.fromEntries((resRows ?? []).map(r => [r.id, r]))

    const { data: appts } = await supabase
      .from('resident_appointments')
      .select('id, title, start_datetime, end_datetime, location, resident_id, operator:profiles!assigned_operator_id(full_name)')
      .in('resident_id', resIds)
      .gte('start_datetime', fetchStart + 'T00:00:00')
      .lte('start_datetime', fetchEnd + 'T23:59:59')
      .neq('status', 'cancelled')
      .order('start_datetime')

    // Raggruppa appuntamenti con stesso titolo + orario + operatore in un unico evento
    const grouped = {}
    for (const appt of appts ?? []) {
      const key = `${appt.title}|${appt.start_datetime}|${appt.assigned_operator_id ?? ''}`
      const res = resLookup[appt.resident_id]
      const residentName = res ? `${res.nome} ${res.cognome}` : '—'
      if (!grouped[key]) {
        grouped[key] = { ...appt, residentNames: [residentName], residentIds: [appt.resident_id], apptIds: [appt.id] }
      } else {
        grouped[key].residentNames.push(residentName)
        grouped[key].residentIds.push(appt.resident_id)
        grouped[key].apptIds.push(appt.id)
      }
    }

    const map = {}
    for (const appt of Object.values(grouped)) {
      const date = appt.start_datetime.slice(0, 10)
      if (!map[date]) map[date] = []
      map[date].push({
        ...appt,
        residentName: appt.residentNames.join(', '),
      })
    }
    setApptMap(map)
  }, [structureId, fetchStart, fetchEnd])

  // Set derivati per la lookup O(1)
  // Map: `${user_id}|${date}` → nome struttura — blocca qualsiasi turno nella stessa data
  const crossSameDayMap = useMemo(() => {
    const map = new Map()
    for (const s of crossThisMonthSlots) {
      // Chiave include shift_type: blocca solo se stesso turno (non turni diversi nella stessa giornata)
      const key = `${s.user_id}|${s.date}|${s.shift_type}`
      if (!map.has(key)) {
        const name = structures.find(st => st.id === s.structure_id)?.name ?? 'altra sede'
        map.set(key, name)
      }
    }
    return map
  }, [crossThisMonthSlots, structures])
  // Filtra solo domenica: la rotazione è basata sulla Domenica
  const prevWeekendWorkedIds = useMemo(
    () => new Set(
      crossPrevWeekSlots
        .filter(s => new Date(s.date + 'T12:00:00').getDay() === 0)
        .map(s => s.user_id)
    ),
    [crossPrevWeekSlots]
  )

  // Fetch turni cross-struttura: collisioni questa settimana + weekend precedente
  const fetchCrossStructureData = useCallback(async () => {
    if (!structureId || !operators.length) {
      setCrossThisMonthSlots([])
      setCrossPrevWeekSlots([])
      setRecentWeekendCounts({})
      return
    }
    const otherIds = structures.map(s => s.id).filter(id => id !== structureId)
    const opIds    = operators.map(o => o.id)
    // Domenica prima del mese per inizializzare V12 (rotazione domenicale)
    const firstMonday = weeks[0]?.[0] ?? monthStart
    const prevSun = toISO(addDays(new Date(firstMonday + 'T12:00:00'), -1))

    // Ultime 4 domeniche per il tiebreaker di rotazione (la rotazione è domenicale)
    const last4WeekendDates = Array.from({ length: 4 }, (_, i) => {
      const sunRef = addDays(new Date(firstMonday + 'T12:00:00'), -7 * (i + 1) + 6)
      return toISO(sunRef)
    })

    const [thisMonthRes, prevWeekendRes, recentWeekendRes] = await Promise.all([
      otherIds.length > 0
        ? supabase.from('schedules').select('user_id, date, shift_type, structure_id')
            .in('structure_id', otherIds)
            .in('user_id', opIds)
            .gte('date', fetchStart).lte('date', fetchEnd)
            .neq('shift_type', 'speciale')
        : { data: [] },
      // SECURITY DEFINER RPC: verifica weekend precedente su TUTTE le strutture (cross-org).
      supabase.rpc('get_prev_weekend_worked', {
        p_user_ids: opIds,
        p_sat:      prevSun,  // rotazione domenicale: passiamo domenica per entrambi
        p_sun:      prevSun,
      }),
      // Conteggio turni weekend degli ultimi 4 weekend (solo questa struttura)
      supabase.from('schedules').select('user_id')
        .eq('structure_id', structureId)
        .in('user_id', opIds)
        .in('date', last4WeekendDates)
        .neq('shift_type', 'speciale'),
    ])

    setCrossThisMonthSlots(thisMonthRes.data ?? [])
    setCrossPrevWeekSlots(prevWeekendRes.data ?? [])

    // Conta turni weekend per operatore (usato come tiebreaker nel sort)
    const counts = {}
    for (const row of (recentWeekendRes.data ?? [])) {
      counts[row.user_id] = (counts[row.user_id] ?? 0) + 1
    }
    setRecentWeekendCounts(counts)
  }, [structureId, structures, operators, fetchStart, fetchEnd, weeks])

  const fetchApprovedAbsences = useCallback(async () => {
    if (!operators.length) { setApprovedAbsences([]); return }
    // Usa SECURITY DEFINER RPC: bypassa RLS, garantisce che il manager
    // possa sempre leggere le assenze dei propri operatori.
    const { data } = await supabase.rpc('get_approved_absences', {
      p_user_ids: operators.map(o => o.id),
    })
    setApprovedAbsences(data ?? [])
  }, [operators])

  useEffect(() => { fetchOperators() }, [fetchOperators])
  useEffect(() => { fetchSchedules() }, [fetchSchedules])
  useEffect(() => { fetchAppointments() }, [fetchAppointments])
  useEffect(() => { fetchCrossStructureData() }, [fetchCrossStructureData])
  useEffect(() => { fetchApprovedAbsences() }, [fetchApprovedAbsences])

  const colorMap = useMemo(() => {
    const map = {}
    operators.forEach((op, i) => { map[op.id] = i })
    return map
  }, [operators])

  // Nomi operatori col weekend libero per la settimana espansa
  const weekendOffNames = useMemo(() => {
    const offIds = weekendOffIdsByWeek[activeWeekIdx] ?? []
    if (!draftSchedule || !offIds.length) return []
    const satKey = toISO(weekDays[5])
    const sunKey = toISO(weekDays[6])
    const draftWeekendOpIds = new Set()
    for (const dateKey of [satKey, sunKey]) {
      for (const slot of Object.values(draftSchedule[dateKey] ?? {})) {
        if (slot?.operatorId) draftWeekendOpIds.add(slot.operatorId)
        for (const e of slot?.extras ?? []) draftWeekendOpIds.add(e.operatorId)
      }
    }
    return offIds
      .filter(id => !draftWeekendOpIds.has(id))
      .map(id => operators.find(o => o.id === id)?.full_name)
      .filter(Boolean)
  }, [draftSchedule, weekendOffIdsByWeek, activeWeekIdx, weekDays, operators])

  // Calcola i turni non assegnati nello schedule bozza.
  // Set di "dateISO|shiftType" per slot che dovrebbero avere un operatore ma non ce l'hanno.
  // Controlla SOLO i giorni presenti in draftSchedule: le settimane non ancora generate
  // non contano come scoperte (non sono in bozza).
  // Usato per: evidenziare i giorni critici, bloccare la pubblicazione.
  const unassignedSlots = useMemo(() => {
    if (!draftSchedule) return new Set()
    const missing = new Set()
    const shiftTypes = FIXED_SHIFTS.map(s => s.type)
    for (const iso of Object.keys(draftSchedule)) {
      const dayData = draftSchedule[iso]
      for (const t of shiftTypes) {
        if (!dayData?.[t]?.operatorId) missing.add(`${iso}|${t}`)
      }
    }
    return missing
  }, [draftSchedule])

  const hasUnassignedSlots = unassignedSlots.size > 0

  // Set di dateISO che hanno almeno uno slot non assegnato (per bordo rosso DayColumn)
  const unassignedDays = useMemo(() => {
    const days = new Set()
    for (const key of unassignedSlots) days.add(key.split('|')[0])
    return days
  }, [unassignedSlots])

  // Controlla se un operatore è disponibile per un dato slot
  // Restituisce { available: true } oppure { available: false, reason: 'collision'|'weekend' }
  const checkOperatorAvailability = useCallback((userId, dateISO, shiftType) => {
    // Blocca solo se l'operatore ha lo STESSO turno (stesso shift_type) in un'altra struttura
    const collisionStructure = crossSameDayMap.get(`${userId}|${dateISO}|${shiftType}`)
    if (collisionStructure !== undefined)
      return { available: false, reason: 'collision', structureName: collisionStructure }
    const dow = new Date(dateISO + 'T12:00:00').getDay()   // 0=Dom, 6=Sab
    // La rotazione si applica solo alla Domenica
    if (dow === 0 && prevWeekendWorkedIds.has(userId))
      return { available: false, reason: 'weekend' }
    const onLeave = approvedAbsences.some(a =>
      a.user_id === userId &&
      a.start_date <= dateISO &&
      a.end_date >= dateISO &&
      (a.is_full_day !== false ||
       a.slot_type === 'giorno_intero' ||
       a.slot_type === shiftType ||
       a.slot_type === 'personalizzata')
    )
    if (onLeave) return { available: false, reason: 'absence' }
    return { available: true }
  }, [crossSameDayMap, prevWeekendWorkedIds, approvedAbsences])

  const scheduleMap = useMemo(() => {
    const map = {}
    for (const s of schedules) {
      if (!map[s.date])               map[s.date] = {}
      if (!map[s.date][s.shift_type]) map[s.date][s.shift_type] = []
      map[s.date][s.shift_type].push(s)
    }
    return map
  }, [schedules])

  // weekendOnIds per la settimana espansa (per il picker)
  const weekendOnIds = weekendOnIdsByWeek[activeWeekIdx] ?? []
  const weekendOffIds = weekendOffIdsByWeek[activeWeekIdx] ?? []
  const weekendPrioritySet = useMemo(() => new Set(weekendOnIds), [weekendOnIds])

  // Operatori già assegnati in ciascun giorno del weekend (pubblicati + bozza corrente).
  // Usato dal picker per mostrare l'avviso "weekend completo" sull'ALTRO giorno.
  const otherWeekendDayAssignedIds = useMemo(() => {
    const satKey = toISO(weekDays[5])
    const sunKey = toISO(weekDays[6])
    const getIds = (dateKey) => {
      const pub   = Object.values(scheduleMap[dateKey] ?? {}).flat().map(r => r.user_id)
      const draft = draftSchedule
        ? Object.values(draftSchedule[dateKey] ?? {})
            .flatMap(slot => [slot?.operatorId, ...(slot?.extras ?? []).map(e => e.operatorId)])
            .filter(Boolean)
        : []
      return new Set([...pub, ...draft])
    }
    return { sat: getIds(satKey), sun: getIds(sunKey) }
  }, [scheduleMap, draftSchedule, weekDays])

  // Ore per settimana espansa (pubblicati + bozza) → usato dal picker per warnings
  const weeklyHoursMap = useMemo(() => {
    const map = {}
    const add = (uid, type) => { map[uid] = (map[uid] ?? 0) + (SHIFT_DURATION[type] ?? 8) }
    const activeWeekISOs = new Set(weeks[activeWeekIdx] ?? [])
    for (const s of schedules) {
      if (s.shift_type !== 'speciale' && activeWeekISOs.has(s.date)) add(s.user_id, s.shift_type)
    }
    if (draftSchedule) {
      for (const [date, shifts] of Object.entries(draftSchedule)) {
        if (!activeWeekISOs.has(date)) continue
        for (const [stype, slot] of Object.entries(shifts)) {
          const t = normalizeShift(stype)
          if (slot?.operatorId) add(slot.operatorId, t)
          for (const e of slot?.extras ?? []) add(e.operatorId, t)
        }
      }
    }
    return map
  }, [schedules, draftSchedule, weeks, activeWeekIdx])

  // Ore mensili per operatore (pubblicati + bozza) → usato dalla sidebar
  const monthlyHoursMap = useMemo(() => {
    const map = {}
    const add = (uid, type) => { map[uid] = (map[uid] ?? 0) + (SHIFT_DURATION[type] ?? 8) }
    for (const s of schedules) {
      if (s.shift_type !== 'speciale') add(s.user_id, s.shift_type)
    }
    if (draftSchedule) {
      for (const shifts of Object.values(draftSchedule)) {
        for (const [stype, slot] of Object.entries(shifts)) {
          const t = normalizeShift(stype)
          if (slot?.operatorId) add(slot.operatorId, t)
          for (const e of slot?.extras ?? []) add(e.operatorId, t)
        }
      }
    }
    return map
  }, [schedules, draftSchedule])

  // Statistiche domenicali per operatore nel mese corrente (pubblicati + bozza) → sidebar
  // freeSundays[opId]: domeniche libere (non assegnato in quella domenica)
  // splitWeeks[opId]: true se in almeno una settimana ha lavorato sia Sabato che Domenica
  const monthlySundayStats = useMemo(() => {
    const freeSundays = {}
    const splitWeeks  = {}

    const workedOn = (opId, dateISO) => {
      if (schedules.some(s => s.user_id === opId && s.date === dateISO && s.shift_type !== 'speciale'))
        return true
      const daySlots = draftSchedule?.[dateISO]
      if (!daySlots) return false
      return Object.values(daySlots).some(slot =>
        slot?.operatorId === opId || (slot?.extras ?? []).some(e => e.operatorId === opId)
      )
    }

    for (const op of operators) {
      let free  = 0
      let split = false
      for (const week of weeks) {
        const satISO = week[5]
        const sunISO = week[6]
        const workedSun = workedOn(op.id, sunISO)
        const workedSat = workedOn(op.id, satISO)
        if (!workedSun) free++
        if (workedSat && workedSun) split = true
      }
      freeSundays[op.id] = free
      splitWeeks[op.id]  = split
    }
    return { freeSundays, splitWeeks }
  }, [schedules, draftSchedule, operators, weeks])

  async function handleAddShift(dateISO, shiftType, userId) {
    // ── Validazione DB cross-struttura ───────────────────────────────────
    // Stesso turno in altra struttura → hard block
    // Turno diverso in altra struttura → soft confirm
    const { data: conflicts } = await supabase
      .from('schedules')
      .select('structure_id, shift_type')
      .eq('user_id', userId)
      .eq('date', dateISO)
      .neq('structure_id', structureId)
      .neq('shift_type', 'speciale')

    if (conflicts?.length > 0) {
      const sameShift = conflicts.find(c => c.shift_type === shiftType)
      const conflictEntry = sameShift ?? conflicts[0]
      const conflictName = structures.find(s => s.id === conflictEntry.structure_id)?.name ?? 'altra sede'
      const conflictShiftLabel = FIXED_SHIFTS.find(s => s.type === conflictEntry.shift_type)?.label ?? conflictEntry.shift_type
      const op = operators.find(o => o.id === userId)
      setCollisionBlock({
        opName:          op?.full_name ?? 'Operatore',
        structureName:   conflictName,
        shiftLabel:      conflictShiftLabel,
        dateISO,
        soft:            !sameShift,  // turno diverso → soft confirm
        pendingUserId:   sameShift ? null : userId,
        pendingShiftType: sameShift ? null : shiftType,
        pendingDateISO:  sameShift ? null : dateISO,
      })
      return
    }

    const key = `${dateISO}|${shiftType}`
    setSavingSlot(key)
    const { error: err } = await supabase.from('schedules').insert({
      structure_id: structureId, user_id: userId, date: dateISO, shift_type: shiftType,
    })
    if (err && !err.code?.includes('23505')) setError('Errore nel salvataggio.')
    else await fetchSchedules()
    setSavingSlot(null)
  }

  async function handleRemoveShift(id) {
    const { error: err } = await supabase.from('schedules').delete().eq('id', id)
    if (err) { setError('Errore nella rimozione.'); return }
    setSchedules(prev => prev.filter(s => s.id !== id))
  }

  async function handleUpdateSpecial({ oldRow, date, userId, label }) {
    const { error: err } = await supabase
      .from('schedules')
      .update({ user_id: userId, date, label })
      .eq('id', oldRow.id)
    if (err) { setError('Errore nella modifica.'); return }
    setEditSpecialRow(null)
    await fetchSchedules()
  }

  async function handleToggleLock(scheduleId, currentLocked) {
    const { error: err } = await supabase
      .from('schedules')
      .update({ is_locked: !currentLocked })
      .eq('id', scheduleId)
    if (!err) {
      setSchedules(prev => prev.map(s =>
        s.id === scheduleId ? { ...s, is_locked: !currentLocked } : s
      ))
    }
  }

  async function handleAddSpecial({ date, userId, label }) {
    const { error: err } = await supabase.from('schedules').insert({
      structure_id: structureId, user_id: userId, date, shift_type: 'speciale', label,
    })
    if (err) { setError('Errore nel salvataggio.'); return }
    setSpecialDate(null)
    await fetchSchedules()
  }

  async function handleGenerate() {
    setGenerating(true); setGeneratingWeekIdx(0); setError('')

    const [{ data: teamData }, { data: lockedRows }] = await Promise.all([
      supabase.rpc('get_team_members', { p_structure_id: structureId }),
      supabase
        .from('schedules')
        .select('user_id, date, shift_type')
        .eq('structure_id', structureId)
        .eq('is_locked', true)
        .gte('date', monthStart)
        .lte('date', monthEnd),
    ])

    // Manager, coordinatori e operatori sono trattati allo stesso modo nel solver.
    // Se max_hours_per_week > 0 vengono inclusi nella pianificazione come tutti gli altri.
    const ops = (teamData ?? [])
      .filter(m => ['operator', 'admin_secondary', 'coordinator', 'manager'].includes(m.role))
      .filter(m => m.max_hours_per_week > 0)
      .sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? ''))

    if (!ops.length) {
      setError('Nessun operatore nella struttura.')
      setGenerating(false)
      return
    }

    // SECURITY DEFINER RPC: bypassa RLS per l'intero mese.
    const { data: absences } = await supabase.rpc('get_approved_absences', {
      p_user_ids: ops.map(o => o.id),
    })
    const absArr = absences ?? []

    const lockedSlots = (lockedRows ?? []).map(r => ({
      dateISO:    r.date,
      shift:      normalizeShift(r.shift_type),
      operatorId: r.user_id,
    }))

    const recurringSlots = ops.flatMap(op =>
      (op.recurring_shifts ?? []).map(rs => ({
        operatorId: op.id,
        dayName:    rs.day,
        shift:      normalizeShift(rs.shift),
      }))
    )

    const crossSlotsForSolver = crossThisMonthSlots.map(s => ({
      userId:    s.user_id,
      dateISO:   s.date,
      shiftType: s.shift_type,
    }))

    // ── Generazione settimanale: solo la settimana correntemente selezionata ──
    const targetWeek        = weeks[activeWeekIdx]
    const weeksBeforeTarget = weeks.slice(0, activeWeekIdx)

    // V4m: ore già pubblicate nelle settimane precedenti → budget mensile corretto
    const initialMonthHoursConsumed = computeMonthHoursFromSchedules(
      schedules, weeksBeforeTarget, SHIFT_DURATION
    )

    // La domenica immediatamente prima del lunedì della settimana target.
    // Usata sia per V12 (rotazione) che per V3 cross-week (notte→mattina).
    const prevSundayISO = toISO(addDays(new Date(targetWeek[0] + 'T12:00:00'), -1))

    // V3 cross-week: chi ha fatto la Notte della domenica precedente
    // → bloccato dalla Mattina del lunedì di questa settimana
    const prevSundayNightOpId = schedules.find(
      s => s.date === prevSundayISO && normalizeShift(s.shift_type) === 'notte'
    )?.user_id ?? null

    // V12: chi ha lavorato la domenica immediatamente prima della settimana target,
    // in QUALSIASI struttura (cross-org). Per la prima settimana del mese usiamo
    // prevWeekendWorkedIds (letto via RPC da tutte le strutture). Per le settimane
    // successive combiniamo schedules (questa struttura) + crossThisMonthSlots (altre).
    let prevSundayWorkedIds
    if (activeWeekIdx === 0) {
      prevSundayWorkedIds = [...prevWeekendWorkedIds]
    } else {
      const prevWeekSundayISO = weeks[activeWeekIdx - 1][6]
      const fromThis   = schedules.filter(s => s.date === prevWeekSundayISO).map(s => s.user_id)
      const fromOthers = crossThisMonthSlots.filter(s => s.date === prevWeekSundayISO).map(s => s.user_id)
      prevSundayWorkedIds = [...new Set([...fromThis, ...fromOthers])]
    }

    const result = generateMonthlySchedule({
      weeks:                [targetWeek],
      monthDays,
      operators:            ops,
      approvedAbsences:     absArr,
      lockedSlots,
      recurringSlots,
      crossStructureSlots:  crossSlotsForSolver,
      prevMonthWorkedIds:   prevSundayWorkedIds,
      recentWeekendCounts,
      onWeekProgress: (wi, total) => setGeneratingWeekIdx(wi < total ? wi : null),
      debugMode:            import.meta.env.DEV,
      initialMonthHoursConsumed,
      prevSundayNightOpId,
      totalWeeksInMonth:    weeks.length,
    })

    if (result.success) {
      setDraftSchedule(result.schedule)
      setDraftWeekIdx(activeWeekIdx)
      // Il solver settimanale restituisce result.weekendOff/OnIdsByWeek con indice 0.
      // Il publish flow accede a weekendOffIdsByWeek[activeWeekIdx], quindi mappa
      // il risultato all'indice corretto prima di salvarlo nello state.
      const offByWeek = []; offByWeek[activeWeekIdx] = result.weekendOffIdsByWeek?.[0] ?? []
      const onByWeek  = []; onByWeek[activeWeekIdx]  = result.weekendOnIdsByWeek?.[0]  ?? []
      setWeekendOffIdsByWeek(offByWeek)
      setWeekendOnIdsByWeek(onByWeek)
      setRelaxedPreferences(result.relaxedPreferences    ?? [])
      setWeekendViolations(result.weekendViolations      ?? [])
      setSplitWeekendNames(result.splitWeekendNames      ?? [])
      setWeekEquityWarnings(result.weekEquityWarnings    ?? [])
      setSundayWarnings(result.sundayWarnings              ?? [])
      // Mostra popup di avviso se ci sono turni non assegnati
      if ((result.sundayWarnings ?? []).length > 0) {
        setShowUnassignedAlert(true)
      }
    } else {
      const SHIFTS_PER_DAY  = 3
      const SHIFT_HOURS     = 8
      const failedWeekDays  = targetWeek ?? []
      const requiredHours   = SHIFTS_PER_DAY * 7 * SHIFT_HOURS
      const totalContractHours = ops.reduce((sum, o) => sum + (o.max_hours_per_week ?? 0), 0)
      const opsWithoutHours = ops.filter(o => !o.max_hours_per_week || o.max_hours_per_week === 0)

      const opsOnLeave = new Set(
        absArr
          .filter(a => failedWeekDays.some(iso => iso >= a.start_date && iso <= a.end_date))
          .map(a => a.user_id)
      )

      const DAY_NAMES = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica']
      const criticalDays = failedWeekDays
        .map((iso, i) => {
          const available = ops.filter(
            o => !absArr.some(a => a.user_id === o.id && iso >= a.start_date && iso <= a.end_date)
          )
          return available.length < SHIFTS_PER_DAY ? DAY_NAMES[i] : null
        })
        .filter(Boolean)

      playAudio('error')
      setSolverDiag({
        opsWithoutHours,
        totalContractHours,
        requiredHours,
        opsOnLeaveCount: opsOnLeave.size,
        criticalDays,
        solverError: result.error,
        failedWeekLabel: result.failedWeekIndex != null
          ? `Settimana ${result.failedWeekIndex + 1}`
          : null,
      })
    }
    setGenerating(false)
    setGeneratingWeekIdx(null)
  }

  function handleDraftChange(dateISO, shiftType, operatorId) {
    const op = operators.find(o => o.id === operatorId)
    if (!op) return
    setDraftSchedule(prev => ({
      ...prev,
      [dateISO]: {
        ...prev[dateISO],
        [shiftType]: {
          operatorId,
          operatorName: op.full_name,
          extras: prev[dateISO]?.[shiftType]?.extras ?? [],
        },
      },
    }))
  }

  function handleDraftAddExtra(dateISO, shiftType, operatorId) {
    const op = operators.find(o => o.id === operatorId)
    if (!op) return
    setDraftSchedule(prev => {
      const slot = prev[dateISO]?.[shiftType]
      if (!slot) return prev
      const extras = slot.extras ?? []
      if (slot.operatorId === operatorId || extras.some(e => e.operatorId === operatorId)) return prev
      return {
        ...prev,
        [dateISO]: {
          ...prev[dateISO],
          [shiftType]: { ...slot, extras: [...extras, { operatorId, operatorName: op.full_name }] },
        },
      }
    })
  }

  function handleDraftRemoveExtra(dateISO, shiftType, operatorId) {
    setDraftSchedule(prev => {
      const slot = prev[dateISO]?.[shiftType]
      if (!slot) return prev
      return {
        ...prev,
        [dateISO]: {
          ...prev[dateISO],
          [shiftType]: { ...slot, extras: (slot.extras ?? []).filter(e => e.operatorId !== operatorId) },
        },
      }
    })
  }

  function downloadPDF() {
    const doc       = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const structName = structure?.name ?? 'Struttura'
    const monthLabel = new Date(selectedYear, selectedMonth, 1)
      .toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })

    const DAY_SHORT  = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
    const SHIFTS_PDF = [
      { type: 'mattina',    label: 'Mattina',    hours: '08–14' },
      { type: 'pomeriggio', label: 'Pomeriggio', hours: '14–20' },
      { type: 'notte',      label: 'Notte',      hours: '20–08' },
    ]
    const today = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })

    weeks.forEach((wDays, wi) => {
      if (wi > 0) doc.addPage()

      const wStart = new Date(wDays[0] + 'T12:00:00')
      const wEnd   = new Date(wDays[6] + 'T12:00:00')
      const range  = fmtWeekRange(wStart)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(13)
      doc.setTextColor(30, 58, 95)
      doc.text(structName, 14, 14)

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(113, 128, 150)
      doc.text(`${monthLabel}  •  Settimana ${wi + 1}  •  ${range}`, 14, 20)

      const head = [['Turno', ...wDays.map((iso, i) => {
        const d = new Date(iso + 'T12:00:00')
        return DAY_SHORT[i] + ' ' + d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
      })]]

      const body = SHIFTS_PDF.map(shift => [
        { content: `${shift.label}\n${shift.hours}`, styles: { fontStyle: 'bold', fillColor: [240, 244, 248] } },
        ...wDays.map(iso => {
          const rows = scheduleMap[iso]?.[shift.type] ?? []
          return rows.length ? rows.map(r => r.full_name).join('\n') : '—'
        }),
      ])

      autoTable(doc, {
        head, body, startY: 25, theme: 'grid',
        styles: {
          fontSize: 8, cellPadding: { top: 3, right: 4, bottom: 3, left: 4 },
          valign: 'top', lineColor: [226, 232, 240], lineWidth: 0.3, textColor: [26, 32, 44],
        },
        headStyles: {
          fillColor: [30, 58, 95], textColor: 255, fontStyle: 'bold',
          fontSize: 8, halign: 'center', cellPadding: { top: 4, right: 4, bottom: 4, left: 4 },
        },
        columnStyles: { 0: { cellWidth: 26 } },
        alternateRowStyles: { fillColor: [255, 255, 255] },
      })

      const pageH = doc.internal.pageSize.height
      doc.setFontSize(7)
      doc.setTextColor(160, 174, 192)
      doc.text(`Generato il ${today}`, 14, pageH - 5)
    })

    doc.save(`turni-${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}.pdf`)
  }

  async function handleClearMonth() {
    setClearing(true); setError('')
    const { error: err } = await supabase.from('schedules')
      .delete()
      .eq('structure_id', structureId)
      .gte('date', fetchStart)
      .lte('date', fetchEnd)
    if (err) {
      setError('Errore nella pulizia: ' + err.message)
      setClearing(false)
      setShowClearConfirm(false)
      return
    }
    setSchedules([])
    setDraftSchedule(null)
    setDraftWeekIdx(null)
    setRelaxedPreferences([])
    setWeekendOffIdsByWeek([])
    setWeekendOnIdsByWeek([])
    setClearing(false)
    setShowClearConfirm(false)
    setClearSuccess(true)
    setTimeout(() => setClearSuccess(false), 4000)
  }

  async function handlePublish() {
    setPublishing(true); setError('')

    // Giorni da pubblicare = tutti i giorni presenti in bozza
    const draftDays = Object.keys(draftSchedule ?? {}).sort()
    if (!draftDays.length) { setPublishing(false); return }

    // ── Controllo copertura (eseguito nel handler, non solo in UI) ─────────
    // Blocca la pubblicazione se anche un solo turno è scoperto tra i giorni in bozza.
    // Questo check avviene qui (non solo nel disabled del bottone) per robustezza.
    const shiftTypes = FIXED_SHIFTS.map(s => s.type)
    const missingSlots = []
    for (const iso of draftDays) {
      const dayData = draftSchedule[iso]
      for (const t of shiftTypes) {
        if (!dayData?.[t]?.operatorId) missingSlots.push({ iso, shift: t })
      }
    }
    if (missingSlots.length > 0) {
      const DAY_ABBR = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']
      const details = missingSlots.map(({ iso, shift }) => {
        const d = new Date(iso + 'T12:00:00')
        return `${DAY_ABBR[d.getDay()]} ${d.getDate()} ${d.toLocaleDateString('it-IT', { month: 'short' })} – ${shift}`
      }).join(', ')
      setError(`Turni scoperti (${missingSlots.length}): ${details}. Assegna manualmente prima di pubblicare.`)
      setPublishing(false)
      return
    }

    // ── Rimuovi pubblicazioni esistenti per i giorni in bozza ─────────────
    const { error: delErr } = await supabase.from('schedules')
      .delete()
      .eq('structure_id', structureId)
      .in('date', draftDays)
      .eq('is_locked', false)
      .neq('shift_type', 'speciale')

    if (delErr) {
      setError('Errore nella pulizia: ' + delErr.message)
      setPublishing(false)
      return
    }

    // ── Inserisci i turni dalla bozza ──────────────────────────────────────
    const VALID_SHIFTS = new Set(['mattina', 'pomeriggio', 'notte', 'speciale'])
    const pubDaySet = new Set(draftDays)
    const rows = Object.entries(draftSchedule)
      .filter(([date]) => pubDaySet.has(date))
      .flatMap(([date, shifts]) =>
        Object.entries(shifts).flatMap(([shift_type, slot]) => {
          const normalized = normalizeShift(shift_type)
          if (!VALID_SHIFTS.has(normalized)) return []
          const base  = [{ structure_id: structureId, user_id: slot.operatorId, date, shift_type: normalized, published: true }]
          const extra = (slot.extras ?? []).map(e => ({
            structure_id: structureId, user_id: e.operatorId, date, shift_type: normalized, published: true,
          }))
          return [...base, ...extra]
        })
      )

    const CHUNK = 500
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error: err } = await supabase.from('schedules').insert(rows.slice(i, i + CHUNK))
      if (err) {
        setError('Errore nel salvataggio: ' + err.message)
        setPublishing(false)
        return
      }
    }

    // ── Aggiorna tracciamento rotazione domenicale ─────────────────────────
    // Usa draftWeekIdx (settimana che è stata generata) anziché activeWeekIdx
    // (che potrebbe essere cambiato se l'utente ha navigato tra le settimane).
    if (draftWeekIdx != null) {
      const wOffIds = weekendOffIdsByWeek[draftWeekIdx] ?? []
      const wSatISO = weeks[draftWeekIdx]?.[5]
      if (wOffIds.length > 0 && wSatISO) {
        await supabase.rpc('set_weekend_off', {
          p_user_ids: wOffIds,
          p_date:     wSatISO,
        })
      }
    }

    // ── Notifica operatori (non bloccante) ────────────────────────────────
    await supabase.rpc('publish_week_schedules', {
      p_structure_id: structureId,
      p_week_start:   draftDays[0],
      p_week_end:     draftDays[draftDays.length - 1],
    })

    playAudio('success')
    setDraftSchedule(null)
    setDraftWeekIdx(null)
    setRelaxedPreferences([])
    setWeekendOffIdsByWeek([])
    setWeekendOnIdsByWeek([])
    setWeekendViolations([])
    setSplitWeekendNames([])
    setWeekEquityWarnings([])
    setPublishing(false)
    await fetchSchedules()
  }

  const commonDayProps = { scheduleMap, operators, colorMap, apptMap, weeklyHoursMap,
    weekendPrioritySet, otherWeekendDayAssignedIds,
    onAdd: handleAddShift, onRemove: handleRemoveShift,
    onToggleLock: canWrite ? handleToggleLock : undefined,
    onAddSpecial: setSpecialDate, savingSlot, canWrite,
    onDraftAddExtra: handleDraftAddExtra, onDraftRemoveExtra: handleDraftRemoveExtra,
    checkAvailability: checkOperatorAvailability,
    unassignedDays,
    onEditSpecial: row => setEditSpecialRow(row) }

  return (
    <div className="flex flex-col gap-0">

      {/* Modale diagnostica solver */}
      {solverDiag && (
        <SolverDiagModal diag={solverDiag} onClose={() => setSolverDiag(null)} />
      )}

      {/* Selettore struttura */}
      {structures.length > 1 && (
        <div className="px-4 pt-4 pb-2">
          <select value={structureId ?? ''} onChange={e => setStructureId(Number(e.target.value))}
            className="w-full h-11 px-3 rounded-xl border border-[#e2e8f0] bg-white text-sm
                       outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                       transition-colors appearance-none text-[#1a202c]">
            {structures.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}

      {/* ── Toolbar manager: sticky, navbar enterprise ──────────────────────── */}
      {canWrite ? (
        <div className="sticky top-0 z-20 bg-white border-b border-slate-100 print:hidden">

          {/* Riga 1: navigazione mese */}
          <div className="flex items-center gap-2 px-4 pt-3 pb-2">
            {/* Chevron sx */}
            <button type="button"
              onClick={() => {
                if (selectedMonth === 0) { setSelectedYear(y => y - 1); setSelectedMonth(11) }
                else setSelectedMonth(m => m - 1)
              }}
              className="w-8 h-8 flex items-center justify-center rounded-lg
                         text-slate-400 hover:text-slate-700 hover:bg-slate-100
                         active:bg-slate-200 transition-colors shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            {/* Mese centrato */}
            <div className="flex-1 text-center">
              <span className="text-sm font-semibold text-slate-800 capitalize tracking-tight">
                {new Date(selectedYear, selectedMonth, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}
              </span>
            </div>

            {/* Chevron dx */}
            <button type="button"
              onClick={() => {
                if (selectedMonth === 11) { setSelectedYear(y => y + 1); setSelectedMonth(0) }
                else setSelectedMonth(m => m + 1)
              }}
              className="w-8 h-8 flex items-center justify-center rounded-lg
                         text-slate-400 hover:text-slate-700 hover:bg-slate-100
                         active:bg-slate-200 transition-colors shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Riga 2: action bar */}
          <div className="flex items-center gap-2 px-4 pb-3 overflow-x-auto scrollbar-hide">

            {/* Primario: Genera Turni — a sinistra */}
            <button type="button" onClick={handleGenerate} disabled={generating || !!draftSchedule}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg shrink-0
                         bg-[#1e293b] text-white text-xs font-semibold
                         active:bg-[#0f172a] disabled:opacity-50 transition-colors">
              {generating ? (
                <div className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin shrink-0" />
              ) : (
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              )}
              {generating ? 'Generando…' : 'Genera Settimana'}
            </button>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Secondari: raggruppati a destra */}
            {/* PDF */}
            <button type="button" onClick={downloadPDF}
              disabled={schedules.length === 0}
              title="Scarica PDF turni mensili"
              className="flex items-center gap-1 h-8 px-2.5 rounded-lg shrink-0
                         border border-slate-200 bg-white text-slate-500 text-xs font-medium
                         active:bg-slate-50 disabled:opacity-40 transition-colors">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              <span>PDF</span>
            </button>

            {/* Vincoli */}
            <button type="button" onClick={() => setShowVincoli(true)}
              className="flex items-center gap-1 h-8 px-2.5 rounded-lg shrink-0
                         border border-slate-200 bg-white text-slate-600 text-xs font-medium
                         active:bg-slate-50 transition-colors">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Vincoli</span>
            </button>

            {/* Svuota */}
            <button type="button" onClick={() => setShowClearConfirm(true)}
              title="Elimina tutti i turni del mese"
              className="flex items-center gap-1 h-8 px-2.5 rounded-lg shrink-0
                         border border-slate-200 bg-white text-red-400 text-xs font-medium
                         active:bg-red-50 transition-colors">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>Svuota</span>
            </button>

            {/* Impostazioni solver */}
            <button type="button" onClick={() => setShowSolverRules(true)}
              title="Impostazioni ottimizzazione"
              className="w-8 h-8 flex items-center justify-center rounded-lg shrink-0
                         border border-slate-200 bg-white text-slate-400
                         active:bg-slate-50 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>
      ) : (
        /* ── Navigazione mese standard per operatori (invariata) ── */
        <div className="flex items-center gap-3 px-4 md:px-6 py-3 print:hidden">
          <button type="button"
            onClick={() => {
              if (selectedMonth === 0) { setSelectedYear(y => y - 1); setSelectedMonth(11) }
              else setSelectedMonth(m => m - 1)
            }}
            className="w-9 h-9 flex items-center justify-center rounded-xl border border-[#e2e8f0]
                       bg-white active:bg-[#f0f4f8] transition-colors shrink-0">
            <svg className="w-4 h-4 text-[#1e3a5f]" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 text-center">
            <p className="text-sm font-bold text-[#1a202c] capitalize">
              {new Date(selectedYear, selectedMonth, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}
            </p>
            {operators.length > 0 && !loading && (
              <p className="text-xs text-[#a0aec0] mt-0.5">
                {operators.length} operator{operators.length !== 1 ? 'i' : 'e'}
                {' · '}{monthDays.length} giorni
                {structure ? ` · ${structure.name}` : ''}
              </p>
            )}
          </div>
          <button type="button"
            onClick={() => {
              if (selectedMonth === 11) { setSelectedYear(y => y + 1); setSelectedMonth(0) }
              else setSelectedMonth(m => m + 1)
            }}
            className="w-9 h-9 flex items-center justify-center rounded-xl border border-[#e2e8f0]
                       bg-white active:bg-[#f0f4f8] transition-colors shrink-0">
            <svg className="w-4 h-4 text-[#1e3a5f]" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <button type="button" onClick={downloadPDF}
            disabled={schedules.length === 0}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-[#e2e8f0]
                       bg-white hover:bg-[#f0f4f8] active:bg-[#e8edf2] transition-colors shrink-0
                       disabled:opacity-40 disabled:cursor-not-allowed"
            title="Scarica PDF turni mensili">
            <svg className="w-3.5 h-3.5 text-[#1e3a5f]" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            <span className="text-xs font-semibold text-[#1e3a5f]">PDF</span>
          </button>
        </div>
      )}

      {error && (
        <div className="mx-4 md:mx-6 mb-2 px-3 py-2 rounded-xl bg-red-50 border border-red-100 print:hidden">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {clearSuccess && (
        <div className="mx-4 md:mx-6 mb-2 px-3 py-2.5 rounded-xl bg-green-50 border border-green-200 flex items-center gap-2 print:hidden">
          <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-xs text-green-700 font-medium">
            Mese resettato con successo. Ora puoi ricominciare la programmazione.
          </p>
        </div>
      )}

      {/* Modal conferma svuota settimana */}
      {showClearConfirm && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-[#1a202c]">Svuota mese</p>
                <p className="text-[11px] text-[#718096] mt-0.5">
                  {monthStart} → {monthEnd}
                </p>
              </div>
            </div>
            <p className="text-sm text-[#4a5568] leading-relaxed">
              Sei sicuro di voler eliminare <strong>tutti i turni</strong> del mese selezionato?
              L'azione è <strong>irreversibile</strong>.
            </p>
            <div className="flex gap-2 mt-1">
              <button type="button"
                onClick={() => setShowClearConfirm(false)}
                disabled={clearing}
                className="flex-1 h-11 rounded-xl border border-[#e2e8f0] text-[#718096]
                           font-semibold text-sm active:bg-[#f0f4f8] transition-colors disabled:opacity-50">
                Annulla
              </button>
              <button type="button"
                onClick={handleClearMonth}
                disabled={clearing}
                className="flex-1 h-11 rounded-xl bg-red-500 text-white font-semibold text-sm
                           active:bg-red-600 transition-colors disabled:opacity-60
                           flex items-center justify-center gap-2">
                {clearing && (
                  <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin shrink-0" />
                )}
                {clearing ? 'Eliminazione…' : 'Sì, svuota'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── EMPTY STATE: nessun operatore ───────────────────────────────────── */}
      {!loading && operators.length === 0 ? (
        <div className="px-6 py-16 flex flex-col items-center text-center gap-5">
          <div className="w-16 h-16 rounded-2xl bg-[#eef2f7] flex items-center justify-center">
            <svg className="w-8 h-8 text-[#a0aec0]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          </div>
          <div>
            <p className="font-bold text-[#1a202c] text-base">La tua squadra è vuota</p>
            <p className="text-sm text-[#718096] mt-1.5 leading-relaxed max-w-xs mx-auto">
              Inizia aggiungendo i tuoi operatori per poter generare i turni settimanali.
            </p>
          </div>
          {onGoToTeam && (
            <button
              type="button"
              onClick={onGoToTeam}
              className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-[#1e3a5f] text-white
                         font-semibold text-sm active:bg-[#152b47] transition-colors shadow-sm"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21a12.318 12.318 0 01-6.374-1.766z" />
              </svg>
              Aggiungi Operatore
            </button>
          )}
        </div>
      ) : (
        <>

      {/* ── Mini-map mensile ─────────────────────────────────────────────────── */}
      <div className="px-4 md:px-6 pb-2 print:hidden">
        <div className="flex flex-wrap gap-1">
          {monthDays.map(iso => {
            const daySlots = scheduleMap[iso] ?? {}
            const draftSlots = draftSchedule?.[iso] ?? {}
            const allSlots = { ...daySlots, ...draftSlots }
            const shiftCount = ['mattina','pomeriggio','notte'].filter(s =>
              (scheduleMap[iso]?.[s]?.length > 0) ||
              (draftSchedule?.[iso]?.[s]?.operatorId)
            ).length
            const todayISO = toISO(new Date())
            const isPast = iso <= todayISO
            let bg = 'bg-gray-200'
            if (shiftCount === 3) bg = 'bg-green-400'
            else if (shiftCount > 0) bg = 'bg-amber-400'
            else if (isPast) bg = 'bg-red-300'
            // Trova la settimana e fai scroll
            const wIdx = weeks.findIndex(w => w.includes(iso))
            return (
              <button
                key={iso}
                title={iso}
                onClick={() => {
                  setExpandedWeekIdx(wIdx)
                  setTimeout(() => weekRefs.current[wIdx]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
                }}
                className={`w-5 h-5 rounded-sm ${bg} hover:opacity-80 transition-opacity`}
              />
            )
          })}
        </div>
        <div className="flex items-center gap-3 mt-1.5">
          <span className="flex items-center gap-1 text-[10px] text-[#a0aec0]"><span className="w-3 h-3 rounded-sm bg-green-400 inline-block" /> Completo</span>
          <span className="flex items-center gap-1 text-[10px] text-[#a0aec0]"><span className="w-3 h-3 rounded-sm bg-amber-400 inline-block" /> Parziale</span>
          <span className="flex items-center gap-1 text-[10px] text-[#a0aec0]"><span className="w-3 h-3 rounded-sm bg-red-300 inline-block" /> Buco</span>
          <span className="flex items-center gap-1 text-[10px] text-[#a0aec0]"><span className="w-3 h-3 rounded-sm bg-gray-200 inline-block" /> Vuoto</span>
        </div>
      </div>

      {/* ── Layout principale: accordion + sidebar ───────────────────────────── */}
      <div className="flex gap-4 px-2 md:px-4 pb-8 items-start">

        {/* ── Accordion settimane ───────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          {loading
            ? <div className="px-2 print:hidden"><GridSkeleton count={7} /></div>
            : weeks.map((wDays, wi) => {
              const isExpanded = expandedWeekIdx === wi
              const wStart = new Date(wDays[0] + 'T12:00:00')
              const wEnd   = new Date(wDays[6] + 'T12:00:00')
              const wRange = fmtWeekRange(wStart)
              const inMonth = wDays.filter(iso => monthDays.includes(iso))

              // Stato della settimana per il badge
              const complete = inMonth.filter(iso =>
                ['mattina','pomeriggio','notte'].every(s =>
                  scheduleMap[iso]?.[s]?.length > 0 || draftSchedule?.[iso]?.[s]?.operatorId
                )
              ).length
              const hasDraft = draftSchedule && inMonth.some(iso => draftSchedule[iso])
              const badgeLabel = hasDraft ? 'Bozza'
                : complete === inMonth.length ? 'Completo'
                : complete > 0 ? 'Parziale'
                : 'Vuoto'
              const badgeColor = hasDraft ? 'bg-blue-100 text-blue-700'
                : complete === inMonth.length ? 'bg-green-100 text-green-700'
                : complete > 0 ? 'bg-amber-100 text-amber-700'
                : 'bg-gray-100 text-gray-500'

              return (
                <div
                  key={wi}
                  ref={el => weekRefs.current[wi] = el}
                  className="bg-white rounded-2xl border border-[#e2e8f0] overflow-hidden"
                >
                  {/* Header accordion */}
                  <button
                    type="button"
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#f8f9fa] transition-colors"
                    onClick={() => setExpandedWeekIdx(isExpanded ? null : wi)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-[#1e3a5f]">Settimana {wi + 1}</span>
                      <span className="text-xs text-[#a0aec0]">{wRange}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {inMonth.some(iso => unassignedDays.has(iso)) && (
                        <span
                          className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0"
                          title="Turni non coperti dal solver — assegna manualmente"
                        />
                      )}
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeColor}`}>
                        {badgeLabel}
                      </span>
                      <svg className={`w-4 h-4 text-[#a0aec0] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {/* Body accordion espanso */}
                  {isExpanded && (
                    <div className="border-t border-[#f0f4f8]">
                      {/* Desktop: 7 colonne */}
                      <div className="hidden md:block bg-gray-50 py-3">
                        <div className="grid grid-cols-7 gap-2 px-3">
                          {wDays.map(iso => {
                            const day = new Date(iso + 'T12:00:00')
                            const isOverflow = !monthDays.includes(iso)
                            return (
                              <div key={iso} className={isOverflow ? 'ring-1 ring-inset ring-blue-100 rounded-xl' : ''}>
                                <DayColumn day={day} {...commonDayProps} compact
                                  draftDay={draftSchedule?.[iso]}
                                  onDraftChange={handleDraftChange} />
                              </div>
                            )
                          })}
                        </div>
                      </div>
                      {/* Mobile: lista verticale (include overflow) */}
                      <div className="md:hidden px-3 flex flex-col gap-3 py-3">
                        {wDays.map(iso => (
                          <DayColumn key={iso} day={new Date(iso + 'T12:00:00')}
                            {...commonDayProps} compact={false}
                            draftDay={draftSchedule?.[iso]}
                            onDraftChange={handleDraftChange} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          }
        </div>

        {/* ── Sidebar riepilogo operatori (sticky, solo desktop) ─────────────── */}
        {operators.length > 0 && (
          <div className="hidden lg:block w-56 shrink-0 sticky top-4">
            <div className="bg-white rounded-2xl border border-[#e2e8f0] p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#a0aec0] mb-2">
                Riepilogo mese
              </p>
              <div className="flex flex-col gap-2">
                {operators.map(op => {
                  const assignedH  = monthlyHoursMap[op.id] ?? 0
                  const contractH  = (op.max_hours_per_week ?? 0) * weeks.length
                  const rawPct     = contractH > 0 ? Math.round(assignedH / contractH * 100) : 0
                  const pct        = Math.min(100, rawPct)
                  const over       = rawPct > 100
                  const freeSun    = monthlySundayStats.freeSundays[op.id] ?? 0
                  const totalSun   = weeks.length
                  const hasSplit   = monthlySundayStats.splitWeeks[op.id] ?? false
                  const barColor   = over || rawPct >= 100 ? 'bg-red-400' : rawPct >= 85 ? 'bg-amber-400' : 'bg-green-400'
                  const textColor  = over || rawPct >= 100 ? 'text-red-500' : rawPct >= 85 ? 'text-amber-500' : 'text-[#a0aec0]'
                  return (
                    <div key={op.id}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[11px] font-medium text-[#1a202c] truncate max-w-[100px]">
                          {op.full_name}
                        </span>
                        <span
                          title={hasSplit ? 'Ha lavorato sia Sabato che Domenica in almeno una settimana' : undefined}
                          className={`text-[10px] shrink-0 ml-1 ${hasSplit ? 'text-amber-500 font-semibold' : 'text-[#718096]'}`}
                        >
                          {freeSun}/{totalSun} Dom.{hasSplit ? ' ⚠' : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className={`text-[9px] shrink-0 w-16 text-right font-medium ${textColor}`}>
                          {fmtH(assignedH)}{contractH > 0 ? `/${fmtH(contractH)}h` : 'h'}
                          {over && <span className="ml-0.5">!</span>}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ── Riepilogo mese (solo mobile, sotto tutto, larghezza piena) ────────── */}
      {operators.length > 0 && !loading && (
        <div className="lg:hidden px-2 md:px-4 pb-8">
          <MobileRiepilogo
            operators={operators}
            monthlyHoursMap={monthlyHoursMap}
            monthlySundayStats={monthlySundayStats}
            weeks={weeks}
          />
        </div>
      )}

        </>
      )}

      {/* Modal eventi speciali */}
      {specialDate !== null && (
        <SpecialEventModal operators={operators} defaultDate={specialDate}
          onSave={handleAddSpecial} onClose={() => setSpecialDate(null)} />
      )}
      {editSpecialRow !== null && (() => {
        const { title, timeRange } = parseSpecialLabel(editSpecialRow.label)
        const [startTime, endTime] = (timeRange ?? '').split(' – ')
        return (
          <SpecialEventModal
            operators={operators}
            defaultDate={editSpecialRow.date}
            initialValues={{
              date:      editSpecialRow.date,
              userId:    editSpecialRow.user_id,
              title:     title ?? '',
              startTime: startTime ?? '',
              endTime:   endTime ?? '',
            }}
            onSave={vals => handleUpdateSpecial({ oldRow: editSpecialRow, ...vals })}
            onClose={() => setEditSpecialRow(null)}
          />
        )
      })()}

      {/* Modal vincoli */}
      {showVincoli && (
        <VincoliModal operators={operators} structureId={structureId} approvedAbsences={approvedAbsences}
          onSaved={savedConstraints => {
            // savedConstraints = { [opId]: { max_hours_per_week, weekly_rest_day, ... } }
            // Merge in-memory: aggiorna operators con i valori appena scritti sul DB via RPC.
            // Il constraintsInitialized ref nel modal blocca il reset del useEffect,
            // quindi il campo non sparisce anche se operators cambia.
            if (savedConstraints) {
              setOperators(prev => prev.map(op => {
                const c = savedConstraints[op.id]
                if (!c) return op
                return {
                  ...op,
                  max_hours_per_week: c.max_hours_per_week ? parseInt(c.max_hours_per_week, 10) : null,
                  weekly_rest_day:    c.weekly_rest_day  || null,
                  shift_preference:   c.shift_preference || null,
                  shift_avoid:        c.shift_avoid      || null,
                  recurring_shifts:   c.recurring_shifts ?? [],
                }
              }))
            } else {
              fetchOperators()
            }
          }}
          onClose={() => setShowVincoli(false)} />
      )}

      {/* Modal logica solver */}
      {showSolverRules && (
        <SolverRulesModal onClose={() => setShowSolverRules(false)} />
      )}

      {/* Banner bozza ripristinata da localStorage */}
      {draftRestored && (
        <div className="mx-4 md:mx-6 mb-2 px-3 py-2 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center gap-2 print:hidden">
          <span className="text-base shrink-0">💾</span>
          <p className="text-xs text-indigo-700 font-medium">
            Bozza ripristinata automaticamente — le modifiche precedenti sono state recuperate.
          </p>
        </div>
      )}

      {/* Banner preferenze non rispettate */}
      {draftSchedule && relaxedPreferences.length > 0 && (
        <div className="mx-4 md:mx-6 mb-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2 print:hidden">
          <span className="text-base shrink-0">⚠️</span>
          <p className="text-xs text-amber-700 leading-relaxed">
            <span className="font-semibold">Preferenze non rispettate:</span>{' '}
            {relaxedPreferences.join(', ')} — i vincoli degli altri operatori non lasciavano spazio sufficiente.
          </p>
        </div>
      )}

      {/* Banner rotazione domenicale */}
      {draftSchedule && weekendOffNames.length > 0 && (
        <div className="mx-4 md:mx-6 mb-2 px-3 py-2 rounded-xl bg-sky-50 border border-sky-200 flex items-start gap-2 print:hidden">
          <span className="text-base shrink-0">🏖</span>
          <p className="text-xs text-sky-700 leading-relaxed">
            <span className="font-semibold">Domenica libera:</span>{' '}
            {weekendOffNames.join(', ')}
          </p>
        </div>
      )}

      {/* Alert violazioni V12 — operatori "reduci da weekend" forzati a lavorare */}
      {draftSchedule && weekendViolations.length > 0 && (
        <div className="mx-4 md:mx-6 mb-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2 print:hidden">
          <span className="text-base shrink-0">⚠️</span>
          <p className="text-xs text-amber-800 leading-relaxed">
            <span className="font-semibold">Attenzione — vincolo weekend forzato:</span>{' '}
            {weekendViolations.join(', ')} {weekendViolations.length === 1 ? 'ha' : 'hanno'} lavorato
            il weekend scorso ma {weekendViolations.length === 1 ? 'è stata assegnata' : 'sono stati assegnati'} anche
            questo weekend perché non c'erano altre risorse disponibili.
          </p>
        </div>
      )}

      {/* Alert weekend spezzato — operatori assegnati sia Sabato che Domenica */}
      {draftSchedule && splitWeekendNames.length > 0 && (
        <div className="mx-4 md:mx-6 mb-2 px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-200 flex items-start gap-2 print:hidden">
          <span className="text-base shrink-0">ℹ️</span>
          <p className="text-xs text-blue-800 leading-relaxed">
            <span className="font-semibold">Nota — weekend completo:</span>{' '}
            {splitWeekendNames.join(', ')} {splitWeekendNames.length === 1 ? 'è stato assegnato' : 'sono stati assegnati'} a
            entrambi i giorni del weekend per mancanza di personale disponibile.
          </p>
        </div>
      )}

      {/* Banner equità weekend mensile */}
      {draftSchedule && weekEquityWarnings.length > 0 && (
        <div className="mx-4 md:mx-6 mb-2 px-3 py-2 rounded-xl bg-purple-50 border border-purple-200 flex items-start gap-2 print:hidden">
          <span className="text-base shrink-0">⚖️</span>
          <p className="text-xs text-purple-800 leading-relaxed">
            <span className="font-semibold">Equità domenicale:</span>{' '}
            {weekEquityWarnings.join(', ')} {weekEquityWarnings.length === 1 ? 'ha' : 'hanno'} meno
            di 2 domeniche libere questo mese.
          </p>
        </div>
      )}

      {/* Banner turni domenicali vuoti (V12 cross-struttura) */}
      {draftSchedule && sundayWarnings.length > 0 && (
        <div className="mx-4 md:mx-6 mb-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 print:hidden">
          <span className="text-base shrink-0">🚨</span>
          <div className="text-xs text-red-800 leading-relaxed">
            <span className="font-semibold">Turni domenicali non assegnati:</span>
            <ul className="mt-1 list-disc list-inside">
              {sundayWarnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        </div>
      )}

      {/* Pop-up collisione cross-struttura (hard block o soft confirm) */}
      {collisionBlock && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl shrink-0">{collisionBlock.soft ? '⚠️' : '🚫'}</span>
              <div>
                <p className="text-sm font-bold text-[#1a202c]">
                  {collisionBlock.soft ? 'Attenzione' : 'Operazione non consentita'}
                </p>
                <p className="text-xs text-[#718096] mt-1 leading-relaxed">
                  {collisionBlock.soft
                    ? <><strong>{collisionBlock.opName}</strong> ha già un turno durante la giornata in un'altra struttura. Vuoi aggiungerlo lo stesso?</>
                    : <><strong>{collisionBlock.opName}</strong> ha già il turno <strong>{collisionBlock.shiftLabel}</strong> in <strong>{collisionBlock.structureName}</strong> — non è possibile assegnare lo stesso turno in due strutture.</>
                  }
                </p>
              </div>
            </div>
            {collisionBlock.soft ? (
              <div className="flex gap-2">
                <button type="button" onClick={() => setCollisionBlock(null)}
                  className="flex-1 h-11 rounded-xl border border-[#e2e8f0] text-[#718096] font-semibold text-sm
                             active:bg-gray-50 transition-colors">
                  Annulla
                </button>
                <button type="button" onClick={async () => {
                    const { pendingUserId, pendingShiftType, pendingDateISO } = collisionBlock
                    setCollisionBlock(null)
                    const key = `${pendingDateISO}|${pendingShiftType}`
                    setSavingSlot(key)
                    const { error: err } = await supabase.from('schedules').insert({
                      structure_id: structureId, user_id: pendingUserId,
                      date: pendingDateISO, shift_type: pendingShiftType,
                    })
                    if (err && !err.code?.includes('23505')) setError('Errore nel salvataggio.')
                    else await fetchSchedules()
                    setSavingSlot(null)
                  }}
                  className="flex-1 h-11 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                             active:bg-[#152b47] transition-colors">
                  Conferma
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setCollisionBlock(null)}
                className="w-full h-11 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                           active:bg-[#152b47] transition-colors">
                Ho capito
              </button>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Pop-up avviso turni non assegnati */}
      {showUnassignedAlert && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl shrink-0">⚠️</span>
              <div>
                <p className="text-sm font-bold text-[#1a202c]">Turni non assegnati</p>
                <p className="text-xs text-[#718096] mt-1 leading-relaxed">
                  Il Solver non ha potuto assegnare <strong>{sundayWarnings.length} turni</strong> (specialmente
                  le domeniche) senza violare i vincoli di riposo.
                  Controlla i giorni evidenziati in rosso nella griglia.
                </p>
              </div>
            </div>
            <div className="max-h-40 overflow-y-auto rounded-xl bg-red-50 border border-red-200 p-3">
              <ul className="text-[11px] text-red-700 space-y-1">
                {sundayWarnings.map((w, i) => <li key={i} className="leading-relaxed">{w}</li>)}
              </ul>
            </div>
            <p className="text-[11px] text-[#a0aec0] leading-relaxed">
              Assegna manualmente i turni mancanti cliccando sul pulsante "+" nei giorni in rosso,
              poi potrai pubblicare.
            </p>
            <button type="button" onClick={() => setShowUnassignedAlert(false)}
              className="w-full h-11 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                         active:bg-[#152b47] transition-colors">
              Ho capito
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Barra sticky bozza AI */}
      {draftSchedule && (
        <div className="sticky bottom-0 z-40 bg-white border-t border-[#e2e8f0] shadow-lg px-4 md:px-6 py-3 flex gap-3 print:hidden">
          <button type="button" disabled={publishing}
            onClick={() => {
              setDraftSchedule(null)
              setDraftWeekIdx(null)
              setRelaxedPreferences([])
              setWeekendViolations([])
              setWeekendOffIdsByWeek([])
              setWeekendOnIdsByWeek([])
              setSplitWeekendNames([])
              setWeekEquityWarnings([])
              setSundayWarnings([])
              setShowUnassignedAlert(false)
            }}
            className="flex-1 h-11 rounded-xl border border-[#e2e8f0] text-[#718096]
                       font-semibold text-sm active:bg-[#f0f4f8] transition-colors disabled:opacity-50">
            × Annulla bozza
          </button>
          <div className="flex-[2] flex flex-col items-stretch">
            <button type="button"
              disabled={publishing || hasUnassignedSlots}
              onClick={handlePublish}
              className={`h-11 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2
                ${hasUnassignedSlots
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-[#1e3a5f] text-white active:bg-[#152b47] disabled:opacity-60'}`}>
              {publishing && (
                <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin shrink-0" />
              )}
              {publishing ? 'Pubblicazione…' : '✓ Conferma e Pubblica'}
            </button>
            {hasUnassignedSlots && (
              <p className="text-[10px] text-red-600 mt-1 text-center leading-tight">
                {unassignedSlots.size} turni scoperti — assegna manualmente prima di pubblicare.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
