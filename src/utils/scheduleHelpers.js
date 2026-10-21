/**
 * scheduleHelpers — utility condivise tra ShiftSchedule e generateMonthlySchedule
 */

export function toISO(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function getMondayOf(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return d
}

export function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

/**
 * Calcola i bounds del mese:
 * - monthStart/monthEnd: ISO date string del 1° e ultimo giorno
 * - monthDays: tutti i giorni del mese come ISO string[]
 * - weeks: array di 4-5 settimane, ognuna con 7 ISO date strings
 *   (può includere giorni del mese precedente/successivo per completare la settimana)
 */
export function getMonthBounds(year, month) {
  const firstDay = new Date(year, month, 1)
  const lastDay  = new Date(year, month + 1, 0)
  const monthStart = toISO(firstDay)
  const monthEnd   = toISO(lastDay)

  const monthDays = []
  for (let d = new Date(firstDay); toISO(d) <= monthEnd; d.setDate(d.getDate() + 1))
    monthDays.push(toISO(new Date(d)))

  const weeks = []
  const wCursor = getMondayOf(new Date(firstDay))
  while (toISO(wCursor) <= monthEnd) {
    const w = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(wCursor)
      d.setDate(d.getDate() + i)
      return toISO(d)
    })
    weeks.push(w)
    wCursor.setDate(wCursor.getDate() + 7)
  }

  return { monthStart, monthEnd, monthDays, weeks }
}

/**
 * Estrae gli ID degli operatori che hanno lavorato nel weekend (Sab/Dom)
 * di una settimana, da un oggetto schedule { [dateISO]: { [shift]: {operatorId, extras} } }
 * @deprecated Usa extractSundayWorkedIds — la rotazione è ora basata sulla sola Domenica.
 */
export function extractWeekendWorkedIds(schedule, weekDaysISO) {
  const worked = new Set()
  for (const iso of weekDaysISO) {
    const dow = new Date(iso + 'T12:00:00').getDay()
    if (dow !== 0 && dow !== 6) continue
    const daySlots = schedule[iso]
    if (!daySlots) continue
    for (const slot of Object.values(daySlots)) {
      if (slot?.operatorId) worked.add(slot.operatorId)
      for (const e of slot?.extras ?? []) worked.add(e.operatorId)
    }
  }
  return worked
}

/**
 * Somma le ore già pubblicate (o in bozza) per le settimane che precedono
 * la settimana target, all'interno del mese corrente.
 *
 * Usato dalla generazione settimanale per inizializzare monthHoursConsumed
 * con le ore già consumate nelle settimane precedenti, così V4m (budget mensile)
 * funziona correttamente anche quando si genera una singola settimana.
 *
 * @param {Array}    publishedRows      Righe turni dal DB: { user_id, date, shift_type }
 * @param {string[][]} weeksBeforeTarget  Array di settimane (ognuna = 7 ISO date strings)
 *                                       che precedono la settimana da generare
 * @param {object}   shiftHrs           { mattina: 6, pomeriggio: 6, notte: 12 }
 * @returns {{ [userId: string]: number }}
 */
export function computeMonthHoursFromSchedules(publishedRows, weeksBeforeTarget, shiftHrs) {
  const daySet = new Set(weeksBeforeTarget.flat())
  const result = {}
  for (const row of publishedRows) {
    if (!daySet.has(row.date)) continue
    const hrs = shiftHrs[row.shift_type] ?? 0
    if (hrs === 0) continue
    result[row.user_id] = (result[row.user_id] ?? 0) + hrs
  }
  return result
}

/**
 * Estrae gli ID degli operatori che hanno lavorato la Domenica della settimana.
 * Usato per la rotazione domenicale (V8/V12): il Sabato è trattato come feriale.
 */
export function extractSundayWorkedIds(schedule, weekDaysISO) {
  const worked = new Set()
  for (const iso of weekDaysISO) {
    const dow = new Date(iso + 'T12:00:00').getDay()
    if (dow !== 0) continue  // solo Domenica
    const daySlots = schedule[iso]
    if (!daySlots) continue
    for (const slot of Object.values(daySlots)) {
      if (slot?.operatorId) worked.add(slot.operatorId)
      for (const e of slot?.extras ?? []) worked.add(e.operatorId)
    }
  }
  return worked
}
