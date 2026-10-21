/**
 * generateWeeklySchedule — Genera una proposta di turno settimanale
 * tramite SAT solving (logic-solver).
 *
 * Vincoli HARD ASSOLUTI (mai rilassati, neanche in emergenza)
 * ──────────────────────────────────────────────────────────────
 * V12 Domenica alternata: chi ha lavorato la Domenica precedente (in qualunque struttura)
 *     NON può essere assegnato alla Domenica di questa settimana — senza eccezioni.
 *
 * Vincoli HARD (applicati nei pass normali; V8 può essere rilassato in emergenza)
 * ─────────────────────────────────────────────────────────────────────────────────
 * V1  Esattamente 1 operatore per slot libero (Mattina / Pomeriggio / Notte × 7 giorni)
 * V2  Nessun operatore lavora 2 turni nello stesso giorno
 * V3  Riposo notte→mattina: chi fa la Notte del giorno D non può fare la Mattina del giorno D+1
 * V4  Carico massimo: ore libere ≤ (max_hours_per_week − ore già bloccate)
 * V5  Assenze approvate: nessun turno nei giorni di assenza (ignorato per slot pre-assegnati)
 * V6  Giorno di riposo fisso: nessun turno nel giorno settimanale indicato
 * V7  Slot pre-assegnati (lucchetto DB + vincoli ricorrenti profilo)
 * V8  Rotazione domenicale: operatori nel gruppo-riposo fuori dalla Domenica
 *     (rilassato in Pass 4-5 se necessario per coprire i turni)
 * V11 Multi-struttura: nessun turno se l'operatore è già assegnato in un'altra struttura
 *     dello stesso slot (giorno + fascia) — controlla TUTTE le strutture (cross-org)
 *
 * Vincoli SOFT (multi-pass: prima con, poi senza)
 * ──────────────────────────────────────────────────
 * V9  Fascia preferita (shift_preference): l'operatore lavora solo nel turno preferito
 *     Se con V9 non si trova soluzione, si risolve senza e si segnalano le preferenze
 *     non rispettate nel campo `relaxedPreferences` del risultato.
 * V14 No doppio weekend: evita di assegnare lo stesso operatore sia al Sabato che alla
 *     Domenica nella stessa settimana. Rilassato in Pass 3 se necessario.
 *
 * Durate dei turni
 * ─────────────────
 *  mattina    → 6 h
 *  pomeriggio → 6 h
 *  notte      → 12 h
 */

import Logic from 'logic-solver'

// ─── Costanti ─────────────────────────────────────────────────────────────────

const SHIFTS    = ['mattina', 'pomeriggio', 'notte']
const SHIFT_HRS = { mattina: 6, pomeriggio: 6, notte: 12 }

const GIORNO_DOW = {
  'Lunedì':    1,
  'Martedì':   2,
  'Mercoledì': 3,
  'Giovedì':   4,
  'Venerdì':   5,
  'Sabato':    6,
  'Domenica':  0,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function v(opId, d, shift) {
  return `${opId.replace(/-/g, '_')}_d${d}_${shift}`
}

const SHIFT_WINDOWS = {
  mattina:    { s: '06:00', e: '14:00' },
  pomeriggio: { s: '14:00', e: '22:00' },
  notte:      { s: '22:00', e: '06:00' },
}

function toMinutes(t) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function isAbsent(opId, dateStr, shift, absences) {
  return absences.some(a => {
    if (a.user_id !== opId) return false
    // Full-day or legacy record: date range check only
    if (a.is_full_day !== false || !a.start_time || !a.end_time) {
      return dateStr >= a.start_date && dateStr <= a.end_date
    }
    // Partial-day: date must be in range, then check time overlap
    if (dateStr < a.start_date || dateStr > a.end_date) return false
    const sw = SHIFT_WINDOWS[shift]
    if (!sw) return true // unknown shift → conservative
    const ss = toMinutes(sw.s)
    const se = toMinutes(sw.e) + (sw.e < sw.s ? 1440 : 0)
    const as = toMinutes(a.start_time)
    const ae = toMinutes(a.end_time) + (a.end_time < a.start_time ? 1440 : 0)
    return as < se && ae > ss
  })
}

// ─── Builder vincoli hard ─────────────────────────────────────────────────────

/**
 * Crea un Solver con tutti i vincoli hard (V1–V8, V10–V14).
 * withPreferences=true   → aggiunge V9 (fascia preferita, soft nel 1° pass)
 * withWeekendSplit=true  → aggiunge V14 (no Sab+Dom stesso op, soft nel 2° pass)
 * withWeekendRotation=false → disabilita V8, V12, V14 (fallback per squadre piccole)
 */
function buildSolver({
  weekDays, operators, approvedAbsences, preassigned, weekendOffIds, withPreferences,
  crossStructureSlots, effectivePrevWorkedIds, weekendOnIds = [],
  withWeekendRotation = true, withWeekendSplit = true, withWeekendReservation = false,
  monthHoursConsumed = {}, monthlyTargets = {},
  prevSundayNightOpId = null,
  forceFullBudget = false,
}) {
  const solver = new Logic.Solver()

  // ── V1 + V7: copertura slot ──────────────────────────────────────────────
  for (let d = 0; d < 7; d++) {
    for (const shift of SHIFTS) {
      const key           = `${d}|${shift}`
      const preassignedId = preassigned.get(key)

      if (preassignedId === '__UNASSIGNED__') {
        // Slot vuoto intenzionale (V12 cross-struttura): blocca tutti gli operatori
        for (const op of operators) solver.require(Logic.not(v(op.id, d, shift)))
      } else if (preassignedId) {
        solver.require(v(preassignedId, d, shift))
        for (const op of operators) {
          if (op.id !== preassignedId) solver.require(Logic.not(v(op.id, d, shift)))
        }
      } else {
        const available = operators.filter(op => !isAbsent(op.id, weekDays[d], shift, approvedAbsences))
        const absent    = operators.filter(op =>  isAbsent(op.id, weekDays[d], shift, approvedAbsences))
        for (const op of absent) solver.require(Logic.not(v(op.id, d, shift)))
        solver.require(Logic.exactlyOne(available.map(op => v(op.id, d, shift))))
      }
    }
  }

  // ── V2: al più 1 turno per operatore per giorno ──────────────────────────
  for (let d = 0; d < 7; d++) {
    for (const op of operators) {
      solver.require(Logic.atMostOne(SHIFTS.map(s => v(op.id, d, s))))
    }
  }

  // ── V3: riposo notte→mattina ──────────────────────────────────────────────
  for (let d = 0; d < 6; d++) {
    for (const op of operators) {
      solver.require(Logic.or(
        Logic.not(v(op.id, d,     'notte')),
        Logic.not(v(op.id, d + 1, 'mattina')),
      ))
    }
  }

  // ── V3 cross-week: notte della Dom precedente → non mattina del Lun di questa settimana ──
  // Chiude il gap tra settimane: chi ha fatto la notte dell'ultima domenica non può
  // fare la mattina del primo lunedì di questa settimana.
  if (prevSundayNightOpId && operators.find(o => o.id === prevSundayNightOpId)) {
    const monIdx = weekDays.findIndex(d => new Date(d + 'T12:00:00').getDay() === 1)
    if (monIdx >= 0 && !preassigned.has(`${monIdx}|mattina`)) {
      solver.require(Logic.not(v(prevSundayNightOpId, monIdx, 'mattina')))
    }
  }

  // ── V4: max ore settimanali (budget ridotto dalle ore bloccate) ──────────
  for (const op of operators) {
    if (!op.max_hours_per_week || op.max_hours_per_week <= 0) continue

    let lockedHours = 0
    const freeVars = [], freeWeights = []

    for (let d = 0; d < 7; d++) {
      for (const shift of SHIFTS) {
        const key = `${d}|${shift}`
        if (preassigned.get(key) === op.id) {
          lockedHours += SHIFT_HRS[shift]
        } else if (!preassigned.has(key)) {
          freeVars.push(v(op.id, d, shift))
          freeWeights.push(SHIFT_HRS[shift])
        }
      }
    }

    const weeklyBudget = op.max_hours_per_week - lockedHours
    // Riduce il budget settimanale se il target mensile è quasi esaurito.
    // monthHoursConsumed include già le ore dei locked di questa settimana
    // (weekend assegnati in Fase 1/2 prima di chiamare generateWeeklySchedule).
    const monthlyRemaining = monthlyTargets[op.id] > 0
      ? Math.max(0, monthlyTargets[op.id] - (monthHoursConsumed[op.id] ?? 0))
      : weeklyBudget
    const remainingBudget = Math.min(weeklyBudget, monthlyRemaining)
    if (freeVars.length === 0) continue
    if (remainingBudget <= 0) {
      // Budget esaurito dai locked: blocca tutti i slot liberi esplicitamente.
      // Senza questo il solver ignora V4 e può assegnare slot extra oltre il limite.
      for (const fv of freeVars) solver.require(Logic.not(fv))
      continue
    }

    if (forceFullBudget) {
      // V4-exact: l'operatore DEVE consumare esattamente il suo budget residuo.
      // Usato nel primo pass per garantire distribuzione equa quando supply = demand.
      // Se infeasible (V3/V5/V6 bloccano slot), il solver fallisce e il chiamante
      // ricade sui pass normali con solo il vincolo ≤.
      solver.require(Logic.equalBits(
        Logic.weightedSum(freeVars, freeWeights),
        Logic.constantBits(remainingBudget),
      ))
    } else {
      solver.require(Logic.lessThanOrEqual(
        Logic.weightedSum(freeVars, freeWeights),
        Logic.constantBits(remainingBudget),
      ))
    }
  }

  // ── V6: giorno di riposo fisso ────────────────────────────────────────────
  for (const op of operators) {
    if (!op.weekly_rest_day) continue
    const restDow = GIORNO_DOW[op.weekly_rest_day]
    if (restDow === undefined) continue
    for (let d = 0; d < 7; d++) {
      if (new Date(weekDays[d]).getDay() === restDow) {
        for (const shift of SHIFTS) {
          if (!preassigned.has(`${d}|${shift}`)) {
            solver.require(Logic.not(v(op.id, d, shift)))
          }
        }
      }
    }
  }

  // ── V8: rotazione domenica ────────────────────────────────────────────────
  // La rotazione si applica solo alla Domenica; il Sabato è un giorno feriale standard.
  if (withWeekendRotation) {
    for (const opId of weekendOffIds) {
      for (let d = 0; d < 7; d++) {
        if (new Date(weekDays[d]).getDay() !== 0) continue  // solo Domenica
        for (const shift of SHIFTS) {
          if (!preassigned.has(`${d}|${shift}`)) {
            solver.require(Logic.not(v(opId, d, shift)))
          }
        }
      }
    }
  }

  // ── V10 (hard): turno da evitare ─────────────────────────────────────────
  for (const op of operators) {
    if (!op.shift_avoid || !SHIFTS.includes(op.shift_avoid)) continue
    for (let d = 0; d < 7; d++) {
      if (!preassigned.has(`${d}|${op.shift_avoid}`)) {
        solver.require(Logic.not(v(op.id, d, op.shift_avoid)))
      }
    }
  }

  // ── V11: un turno per giorno cross-struttura ────────────────────────────
  // Se l'operatore ha già QUALSIASI turno in un'altra struttura quel giorno,
  // è escluso da TUTTI i turni di questa struttura per lo stesso giorno.
  const crossDayOccupied = new Map()  // opId → Set<dayIdx>
  for (const slot of (crossStructureSlots ?? [])) {
    const d = weekDays.indexOf(slot.dateISO)
    if (d < 0) continue
    if (!operators.find(o => o.id === slot.userId)) continue
    if (!crossDayOccupied.has(slot.userId)) crossDayOccupied.set(slot.userId, new Set())
    crossDayOccupied.get(slot.userId).add(d)
  }
  for (const [opId, dayIdxs] of crossDayOccupied) {
    for (const d of dayIdxs) {
      for (const shift of SHIFTS) {
        const key = `${d}|${shift}`
        if (!preassigned.has(key)) {
          solver.require(Logic.not(v(opId, d, shift)))
        }
      }
    }
  }

  // ── V13: limite giornaliero cross-struttura (anti-burnout, max 9h/giorno) ──
  // Se l'operatore ha già N ore in un'altra struttura quel giorno,
  // blocca i turni che farebbero superare 9h totali.
  const MAX_DAILY_HOURS = 9
  const crossDailyHrs = {}
  for (const slot of (crossStructureSlots ?? [])) {
    const d = weekDays.indexOf(slot.dateISO)
    if (d < 0) continue
    const hrs = SHIFT_HRS[slot.shiftType] ?? 0
    if (!crossDailyHrs[slot.userId]) crossDailyHrs[slot.userId] = {}
    crossDailyHrs[slot.userId][d] = (crossDailyHrs[slot.userId][d] ?? 0) + hrs
  }
  for (const op of operators) {
    const opCross = crossDailyHrs[op.id]
    if (!opCross) continue
    for (let d = 0; d < 7; d++) {
      const alreadyHrs = opCross[d] ?? 0
      if (alreadyHrs === 0) continue
      for (const shift of SHIFTS) {
        const key = `${d}|${shift}`
        if (preassigned.has(key)) continue
        if (alreadyHrs + SHIFT_HRS[shift] > MAX_DAILY_HOURS) {
          solver.require(Logic.not(v(op.id, d, shift)))
        }
      }
    }
  }

  // ── V12: domenica alternata (HARD ASSOLUTO — mai rilassato) ─────────────
  // Chi ha lavorato la Domenica precedente (in qualsiasi struttura) NON può
  // essere assegnato alla Domenica di questa settimana — senza eccezioni.
  // Il Sabato NON è vincolato: è trattato come feriale.
  for (const opId of (effectivePrevWorkedIds ?? [])) {
    for (let d = 0; d < 7; d++) {
      const dow = new Date(weekDays[d]).getDay()
      if (dow !== 0) continue  // solo Domenica
      for (const shift of SHIFTS) {
        const key = `${d}|${shift}`
        if (!preassigned.has(key)) {
          solver.require(Logic.not(v(opId, d, shift)))
        }
      }
    }
  }

  // ── V14: no doppio weekend (HARD) ────────────────────────────────────────
  // Hard constraint: un operatore non può essere assegnato sia al Sabato che alla Domenica.
  // Non dipende più da withWeekendRotation (era soft, ora sempre attiva se withWeekendSplit=true).
  if (withWeekendSplit) {
    const satIdx = weekDays.findIndex(d => new Date(d).getDay() === 6)
    const sunIdx = weekDays.findIndex(d => new Date(d).getDay() === 0)
    if (satIdx >= 0 && sunIdx >= 0) {
      for (const op of operators) {
        for (const satShift of SHIFTS) {
          const satKey = `${satIdx}|${satShift}`
          if (preassigned.has(satKey) && preassigned.get(satKey) !== op.id) continue
          for (const sunShift of SHIFTS) {
            const sunKey = `${sunIdx}|${sunShift}`
            if (preassigned.has(sunKey) && preassigned.get(sunKey) !== op.id) continue
            if (!preassigned.has(satKey) || !preassigned.has(sunKey)) {
              solver.require(Logic.or(
                Logic.not(v(op.id, satIdx, satShift)),
                Logic.not(v(op.id, sunIdx, sunShift))
              ))
            }
          }
        }
      }
    }
  }

  // ── V4b: riserva budget per il weekend ───────────────────────────────────
  // Per gli operatori che devono lavorare il weekend (non in V8/V12),
  // cap le ore dei giorni feriali a max_hours - 6, così il solver non può
  // "consumare" tutto il budget infrasettimanale lasciandoli a secco per Sab/Dom.
  if (withWeekendReservation) {
    const weekendDowSet = new Set([0, 6])  // Domenica=0, Sabato=6
    const weekdayIdxs = []
    for (let d = 0; d < 7; d++) {
      if (!weekendDowSet.has(new Date(weekDays[d]).getDay())) weekdayIdxs.push(d)
    }
    const weekendOffSet = new Set(weekendOffIds ?? [])

    for (const op of operators) {
      if (!op.max_hours_per_week || op.max_hours_per_week <= 0) continue
      if (weekendOffSet.has(op.id)) continue
      if ((effectivePrevWorkedIds ?? new Set()).has(op.id)) continue

      let lockedWeekdayHrs = 0
      const freeWeekdayVars = [], freeWeekdayWeights = []

      for (const d of weekdayIdxs) {
        for (const shift of SHIFTS) {
          const key = `${d}|${shift}`
          if (preassigned.get(key) === op.id) {
            lockedWeekdayHrs += SHIFT_HRS[shift]
          } else if (!preassigned.has(key)) {
            freeWeekdayVars.push(v(op.id, d, shift))
            freeWeekdayWeights.push(SHIFT_HRS[shift])
          }
        }
      }

      const RESERVE_HRS = 6  // riserva per almeno 1 turno weekend
      const weekdayBudget = op.max_hours_per_week - lockedWeekdayHrs - RESERVE_HRS
      if (weekdayBudget <= 0 || freeWeekdayVars.length === 0) continue

      solver.require(Logic.lessThanOrEqual(
        Logic.weightedSum(freeWeekdayVars, freeWeekdayWeights),
        Logic.constantBits(weekdayBudget),
      ))
    }
  }

  // ── V15: assegnazione weekend forzata per operatori in rotazione ──────────
  // Gli operatori in weekendOnIds (riposati il weekend scorso, non in V8/V12)
  // devono coprire almeno 1 slot nel weekend corrente.
  // Garantisce equità: anche i part-time lavorano il loro turno festivo.
  // Applicato solo nei passaggi 1-2 (con withWeekendReservation); rimosso nel 3-4.
  if (withWeekendReservation && weekendOnIds.length > 0) {
    const weekendOnSet = new Set(weekendOnIds)
    const satIdx = weekDays.findIndex(d => new Date(d).getDay() === 6)
    const sunIdx = weekDays.findIndex(d => new Date(d).getDay() === 0)

    for (const op of operators) {
      if (!weekendOnSet.has(op.id)) continue

      // Raccoglie tutti gli slot weekend in cui l'operatore potrebbe andare
      const weekendVars = []
      for (const dIdx of [satIdx, sunIdx]) {
        if (dIdx < 0) continue
        for (const shift of SHIFTS) {
          const key = `${dIdx}|${shift}`
          // Salta se lo slot è già pre-assegnato a un altro
          if (preassigned.has(key) && preassigned.get(key) !== op.id) continue
          // Salta se l'operatore è assente per quel turno
          if (isAbsent(op.id, weekDays[dIdx], shift, approvedAbsences)) continue
          weekendVars.push(v(op.id, dIdx, shift))
        }
      }

      // Aggiungi il vincolo solo se esiste almeno uno slot disponibile
      if (weekendVars.length > 0) {
        solver.require(Logic.or(...weekendVars))
      }
    }
  }

  // ── V9 (soft → hard nel 1° passaggio): turno preferito ──────────────────
  if (withPreferences) {
    for (const op of operators) {
      if (!op.shift_preference || !SHIFTS.includes(op.shift_preference)) continue
      const blocked = SHIFTS.filter(s => s !== op.shift_preference)
      for (let d = 0; d < 7; d++) {
        for (const shift of blocked) {
          if (!preassigned.has(`${d}|${shift}`)) {
            solver.require(Logic.not(v(op.id, d, shift)))
          }
        }
      }
    }
  }

  return solver
}

// ─── Costruzione risultato ────────────────────────────────────────────────────

function buildSchedule(sol, weekDays, operators, preassigned) {
  const schedule = {}
  for (let d = 0; d < 7; d++) {
    schedule[weekDays[d]] = {}
    for (const shift of SHIFTS) {
      const key = `${d}|${shift}`
      if (preassigned.has(key)) {
        const op = operators.find(o => o.id === preassigned.get(key))
        if (op) schedule[weekDays[d]][shift] = {
          operatorId: op.id, operatorName: op.full_name, isPreassigned: true,
        }
      } else {
        const assigned = operators.find(op => sol.evaluate(v(op.id, d, shift)))
        if (assigned) schedule[weekDays[d]][shift] = {
          operatorId: assigned.id, operatorName: assigned.full_name,
        }
      }
    }
  }
  return schedule
}

// ─── Funzione principale ──────────────────────────────────────────────────────

/**
 * @param {string[]} params.weekDays           7 stringhe ISO (lunedì → domenica)
 * @param {Array}    params.operators           id, full_name, max_hours_per_week?,
 *                                              weekly_rest_day?, shift_preference?
 * @param {Array}    params.approvedAbsences    { user_id, start_date, end_date }
 * @param {Array}    params.lockedSlots         { dateISO, shift, operatorId }
 * @param {Array}    params.recurringSlots      { operatorId, dayName, shift }
 * @param {string[]} params.weekendOffIds          IDs operatori con weekend libero questa settimana
 * @param {Array}    params.crossStructureSlots    [{userId, dateISO, shiftType}] turni in altre strutture questa settimana
 * @param {string[]} params.prevWeekendWorkedIds   IDs operatori che hanno lavorato nel weekend precedente
 * @param {string|null} [params.prevSundayNightOpId]  ID operatore che ha fatto la Notte della
 *                        domenica della settimana precedente → bloccato dalla Mattina del lunedì
 *                        di questa settimana (V3 cross-week). Default: null.
 *
 * @returns {{ success: true, schedule, relaxedPreferences: string[] }
 *          | { success: false, error: string }}
 */
export function generateWeeklySchedule({
  weekDays,
  operators,
  approvedAbsences      = [],
  lockedSlots           = [],
  recurringSlots        = [],
  weekendOffIds         = [],
  weekendOnIds          = [],
  crossStructureSlots   = [],
  prevWeekendWorkedIds  = [],
  monthHoursConsumed    = {},
  monthlyTargets        = {},
  debugMode             = false,
  prevSundayNightOpId   = null,
}) {
  if (!operators?.length)
    return { success: false, error: 'Nessun operatore disponibile nella struttura.' }
  if (weekDays?.length !== 7)
    return { success: false, error: 'La settimana deve contenere esattamente 7 giorni.' }

  // ── Mappa slot pre-assegnati (V7) ─────────────────────────────────────────
  const preassigned = new Map()

  for (const ls of lockedSlots) {
    const d = weekDays.indexOf(ls.dateISO)
    if (d < 0) continue
    // __UNASSIGNED__: slot lasciato vuoto intenzionalmente dalla Fase 1/2
    // (nessun candidato disponibile per V12). Viene trattato come pre-assegnato
    // così il solver non tenta di riempirlo e lo lascia vuoto nello schedule.
    if (ls.operatorId === '__UNASSIGNED__' || operators.find(o => o.id === ls.operatorId))
      preassigned.set(`${d}|${ls.shift}`, ls.operatorId)
  }

  for (const rs of recurringSlots) {
    if (!operators.find(o => o.id === rs.operatorId)) continue
    const dow = GIORNO_DOW[rs.dayName]
    if (dow === undefined) continue
    for (let d = 0; d < 7; d++) {
      if (new Date(weekDays[d]).getDay() === dow) {
        const key = `${d}|${rs.shift}`
        if (!preassigned.has(key)) preassigned.set(key, rs.operatorId)
      }
    }
  }

  // ── Pre-check copertura slot liberi (V5) ──────────────────────────────────
  for (let d = 0; d < 7; d++) {
    for (const shift of SHIFTS) {
      if (preassigned.has(`${d}|${shift}`)) continue
      const available = operators.filter(op => !isAbsent(op.id, weekDays[d], shift, approvedAbsences))
      if (available.length === 0) {
        const label = new Date(weekDays[d]).toLocaleDateString('it-IT', {
          weekday: 'long', day: '2-digit', month: 'short',
        })
        return { success: false, error: `Nessun operatore disponibile: ${label}, turno ${shift}.` }
      }
    }
  }

  // ── effectivePrevWorkedIds = prevWeekendWorkedIds senza filtri ───────────
  // Il vecchio filtro "assenza domenica scorsa" era sbagliato: prevWorkedIds
  // contiene solo chi ha effettivamente LAVORATO (schedule row nel DB o
  // assegnazione in Phase 1). Un'assenza parziale non cancella il turno fatto.
  // Rimuovere l'operatore causava la violazione di V12.
  // Nota: in Phase 3 del mensile, questo viene chiamato con prevWeekendWorkedIds=[]
  // quindi il set è sempre vuoto — il blocco domenicale viene da Phase 1.
  const effectivePrevWorkedIds = new Set(prevWeekendWorkedIds)

  const ctx = { weekDays, operators, approvedAbsences, preassigned, weekendOffIds, weekendOnIds, crossStructureSlots, effectivePrevWorkedIds, monthHoursConsumed, monthlyTargets, prevSundayNightOpId }

  const hasPreferences = operators.some(
    op => op.shift_preference && SHIFTS.includes(op.shift_preference)
  )

  function buildRelaxedPrefs() {
    return hasPreferences
      ? operators
          .filter(op => op.shift_preference && SHIFTS.includes(op.shift_preference))
          .map(op => `${op.full_name} (${op.shift_preference})`)
      : []
  }

  // ── Debug: motivi di esclusione dal weekend ───────────────────────────────
  if (debugMode) {
    const satIdx = weekDays.findIndex(d => new Date(d).getDay() === 6)
    const sunIdx = weekDays.findIndex(d => new Date(d).getDay() === 0)
    const weekendOffSet = new Set(weekendOffIds)

    console.group(`[Solver] Disponibilità weekend  ${weekDays[0]} → ${weekDays[6]}`)
    console.log('V8  rotation-off IDs:', weekendOffIds)
    console.log('V12 prev-worked IDs :', [...effectivePrevWorkedIds])
    console.log('V15 forced-on IDs   :', weekendOnIds)
    console.log('V12 raw prevWorked (incluse ferie):', prevWeekendWorkedIds)

    for (const op of operators) {
      const reasons = []

      if (weekendOffSet.has(op.id))
        reasons.push('V8: rotation-off (scelto per riposo questa settimana)')
      if (effectivePrevWorkedIds.has(op.id))
        reasons.push('V12: ha lavorato il weekend scorso')

      for (const [dIdx, label] of [[satIdx, 'Sabato'], [sunIdx, 'Domenica']]) {
        if (dIdx < 0) continue
        const dateStr = weekDays[dIdx]
        const dow = new Date(dateStr).getDay()
        if (op.weekly_rest_day && GIORNO_DOW[op.weekly_rest_day] === dow)
          reasons.push(`V6: riposo fisso ${label}`)
        for (const shift of SHIFTS) {
          if (isAbsent(op.id, dateStr, shift, approvedAbsences))
            reasons.push(`V5: assenza ${label}/${shift}`)
        }
      }

      // Stima budget (basata su slot pre-assegnati; il solver può variare)
      if (op.max_hours_per_week > 0) {
        let lockedHrs = 0
        for (let d = 0; d < 7; d++)
          for (const s of SHIFTS)
            if (preassigned.get(`${d}|${s}`) === op.id) lockedHrs += SHIFT_HRS[s]
        const remaining = op.max_hours_per_week - lockedHrs
        if (remaining < 6)
          reasons.push(`V4: budget pre-bloccato ~${remaining}h rimaste (< 6h per 1 turno)`)
        else
          reasons.push(`budget: ${remaining}h libere su ${op.max_hours_per_week}h`)
      }

      const forced = weekendOnIds.includes(op.id) ? ' 🔒V15' : ''
      const icon = reasons.some(r => r.startsWith('V')) ? '❌' : '✅'
      const msg  = reasons.filter(r => r.startsWith('V')).join(' | ') || 'disponibile'
      const extra = reasons.find(r => r.startsWith('budget'))
      console.log(`  ${icon} ${op.full_name}${forced}: ${msg}${extra ? `  [${extra}]` : ''}`)
    }
    console.groupEnd()
  }

  // ── Helper: sanity-check V12 (non dovrebbe mai trovare nulla, V12 è hard) ─
  function detectViolations(sol) {
    const sunIdx = weekDays.findIndex(d => new Date(d).getDay() === 0)
    if (sunIdx < 0) return []
    return operators
      .filter(op =>
        effectivePrevWorkedIds.has(op.id) &&
        SHIFTS.some(s => sol.evaluate(v(op.id, sunIdx, s)))
      )
      .map(op => op.full_name)
  }

  // ── Helper: rileva operatori assegnati sia Sabato che Domenica (weekend spezzato) ──
  function detectSplitWeekend(sol) {
    const satIdx = weekDays.findIndex(d => new Date(d).getDay() === 6)
    const sunIdx = weekDays.findIndex(d => new Date(d).getDay() === 0)
    if (satIdx < 0 || sunIdx < 0) return []
    return operators
      .filter(op =>
        SHIFTS.some(s => sol.evaluate(v(op.id, satIdx, s))) &&
        SHIFTS.some(s => sol.evaluate(v(op.id, sunIdx, s)))
      )
      .map(op => op.full_name)
  }

  // ── Pass F: budget esatto — V4 diventa = invece di ≤ ────────────────────
  // Il vincolo orario contrattuale è assoluto: ogni operatore con max_hours_per_week > 0
  // DEVE consumare esattamente il suo budget residuo (niente di più, niente di meno).
  // Gli altri vincoli (V9 preferenze → V14 split → V8 rotazione → V4b riserva)
  // vengono rilassati progressivamente MA il budget esatto rimane fisso.
  // Solo se TUTTI questi pass falliscono (V3/V5/V6/V11 rendono impossibile il budget
  // esatto — non V8/V14) si ricade sui pass normali con solo il cap ≤.
  {
    const tryForced = (withPreferences, withWeekendSplit, withWeekendRotation, withWeekendReservation) => {
      const s = buildSolver({
        ...ctx, withPreferences, withWeekendSplit, withWeekendRotation,
        withWeekendReservation, forceFullBudget: true,
      }).solve()
      if (!s) return null
      return {
        success:            true,
        schedule:           buildSchedule(s, weekDays, operators, preassigned),
        relaxedPreferences: withPreferences ? [] : buildRelaxedPrefs(),
        weekendViolations:  [],   // V12 è sempre hard → mai violato
        splitWeekendNames:  withWeekendSplit ? [] : detectSplitWeekend(s),
      }
    }

    if (hasPreferences) {
      const r = tryForced(true, true, true, true)
      if (r) return r
    }
    const r1 = tryForced(false, true,  true,  true)  // rilassa V9
    if (r1) return r1
    const r2 = tryForced(false, false, true,  true)  // rilassa V14
    if (r2) return r2
    const r3 = tryForced(false, false, false, true)  // rilassa V8
    if (r3) return r3
    const r4 = tryForced(false, false, false, false) // rilassa V4b
    if (r4) return r4
  }

  // ── Passaggio 1: preferenze + split weekend + rotazione + riserva budget ─
  if (hasPreferences) {
    const sol1 = buildSolver({ ...ctx, withPreferences: true, withWeekendSplit: true, withWeekendReservation: true }).solve()
    if (sol1) return {
      success: true, schedule: buildSchedule(sol1, weekDays, operators, preassigned),
      relaxedPreferences: [], weekendViolations: [], splitWeekendNames: [],
    }
  }

  // ── Passaggio 2: solo hard + split weekend + rotazione + riserva budget ──
  const sol2 = buildSolver({ ...ctx, withPreferences: false, withWeekendSplit: true, withWeekendReservation: true }).solve()
  if (sol2) return {
    success: true, schedule: buildSchedule(sol2, weekDays, operators, preassigned),
    relaxedPreferences: buildRelaxedPrefs(), weekendViolations: [], splitWeekendNames: [],
  }

  // ── Passaggio 3: rilassa solo il split (V14), mantieni rotazione + riserva budget ──
  // V4b e V15 restano attivi; V14 cade → alcuni op. potrebbero coprire Sab+Dom.
  const sol3 = buildSolver({ ...ctx, withPreferences: false, withWeekendSplit: false, withWeekendReservation: true }).solve()
  if (sol3) return {
    success: true, schedule: buildSchedule(sol3, weekDays, operators, preassigned),
    relaxedPreferences: buildRelaxedPrefs(), weekendViolations: [],
    splitWeekendNames:  detectSplitWeekend(sol3),
  }

  // ── Passaggio 4: rilassa solo V8 (rotazione gruppo), V12 resta HARD ────────
  // Chi ha lavorato domenica scorsa rimane bloccato (V12 incondizionato).
  // Solo V8 (il gruppo-riposo della settimana) viene ignorato.
  const sol4 = buildSolver({ ...ctx, withPreferences: false, withWeekendRotation: false, withWeekendSplit: false, withWeekendReservation: true }).solve()
  if (sol4) return {
    success:            true,
    schedule:           buildSchedule(sol4, weekDays, operators, preassigned),
    relaxedPreferences: buildRelaxedPrefs(),
    weekendViolations:  [],                        // V12 hard → nessuna violazione domenica
    splitWeekendNames:  detectSplitWeekend(sol4),
  }

  // ── Passaggio 5: emergenza — rilassa V8 + riserva budget, V12 resta HARD ──
  // Ultima risorsa: nemmeno qui la domenica alternata viene violata.
  const sol5 = buildSolver({ ...ctx, withPreferences: false, withWeekendRotation: false, withWeekendReservation: false }).solve()

  if (!sol5) {
    return {
      success: false,
      error:
        'Nessuna soluzione trovata con i vincoli attuali. ' +
        'Prova ad aumentare le ore massime, ridurre le assenze o aggiungere operatori.',
    }
  }

  return {
    success:            true,
    schedule:           buildSchedule(sol5, weekDays, operators, preassigned),
    relaxedPreferences: buildRelaxedPrefs(),
    weekendViolations:  [],                        // V12 hard → nessuna violazione domenica
    splitWeekendNames:  detectSplitWeekend(sol5),
  }
}
