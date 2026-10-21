/**
 * generateMonthlySchedule — Approccio a 3 fasi con validazione cross-struttura.
 *
 *  Fase 1 — Blindatura Domeniche (Hard Priority)
 *    Per ogni domenica del mese, in ordine cronologico, si risolve
 *    SOLO il giorno domenicale applicando:
 *      - V12 domenica alternata (HARD ASSOLUTO — CROSS-STRUTTURA):
 *        chi ha lavorato la domenica precedente in QUALSIASI struttura è vietato.
 *      - V8  rotazione: chi è nel gruppo-riposo è vietato (rilassabile).
 *      - V5  assenze, V6 riposo fisso, V10 turno da evitare, V11 multi-struttura.
 *    Ogni domenica è bloccata prima della successiva → V12 si propaga a cascata.
 *    Se nemmeno rilassando V8 si trovano 3 operatori, gli slot impossibili
 *    vengono lasciati VUOTI (il manager interverrà manualmente).
 *
 *  Fase 2 — Assegnazione Sabati (Soft Constraint Incrociata)
 *    Con tutte le domeniche fissate:
 *      - Soft: chi lavora domenica della stessa settimana è evitato sul sabato.
 *      - Fallback automatico se il soft rende impossibile.
 *
 *  Fase 3 — Feriali Lun–Ven
 *    Sab e Dom sono già bloccati come lockedSlots. Il solver settimanale
 *    copre i 15 slot rimanenti con budget ridotto automaticamente dalle ore weekend.
 *    Se il solver settimanale fallisce → fallback giorno-per-giorno con allowEmpty:
 *    ogni giorno viene risolto singolarmente, gli slot impossibili restano vuoti.
 */

import Logic from 'logic-solver'
import { generateWeeklySchedule } from './generateWeeklySchedule'
import { extractSundayWorkedIds } from './scheduleHelpers'

// ─── Costanti ─────────────────────────────────────────────────────────────────

const SHIFTS    = ['mattina', 'pomeriggio', 'notte']
const SHIFT_HRS = { mattina: 6, pomeriggio: 6, notte: 12 }

const GIORNO_DOW = {
  'Lunedì':    1, 'Martedì':   2, 'Mercoledì': 3, 'Giovedì': 4,
  'Venerdì':   5, 'Sabato':    6, 'Domenica':  0,
}

const DOW_GIORNO = Object.fromEntries(
  Object.entries(GIORNO_DOW).map(([k, d]) => [d, k])
)

const SHIFT_WINDOWS = {
  mattina:    { s: '06:00', e: '14:00' },
  pomeriggio: { s: '14:00', e: '22:00' },
  notte:      { s: '22:00', e: '06:00' },
}

// Marker per slot che il solver non può coprire — Phase 3 li tratta come
// preassigned "a nessuno" → li salta senza fallire.
const UNASSIGNED_MARKER = '__UNASSIGNED__'

function toMinutes(t) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isAbsent(opId, dateStr, shift, absences) {
  return absences.some(a => {
    if (a.user_id !== opId) return false
    if (a.is_full_day !== false || !a.start_time || !a.end_time)
      return dateStr >= a.start_date && dateStr <= a.end_date
    if (dateStr < a.start_date || dateStr > a.end_date) return false
    const sw = SHIFT_WINDOWS[shift]
    if (!sw) return true
    const ss = toMinutes(sw.s)
    const se = toMinutes(sw.e) + (sw.e < sw.s ? 1440 : 0)
    const as = toMinutes(a.start_time)
    const ae = toMinutes(a.end_time) + (a.end_time < a.start_time ? 1440 : 0)
    return as < se && ae > ss
  })
}

function v(opId, shift) {
  return `${opId.replace(/-/g, '_')}_${shift}`
}

// ─── isSundayAvailable — Filtro cross-struttura (PRIMO filtro) ───────────────

/**
 * Verifica se un operatore può lavorare una specifica Domenica.
 *
 * IMPORTANTE — Granularità dei check:
 *   Questo filtro esclude l'operatore da TUTTI i turni della domenica,
 *   quindi deve contenere SOLO vincoli che si applicano all'intera giornata.
 *
 *   ✅ V12 domenica alternata: se ha lavorato domenica scorsa non può lavorare
 *      questa domenica in nessuna fascia.
 *   ✅ V6 riposo fisso: la domenica è il suo giorno di riposo settimanale.
 *
 *   ❌ V5 assenze: NON va qui — un'assenza parziale (es. solo pomeriggio) non
 *      impedisce la mattina. Il check per-fascia è in solveDaySlots → isAbsent().
 *   ❌ V11 cross-struttura: NON va qui — un turno in altra struttura (es. mattina)
 *      non impedisce il pomeriggio qui. Il check per-fascia è in solveDaySlots
 *      tramite il parametro crossSlots.
 *
 * @param {string}   opId
 * @param {string}   sundayISO
 * @param {object}   ctx
 * @param {Set}      ctx.prevWorkedIds   Chi ha lavorato domenica scorsa (cross-struttura)
 * @param {object[]} ctx.operators       Lista operatori (per V6)
 * @returns {{ available: boolean, reason?: string }}
 */
export function isSundayAvailable(opId, sundayISO, { prevWorkedIds, operators }) {
  // V12: ha lavorato la domenica PRECEDENTE in qualsiasi struttura?
  if (prevWorkedIds.has(opId))
    return { available: false, reason: 'V12: ha lavorato la domenica precedente (cross-struttura)' }

  // V6: la domenica è il suo giorno di riposo fisso?
  const op = operators?.find(o => o.id === opId)
  if (op?.weekly_rest_day === 'Domenica')
    return { available: false, reason: 'V6: riposo fisso la domenica' }

  return { available: true }
}

// ─── Pre-assegnati ricorrenti per un singolo giorno ───────────────────────────

function recurringForDay(recurringSlots, operators, dayISO) {
  const dow     = new Date(dayISO + 'T12:00:00').getDay()
  const dayName = DOW_GIORNO[dow]
  if (!dayName) return []
  const result     = []
  const seenShifts = new Set()
  for (const rs of recurringSlots) {
    if (rs.dayName !== dayName) continue
    if (!operators.find(o => o.id === rs.operatorId)) continue
    if (seenShifts.has(rs.shift)) continue
    seenShifts.add(rs.shift)
    result.push({ dateISO: dayISO, shift: rs.shift, operatorId: rs.operatorId })
  }
  return result
}

// ─── Mini-solver: risolve i 3 turni di un singolo giorno ─────────────────────

/**
 * Risolve mattina/pomeriggio/notte di `dayISO`.
 *
 * Se `allowEmpty` è true e un turno non ha operatori disponibili,
 * lo slot viene lasciato VUOTO anziché far fallire l'intero solve.
 * Il turno vuoto comparirà come `null` nel risultato.
 *
 * @param {string}   p.dayISO             Data ISO da pianificare
 * @param {object[]} p.operators          Lista operatori (max_hours > 0)
 * @param {object[]} p.approvedAbsences   Assenze approvate
 * @param {object[]} p.crossSlots         [{userId, dateISO, shiftType}]
 * @param {object[]} p.preLockedForDay    [{dateISO, shift, operatorId}]
 * @param {Set}      p.forbiddenIds       Vietati in modo assoluto (V12 + V8)
 * @param {Set}      [p.softForbiddenIds] Da preferire evitare (soft)
 * @param {object}   [p.weekHoursConsumed] { [opId]: ore già assegnate questa settimana }
 * @param {boolean}  [p.allowEmpty]       Se true, turni impossibili restano vuoti
 * @param {string|null} [p.prevNightOpId]  ID operatore che ha fatto la Notte del giorno precedente
 *                                          → bloccato dalla Mattina di questo giorno (V3)
 * @returns {{ mattina: string|null, pomeriggio: string|null, notte: string|null } | null}
 */
function solveDaySlots({
  dayISO, operators, approvedAbsences, crossSlots,
  preLockedForDay = [], forbiddenIds = new Set(), softForbiddenIds = null,
  weekHoursConsumed = {}, allowEmpty = false, prevNightOpId = null,
  monthHoursConsumed = {}, monthlyTargets = {},
  relaxBudget = false,   // se true: V4 (budget settimanale) ignorato — usato per recovery slot vuoti
}) {
  const dayDow = new Date(dayISO + 'T12:00:00').getDay()

  // Mappa preassigned: shift → operatorId
  const preassigned = new Map()
  for (const sl of preLockedForDay) {
    if (!preassigned.has(sl.shift)) preassigned.set(sl.shift, sl.operatorId)
  }

  // Vincoli base condivisi tra il path SAT e il path greedy.
  // Ogni path aggiunge i propri extra (soft, greedyUsed, V3) con un ulteriore ||.
  // Centralizzare qui evita che una modifica a un vincolo (es. relaxBudget) debba
  // essere replicata in più posti e rischi di divergere silenziosamente.
  const baseBlocked = (op, shift, shiftHrs) =>
    isAbsent(op.id, dayISO, shift, approvedAbsences) ||
    // V11: un solo turno al giorno — se ha qualsiasi turno in altra struttura oggi
    crossSlots.some(s => s.userId === op.id && s.dateISO === dayISO) ||
    forbiddenIds.has(op.id) ||
    (op.shift_avoid === shift) ||
    // V6: riposo fisso questo giorno della settimana
    (op.weekly_rest_day && GIORNO_DOW[op.weekly_rest_day] === dayDow) ||
    // V4: budget settimanale — vincolo hard. Saltato in modalità relaxBudget (recovery slot vuoti).
    (!relaxBudget && op.max_hours_per_week > 0 &&
      shiftHrs > op.max_hours_per_week - (weekHoursConsumed[op.id] ?? 0)) ||
    // V4m: budget mensile — evita di saturare un operatore oltre il target mensile.
    // Rilassato insieme a V4 in modalità relaxBudget (i feriali non restano mai vuoti
    // per sole ragioni di budget; i vincoli hard V5/V6/V11 restano sempre attivi).
    (!relaxBudget && monthlyTargets[op.id] > 0 &&
      shiftHrs > monthlyTargets[op.id] - (monthHoursConsumed[op.id] ?? 0))

  function buildAndSolve(withSoft) {
    const solver      = new Logic.Solver()
    const emptyShifts = []  // turni senza candidati (solo se allowEmpty)

    for (const shift of SHIFTS) {
      const preId    = preassigned.get(shift)
      const shiftHrs = SHIFT_HRS[shift]

      if (preId) {
        solver.require(v(preId, shift))
        for (const op of operators) {
          if (op.id !== preId) solver.require(Logic.not(v(op.id, shift)))
        }
      } else {
        const isBlocked = op =>
          baseBlocked(op, shift, shiftHrs) ||
          (withSoft && softForbiddenIds?.has(op.id))

        const available = operators.filter(op => !isBlocked(op))

        if (available.length === 0) {
          if (allowEmpty) {
            // Blocca tutti: nessuno sarà assegnato a questo turno → slot vuoto
            for (const op of operators) solver.require(Logic.not(v(op.id, shift)))
            emptyShifts.push(shift)
          } else {
            return null
          }
        } else {
          for (const op of operators) {
            if (isBlocked(op)) solver.require(Logic.not(v(op.id, shift)))
          }
          solver.require(Logic.exactlyOne(available.map(op => v(op.id, shift))))
        }
      }
    }

    // V2: al più 1 turno per operatore nel giorno
    for (const op of operators) {
      solver.require(Logic.atMostOne(SHIFTS.map(s => v(op.id, s))))
    }

    // V3: chi ha fatto la Notte ieri non può fare la Mattina oggi
    if (prevNightOpId && operators.find(o => o.id === prevNightOpId)) {
      if (!preassigned.has('mattina')) {
        solver.require(Logic.not(v(prevNightOpId, 'mattina')))
      }
    }

    const sol = solver.solve()
    return sol ? { sol, emptyShifts } : null
  }

  // Tentativo con vincolo soft → fallback senza soft
  let res = softForbiddenIds?.size > 0 ? buildAndSolve(true) : null
  if (!res) res = buildAndSolve(false)

  // Se il SAT combinato fallisce E allowEmpty è true, fallback greedy:
  // risolvi ogni turno indipendentemente (senza V2 cross-shift).
  if (!res && allowEmpty) {
    const greedyResult = {}
    const greedyUsed   = new Set()  // operatori già assegnati in questo giorno (V2 greedy)

    for (const shift of SHIFTS) {
      const preId = preassigned.get(shift)
      if (preId) {
        greedyResult[shift] = preId
        greedyUsed.add(preId)
        continue
      }
      const shiftHrs = SHIFT_HRS[shift]
      const isBlocked = op =>
        baseBlocked(op, shift, shiftHrs) ||
        greedyUsed.has(op.id) ||
        (shift === 'mattina' && prevNightOpId && op.id === prevNightOpId)

      const candidate = operators.find(op => !isBlocked(op))
      if (candidate) {
        greedyResult[shift] = candidate.id
        greedyUsed.add(candidate.id)
      } else {
        greedyResult[shift] = null  // nessun candidato → slot vuoto
      }
    }
    return greedyResult
  }

  if (!res) return null

  const { sol, emptyShifts } = res
  const emptySet = new Set(emptyShifts)

  const result = {}
  for (const shift of SHIFTS) {
    const preId = preassigned.get(shift)
    if (preId) {
      result[shift] = preId
    } else if (emptySet.has(shift)) {
      result[shift] = null  // slot vuoto — nessun candidato disponibile
    } else {
      const assigned = operators.find(op => sol.evaluate(v(op.id, shift)))
      result[shift] = assigned?.id ?? null
    }
  }
  return result
}

// ─── Calcolo rotazione domenicale ─────────────────────────────────────────────

function computeWeekendRotation({
  weekDaysISO, operators, approvedAbsences = [], lockedSlots = [], recurringSlots = [],
  prevWorkedIds = new Set(), recentCounts = {},
}) {
  const sunISO = weekDaysISO[6]

  const absentOn = (opId, iso) => approvedAbsences.some(
    a => a.user_id === opId && iso >= a.start_date && iso <= a.end_date
  )

  const sundayLockedOpIds = new Set(
    lockedSlots.filter(r => r.dateISO === sunISO).map(r => r.operatorId)
  )

  const recurringDomOpIds = new Set(
    operators
      .filter(op => (op.recurring_shifts ?? []).some(rs => rs.day === 'Domenica'))
      .map(op => op.id)
  )

  const weekendEligible = operators.filter(op =>
    !absentOn(op.id, sunISO) &&
    !sundayLockedOpIds.has(op.id) &&
    !recurringDomOpIds.has(op.id)
  )

  const maxOff = Math.max(0, weekendEligible.length - 3)

  const prevSunISO = (() => {
    const d = new Date(weekDaysISO[6])
    d.setDate(d.getDate() - 7)
    return d.toISOString().slice(0, 10)
  })()

  const wasOnLeaveLastSunday = op => approvedAbsences.some(a =>
    a.user_id === op.id && prevSunISO >= a.start_date && prevSunISO <= a.end_date
  )

  const sortedEligible = [...weekendEligible].sort((a, b) => {
    const aOnLeave = wasOnLeaveLastSunday(a)
    const bOnLeave = wasOnLeaveLastSunday(b)
    if (aOnLeave && !bOnLeave) return 1
    if (!aOnLeave && bOnLeave) return -1

    const aCount = recentCounts[a.id] ?? 0
    const bCount = recentCounts[b.id] ?? 0
    if (aCount !== bCount) return bCount - aCount

    const aNullFresh = !a.last_weekend_off && aCount === 0
    const bNullFresh = !b.last_weekend_off && bCount === 0
    if (aNullFresh && !bNullFresh) return 1
    if (!aNullFresh && bNullFresh) return -1

    if (!a.last_weekend_off && !b.last_weekend_off)
      return (a.full_name ?? '').localeCompare(b.full_name ?? '')
    if (!a.last_weekend_off) return -1
    if (!b.last_weekend_off) return 1

    const dateDiff = new Date(a.last_weekend_off) - new Date(b.last_weekend_off)
    if (dateDiff !== 0) return dateDiff
    return (a.full_name ?? '').localeCompare(b.full_name ?? '')
  })

  const offIds = sortedEligible.slice(0, maxOff).map(o => o.id)

  const onIds = [...weekendEligible]
    .filter(op =>
      !offIds.includes(op.id) &&
      !prevWorkedIds.has(op.id) &&
      (op.max_hours_per_week ?? 0) >= 6
    )
    .sort((a, b) => {
      const aCount = recentCounts[a.id] ?? 0
      const bCount = recentCounts[b.id] ?? 0
      if (aCount !== bCount) return aCount - bCount
      return (b.max_hours_per_week ?? 0) - (a.max_hours_per_week ?? 0)
    })
    .slice(0, 6)
    .map(op => op.id)

  return { offIds, onIds }
}

// ─── Funzione principale ──────────────────────────────────────────────────────

/**
 * @param {string[][]}   params.weeks                  4-5 array di 7 ISO dates (Lun→Dom)
 * @param {string[]}     params.monthDays              ISO dates del mese (senza padding)
 * @param {Array}        params.operators
 * @param {Array}        params.approvedAbsences        { user_id, start_date, end_date, ... }
 * @param {Array}        params.lockedSlots             { dateISO, shift, operatorId }
 * @param {Array}        params.recurringSlots          { operatorId, dayName, shift }
 * @param {Array}        params.crossStructureSlots     [{ userId, dateISO, shiftType }]
 * @param {string[]}     params.prevMonthWorkedIds      IDs che hanno lavorato l'ultimo weekend del mese precedente (CROSS-STRUTTURA)
 * @param {object}       params.recentWeekendCounts     { [userId]: count }
 * @param {Function}     [params.onWeekProgress]        callback(step, total)
 * @param {boolean}      [params.debugMode]
 * @param {object}       [params.initialMonthHoursConsumed]  Ore già consumate nelle settimane
 *                        precedenti (usato dalla generazione settimanale per alimentare V4m
 *                        con il budget già speso nel mese corrente). Default: {}.
 * @param {string|null}  [params.prevSundayNightOpId]  ID operatore che ha fatto la Notte
 *                        della domenica immediatamente prima di weeks[0]. Usato per applicare
 *                        V3 cross-week (Dom-notte → Lun-mattina). Default: null.
 */
export function generateMonthlySchedule({
  weeks,
  monthDays,
  operators,
  approvedAbsences           = [],
  lockedSlots                = [],
  recurringSlots             = [],
  crossStructureSlots        = [],
  prevMonthWorkedIds         = [],
  recentWeekendCounts        = {},
  onWeekProgress             = null,
  debugMode                  = false,
  initialMonthHoursConsumed  = {},
  prevSundayNightOpId        = null,
  totalWeeksInMonth          = null,
}) {
  if (!operators?.length)
    return { success: false, failedWeekIndex: 0, error: 'Nessun operatore disponibile.' }
  if (!weeks?.length)
    return { success: false, failedWeekIndex: 0, error: 'Nessuna settimana da pianificare.' }

  const totalSteps = weeks.length * 3

  // ── Budget mensile per operatore (solo per ordinamento per saturazione) ─────
  // Target = max_hours_per_week × numero di settimane nel mese.
  // NON è un hard cap: il vincolo hard è V4 (settimanale), che evita blocchi
  // a cascata per contratti eterogenei e funziona correttamente per settimane
  // a cavallo tra mesi. Questo valore serve solo a sortBySaturation per
  // preferire gli operatori meno saturi nelle assegnazioni successive.
  const monthlyTargets = {}
  for (const op of operators) {
    if (op.max_hours_per_week > 0)
      monthlyTargets[op.id] = op.max_hours_per_week * (totalWeeksInMonth ?? weeks.length)
  }

  // Ore assegnate dall'inizio del mese — aggiornato dopo ogni fase.
  // Inizializzato con le ore già pubblicate nelle settimane precedenti
  // (valorizzato dalla generazione settimanale; {} per la generazione mensile classica).
  const monthHoursConsumed = { ...initialMonthHoursConsumed }

  // Ordina operatori per saturazione crescente (meno saturato = priorità alta).
  // Operatori senza target (illimitati) vanno in coda: riempiono i buchi.
  function sortBySaturation(ops) {
    return [...ops].sort((a, b) => {
      const tA = monthlyTargets[a.id] ?? 0
      const tB = monthlyTargets[b.id] ?? 0
      if (tA === 0 && tB === 0) return 0
      if (tA === 0) return 1    // illimitato → in coda
      if (tB === 0) return -1
      const satA = (monthHoursConsumed[a.id] ?? 0) / tA
      const satB = (monthHoursConsumed[b.id] ?? 0) / tB
      return satA - satB        // ascending: meno saturato prima
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 1 — Blindatura di tutte le Domeniche (cross-struttura)
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Algoritmo di Pre-Assegnazione:
  //  1. prevWorkedIds inizia con chi ha lavorato l'ultima domenica del mese precedente
  //     (dato cross-struttura dal RPC get_prev_weekend_worked).
  //  2. Dopo ogni domenica, prevWorkedIds viene aggiornato con:
  //     - chi ha lavorato domenica in QUESTA struttura (appena assegnato)
  //     - chi lavora domenica in ALTRE strutture (da crossStructureSlots)
  //  3. Questi operatori sono "Inibiti" per la domenica successiva: cascata.

  let prevWorkedIds       = new Set(prevMonthWorkedIds)
  const localRecentCounts = { ...recentWeekendCounts }

  const weekendLockedSlots  = []   // Accumula Sab+Dom bloccati
  const sundayWorkedByWeek  = []   // Set<opId> per ogni settimana
  const weekendOffIdsByWeek = []
  const weekendOnIdsByWeek  = []
  const sundayWarnings      = []   // Avvisi per slot domenicali vuoti

  for (let i = 0; i < weeks.length; i++) {
    const weekDaysISO = weeks[i]
    const sundayISO   = weekDaysISO[6]

    onWeekProgress?.(i, totalSteps)

    // Calcola la rotazione domenicale (V8: chi riposa questa domenica)
    const weekLockedSlots = lockedSlots.filter(ls => weekDaysISO.includes(ls.dateISO))
    const { offIds, onIds } = computeWeekendRotation({
      weekDaysISO, operators, approvedAbsences,
      lockedSlots: weekLockedSlots, recurringSlots,
      prevWorkedIds, recentCounts: localRecentCounts,
    })
    weekendOffIdsByWeek.push(offIds)
    weekendOnIdsByWeek.push(onIds)

    // V12 — effectivePrevWorkedIds = prevWorkedIds senza filtri.
    //
    // Il filtro "assenza domenica scorsa" che esisteva qui era sbagliato:
    // prevWorkedIds contiene solo chi è stato effettivamente ASSEGNATO
    // (viene da sundayWorked/assignedOps o dal DB cross-struttura).
    // Se un operatore è in prevWorkedIds, ha lavorato — l'eventuale assenza
    // parziale (es. pomeriggio bloccato ma mattina assegnata) non cancella
    // il fatto che ha fatto un turno, e V12 deve restare attivo.
    // Rimuovere l'operatore da effectivePrevWorkedIds in quel caso causava
    // la violazione della domenica alternata.
    const effectivePrevWorkedIds = new Set(prevWorkedIds)

    // Slot già bloccati per questa domenica (lucchetti DB + ricorrenti)
    const preLockedForSunday = [
      ...weekLockedSlots.filter(ls => ls.dateISO === sundayISO),
      ...recurringForDay(recurringSlots, operators, sundayISO),
    ]

    const crossSlotsForSunday = crossStructureSlots.filter(s => s.dateISO === sundayISO)

    // ── DEBUG: isSundayAvailable per ogni operatore ──────────────────────
    if (debugMode) {
      console.group(`[FASE 1 — DOM] ${sundayISO}  (settimana ${i + 1}/${weeks.length})`)
      console.log('prevWorkedIds (raw, cross-struttura):', [...prevWorkedIds])
      console.log('effectivePrevWorkedIds (filtrato assenze):', [...effectivePrevWorkedIds])
      console.log('V8 offIds (gruppo riposo):', offIds)

      for (const op of operators) {
        const check = isSundayAvailable(op.id, sundayISO, {
          prevWorkedIds: effectivePrevWorkedIds,
          operators,
        })
        const v8 = offIds.includes(op.id) ? ' | V8: nel gruppo riposo' : ''
        // Mostra anche V5/V11 per singola fascia (informativo, non blocca il giorno intero)
        const perShift = SHIFTS.map(s => {
          const abs = isAbsent(op.id, sundayISO, s, approvedAbsences)
          const cross = crossSlotsForSunday.some(cs => cs.userId === op.id && cs.shiftType === s)
          return abs ? `${s}:ferie` : cross ? `${s}:altra-sede` : null
        }).filter(Boolean).join(', ')
        const icon = check.available && !offIds.includes(op.id) ? '✅' : '❌'
        const reason = check.available
          ? `disponibile${v8}${perShift ? ` [slot bloccati: ${perShift}]` : ''}`
          : `${check.reason}${v8}`
        console.log(`  ${icon} ${op.full_name}: ${reason}`)
      }
      console.groupEnd()
    }

    // ── PRIMO FILTRO: forbiddenIds solo per vincoli giornata-intera ──────
    // isSundayAvailable controlla SOLO V12 e V6 — vincoli che escludono
    // l'operatore da tutti i turni della domenica.
    // V5 (assenze) e V11 (cross-struttura) sono gestiti per-fascia
    // dentro solveDaySlots → isAbsent() e crossSlots.some().
    const forbiddenByAvailability = new Set()
    for (const op of operators) {
      const check = isSundayAvailable(op.id, sundayISO, {
        prevWorkedIds: effectivePrevWorkedIds,
        operators,
      })
      if (!check.available) forbiddenByAvailability.add(op.id)
    }

    // Forbidden completo: isSundayAvailable + V8 (rotazione off-group)
    const forbiddenFull = new Set([...forbiddenByAvailability, ...offIds])
    // Forbidden solo da isSundayAvailable (fallback se V8 rende impossibile)
    const forbiddenV12Only = new Set([...forbiddenByAvailability])

    // Operatori ordinati per saturazione: meno saturati vengono preferiti dal solver
    const sortedOperators = sortBySaturation(operators)

    // ── Tentativo 1: V12 + V8 completo ──────────────────────────────────
    let assignment = solveDaySlots({
      dayISO:              sundayISO,
      operators:           sortedOperators,
      approvedAbsences,
      crossSlots:          crossSlotsForSunday,
      preLockedForDay:     preLockedForSunday,
      forbiddenIds:        forbiddenFull,
      weekHoursConsumed:   {},   // domenica è la prima cosa assegnata: budget pieno
      monthHoursConsumed,
      monthlyTargets,
    })

    // ── Tentativo 2: rilassa V8, mantieni V12 ───────────────────────────
    if (!assignment) {
      if (debugMode) console.warn(`[FASE 1 — DOM] ${sundayISO}: V8 rilassato (fallback 1)`)
      assignment = solveDaySlots({
        dayISO:              sundayISO,
        operators:           sortedOperators,
        approvedAbsences,
        crossSlots:          crossSlotsForSunday,
        preLockedForDay:     preLockedForSunday,
        forbiddenIds:        forbiddenV12Only,
        weekHoursConsumed:   {},
        monthHoursConsumed,
        monthlyTargets,
      })
    }

    // ── Tentativo 3: V12 hard + allowEmpty (slot vuoti > violazione V12) ─
    if (!assignment) {
      if (debugMode) console.warn(`[FASE 1 — DOM] ${sundayISO}: allowEmpty attivo (fallback 2)`)
      assignment = solveDaySlots({
        dayISO:              sundayISO,
        operators:           sortedOperators,
        approvedAbsences,
        crossSlots:          crossSlotsForSunday,
        preLockedForDay:     preLockedForSunday,
        forbiddenIds:        forbiddenV12Only,
        weekHoursConsumed:   {},
        monthHoursConsumed,
        monthlyTargets,
        allowEmpty:          true,
      })
    }

    // Fallback di ultima istanza: tutti i turni della domenica restano vuoti
    if (!assignment) {
      if (debugMode) console.warn(`[FASE 1 — DOM] ${sundayISO}: tutti i turni vuoti (fallback 3)`)
      assignment = { mattina: null, pomeriggio: null, notte: null }
    }

    // ── Blocca turni risolti, lascia vuoti quelli senza candidati ────────
    const assignedOps = new Set()
    for (const [shift, opId] of Object.entries(assignment)) {
      if (opId) {
        weekendLockedSlots.push({ dateISO: sundayISO, shift, operatorId: opId })
        assignedOps.add(opId)
      } else {
        // Slot vuoto: usa UNASSIGNED_MARKER così Phase 3 lo salta
        weekendLockedSlots.push({ dateISO: sundayISO, shift, operatorId: UNASSIGNED_MARKER })
        sundayWarnings.push(
          `Domenica ${sundayISO} ${shift}: nessun operatore disponibile (V12 cross-struttura). ` +
          `Il turno è stato lasciato vuoto per assegnazione manuale.`
        )
        if (debugMode) {
          console.warn(`[FASE 1 — DOM] ⚠️ ${sundayISO} ${shift}: VUOTO — nessun candidato dopo V12`)
        }
      }
    }

    // ── Aggiorna prevWorkedIds per la prossima domenica ──────────────────
    // CROSS-STRUTTURA: include chi lavora questa domenica in QUALSIASI struttura.
    // Questo è il fix critico: prima si tracciava solo questa struttura,
    // perdendo il tracking cross-org dopo la prima settimana.
    const sundayWorked = new Set(assignedOps)
    for (const s of crossStructureSlots) {
      if (s.dateISO === sundayISO) sundayWorked.add(s.userId)
    }
    sundayWorkedByWeek.push(sundayWorked)

    prevWorkedIds = sundayWorked
    for (const id of assignedOps)
      localRecentCounts[id] = (localRecentCounts[id] ?? 0) + 1

    // Aggiorna consumo mensile con le ore domenicali appena assegnate
    for (const [shift, opId] of Object.entries(assignment)) {
      if (opId && opId !== UNASSIGNED_MARKER)
        monthHoursConsumed[opId] = (monthHoursConsumed[opId] ?? 0) + SHIFT_HRS[shift]
    }

    if (debugMode) {
      console.log(`[FASE 1 — DOM] ${sundayISO}: assegnati ${[...assignedOps].length}/3 turni`)
      console.log('  → prevWorkedIds (cross-struttura) per prossima dom:', [...prevWorkedIds])
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 2 — Assegnazione di tutti i Sabati
  // ═══════════════════════════════════════════════════════════════════════════

  for (let i = 0; i < weeks.length; i++) {
    const weekDaysISO = weeks[i]
    const saturdayISO = weekDaysISO[5]

    onWeekProgress?.(weeks.length + i, totalSteps)

    const weekLockedSlots = lockedSlots.filter(ls => weekDaysISO.includes(ls.dateISO))
    const preLockedForSat = [
      ...weekLockedSlots.filter(ls => ls.dateISO === saturdayISO),
      ...recurringForDay(recurringSlots, operators, saturdayISO),
    ]

    // Soft: chi lavora domenica questa settimana → preferire non dargli anche sabato
    const softForbiddenIds = sundayWorkedByWeek[i] ?? new Set()

    // Ore già consumate questa settimana: solo domenica
    const weekHoursConsumed = {}
    for (const ls of weekendLockedSlots) {
      if (!weekDaysISO.includes(ls.dateISO)) continue
      if (ls.operatorId === UNASSIGNED_MARKER) continue
      if (new Date(ls.dateISO + 'T12:00:00').getDay() !== 0) continue
      weekHoursConsumed[ls.operatorId] = (weekHoursConsumed[ls.operatorId] ?? 0) + SHIFT_HRS[ls.shift]
    }

    const crossSlotsForSat = crossStructureSlots.filter(s => s.dateISO === saturdayISO)

    if (debugMode) {
      console.group(`[FASE 2 — SAB] ${saturdayISO}`)
      console.log('softForbidden (Dom workers):', [...softForbiddenIds])
      console.log('weekHoursConsumed:', weekHoursConsumed)
      console.groupEnd()
    }

    const sortedOperatorsSat = sortBySaturation(operators)

    let satAssignment = solveDaySlots({
      dayISO:              saturdayISO,
      operators:           sortedOperatorsSat,
      approvedAbsences,
      crossSlots:          crossSlotsForSat,
      preLockedForDay:     preLockedForSat,
      forbiddenIds:        new Set(),
      softForbiddenIds,
      weekHoursConsumed,
      monthHoursConsumed,
      monthlyTargets,
    })

    // Fallback: allowEmpty — lascia vuoti gli slot impossibili anziché bloccare tutto
    if (!satAssignment) {
      if (debugMode) console.warn(`[FASE 2 — SAB] ${saturdayISO}: allowEmpty attivo (fallback)`)
      satAssignment = solveDaySlots({
        dayISO:              saturdayISO,
        operators:           sortedOperatorsSat,
        approvedAbsences,
        crossSlots:          crossSlotsForSat,
        preLockedForDay:     preLockedForSat,
        forbiddenIds:        new Set(),
        softForbiddenIds:    null,
        weekHoursConsumed,
        monthHoursConsumed,
        monthlyTargets,
        allowEmpty:          true,
      })
    }

    if (satAssignment) {
      for (const [shift, opId] of Object.entries(satAssignment)) {
        if (opId) {
          weekendLockedSlots.push({ dateISO: saturdayISO, shift, operatorId: opId })
          // Aggiorna consumo mensile con le ore sabato appena assegnate
          monthHoursConsumed[opId] = (monthHoursConsumed[opId] ?? 0) + SHIFT_HRS[shift]
        } else {
          weekendLockedSlots.push({ dateISO: saturdayISO, shift, operatorId: UNASSIGNED_MARKER })
          sundayWarnings.push(
            `Sabato ${saturdayISO} ${shift}: nessun operatore disponibile. ` +
            `Il turno è stato lasciato vuoto per assegnazione manuale.`
          )
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 3 — Completamento feriali (Lun–Ven)
  // ═══════════════════════════════════════════════════════════════════════════

  const weekResults   = []
  const allRelaxed    = new Set()
  const allViolations = new Set()
  const allSplits     = new Set()

  for (let i = 0; i < weeks.length; i++) {
    const weekDaysISO = weeks[i]

    onWeekProgress?.(weeks.length * 2 + i, totalSteps)

    // Unisce i locked originali con Sab+Dom già bloccati nelle fasi 1+2.
    const weekLockedSlots = [
      ...lockedSlots.filter(ls => weekDaysISO.includes(ls.dateISO)),
      ...weekendLockedSlots.filter(ls => weekDaysISO.includes(ls.dateISO)),
    ]
    const weekCrossSlots = crossStructureSlots.filter(s => weekDaysISO.includes(s.dateISO))
    const offIds = weekendOffIdsByWeek[i] ?? []
    const onIds  = weekendOnIdsByWeek[i]  ?? []

    // Operatori ordinati per saturazione mensile corrente
    const sortedOpsWeek = sortBySaturation(operators)

    // ── Tentativo 1: solver settimanale completo (21 slot simultanei) ────
    const result = generateWeeklySchedule({
      weekDays:             weekDaysISO,
      operators:            sortedOpsWeek,
      approvedAbsences,
      lockedSlots:          weekLockedSlots,
      recurringSlots,
      weekendOffIds:        offIds,
      weekendOnIds:         onIds,
      crossStructureSlots:  weekCrossSlots,
      prevWeekendWorkedIds: [],   // domenica già blindata in Fase 1
      monthHoursConsumed,
      monthlyTargets,
      debugMode,
      // V3 cross-week: solo per la prima settimana (i=0). Per i>0 il gap pre-esistente
      // (Dom-notte di settimana N → Lun-mattina di settimana N+1) non è ancora risolto
      // nel percorso mensile; viene gestito nell'uso settimanale tramite handleGenerate.
      prevSundayNightOpId: i === 0 ? prevSundayNightOpId : null,
    })

    if (result.success) {
      // Aggiorna consumo mensile con le ore FERIALI (Lun-Ven) di questa settimana.
      // Sab e Dom sono già stati aggiunti a monthHoursConsumed in Fase 1 e Fase 2:
      // contarli di nuovo gonfia il consumo e fa scattare il cap mensile troppo presto.
      for (const [dateISO, dayShifts] of Object.entries(result.schedule)) {
        const dow = new Date(dateISO + 'T12:00:00').getDay()
        if (dow === 0 || dow === 6) continue  // Sab/Dom già contati in Fase 1/2
        for (const [shiftType, slotData] of Object.entries(dayShifts)) {
          if (slotData?.operatorId)
            monthHoursConsumed[slotData.operatorId] =
              (monthHoursConsumed[slotData.operatorId] ?? 0) + (SHIFT_HRS[shiftType] ?? 0)
        }
      }
      weekResults.push({
        ...result,
        weekIndex: i, weekDaysISO, weekendOffIds: offIds, weekendOnIds: onIds,
      })
      for (const p of (result.relaxedPreferences ?? [])) allRelaxed.add(p)
      for (const viol of (result.weekendViolations ?? [])) allViolations.add(viol)
      for (const s of (result.splitWeekendNames   ?? [])) allSplits.add(s)
      continue  // settimana risolta, prossima
    }

    // ── Tentativo 2 (fallback): giorno per giorno con allowEmpty ─────────
    // Il solver settimanale è all-or-nothing: se anche 1 slot su 21 è
    // impossibile, fallisce tutto. Qui risolviamo Lun→Ven singolarmente.
    // Sab e Dom sono già bloccati dalle Fasi 1+2.
    console.warn(`[TURNO] FASE 3 sett.${i + 1}: solver settimanale fallito → fallback giorno-per-giorno`)

    const dayByDaySchedule = {}
    for (const iso of weekDaysISO) dayByDaySchedule[iso] = {}

    // Inserisci gli slot weekend già risolti dalle fasi 1+2
    for (const ls of weekLockedSlots) {
      if (ls.operatorId === UNASSIGNED_MARKER) continue
      const op = operators.find(o => o.id === ls.operatorId)
      if (!op) continue
      if (!dayByDaySchedule[ls.dateISO]) dayByDaySchedule[ls.dateISO] = {}
      dayByDaySchedule[ls.dateISO][ls.shift] = {
        operatorId: op.id, operatorName: op.full_name, isPreassigned: true,
      }
    }

    // Calcola ore settimanali già consumate dai weekend bloccati
    const weekHoursConsumed = {}
    for (const ls of weekLockedSlots) {
      if (ls.operatorId === UNASSIGNED_MARKER) continue
      weekHoursConsumed[ls.operatorId] = (weekHoursConsumed[ls.operatorId] ?? 0) + (SHIFT_HRS[ls.shift] ?? 0)
    }

    // Risolvi Lun→Ven (indici 0-4) in sequenza, propagando V3 (notte→mattina).
    // Per i=0: inizializza con chi ha fatto Dom-notte della settimana precedente
    // (V3 cross-week). Per i>0: il gap Dom-notte → Lun-mattina non è ancora risolto
    // nel percorso mensile (pre-esistente; gestito nell'uso settimanale).
    let prevNightOpId = i === 0 ? (prevSundayNightOpId ?? null) : null
    for (let d = 0; d < 5; d++) {
      const dayISO = weekDaysISO[d]
      const dow    = new Date(dayISO + 'T12:00:00').getDay()

      // Se il giorno è già tutto coperto da locked slots, skip
      const preLockedForDay = [
        ...weekLockedSlots.filter(ls => ls.dateISO === dayISO),
        ...recurringForDay(recurringSlots, operators, dayISO),
      ]
      const crossSlotsForDay = weekCrossSlots.filter(s => s.dateISO === dayISO)

      const assignment = solveDaySlots({
        dayISO,
        operators:           sortBySaturation(operators),
        approvedAbsences,
        crossSlots:          crossSlotsForDay,
        preLockedForDay,
        forbiddenIds:        new Set(),
        weekHoursConsumed,
        monthHoursConsumed,
        monthlyTargets,
        allowEmpty:          true,
        prevNightOpId,
      })

      if (assignment) {
        // ── Diagnosi slot vuoti e recovery con budget rilassato ─────────────
        // Un turno feriale non può restare vuoto per soli motivi di budget settimanale (V4).
        // L'unica ragione legittima per un vuoto è V5/V6/V11 (impossibilità assoluta).
        // V12 (domenica alternata) non si applica ai feriali Lun-Ven.
        const emptyAfterFirst = SHIFTS.filter(s => assignment[s] === null)

        if (emptyAfterFirst.length > 0) {
          const dayDowLocal = new Date(dayISO + 'T12:00:00').getDay()

          // ── Log obbligatorio: motivo per ogni operatore scartato ──────────
          for (const shift of emptyAfterFirst) {
            const shiftHrs = SHIFT_HRS[shift]
            console.warn(`[FASE 3 — VUOTO] ${dayISO} turno "${shift}": diagnosi operatori`)
            for (const op of operators) {
              let reason
              if (isAbsent(op.id, dayISO, shift, approvedAbsences))
                reason = 'V5: assenza approvata — HARD (vuoto legittimo)'
              else if (crossSlotsForDay.some(s => s.userId === op.id))
                reason = 'V11: turno in altra struttura quel giorno — HARD (vuoto legittimo)'
              else if (op.shift_avoid === shift)
                reason = 'V10: turno da evitare nel contratto — HARD'
              else if (op.weekly_rest_day && GIORNO_DOW[op.weekly_rest_day] === dayDowLocal)
                reason = 'V6: giorno di riposo fisso — HARD'
              else if (shift === 'mattina' && prevNightOpId && op.id === prevNightOpId)
                reason = 'V3: ha fatto la notte del giorno precedente — HARD'
              else if (monthlyTargets[op.id] > 0 &&
                  (monthHoursConsumed[op.id] ?? 0) + shiftHrs > monthlyTargets[op.id])
                reason = `V4m: cap mensile (${monthHoursConsumed[op.id] ?? 0}h / ${monthlyTargets[op.id]}h) — RILASSABILE`
              else if (op.max_hours_per_week > 0 &&
                  shiftHrs > op.max_hours_per_week - (weekHoursConsumed[op.id] ?? 0))
                reason = `V4: budget settimanale (${weekHoursConsumed[op.id] ?? 0}h / ${op.max_hours_per_week}h) — RILASSABILE`
              else
                reason = `disponibile (non selezionato — ${weekHoursConsumed[op.id] ?? 0}h consumate)`
              console.log(`  Giorno ${dayISO}, Operatore ${op.full_name} scartato: ${reason}`)
            }
          }

          // ── Seconda passata: V4/V4m RISPETTATI — meglio uno slot vuoto che sforare il limite orario.
          // I vincoli hard (V5, V6, V11, V3) restano invariati.
          const alreadyFilledLocks = SHIFTS
            .filter(s => assignment[s] !== null)
            .map(s => ({ dateISO: dayISO, shift: s, operatorId: assignment[s] }))

          const assignment2 = solveDaySlots({
            dayISO,
            operators:         sortBySaturation(operators),
            approvedAbsences,
            crossSlots:        crossSlotsForDay,
            preLockedForDay:   [...preLockedForDay, ...alreadyFilledLocks],
            forbiddenIds:      new Set(),
            weekHoursConsumed,
            monthHoursConsumed,
            monthlyTargets,
            allowEmpty:        true,
            prevNightOpId,
            relaxBudget:       false,  // V4/V4m assoluti: mai superare il limite orario
          })

          if (assignment2) {
            for (const shift of emptyAfterFirst) {
              if (assignment2[shift] !== null) {
                assignment[shift] = assignment2[shift]
                console.log(
                  `[FASE 3 — RIEMPITO] ${dayISO} "${shift}": assegnato ${assignment2[shift]}` +
                  ` (seconda passata con V4/V4m rispettati)`
                )
              } else {
                // Ancora vuoto: nessun operatore disponibile nei limiti orari → slot vuoto
                console.warn(
                  `[FASE 3 — VUOTO] ${dayISO} "${shift}": nessun operatore disponibile nel rispetto del limite orario.` +
                  ` Slot lasciato vuoto per assegnazione manuale.`
                )
              }
            }
          }
        }

        // ── Registra turni e aggiorna budget ──────────────────────────────
        for (const [shift, opId] of Object.entries(assignment)) {
          if (opId) {
            const op = operators.find(o => o.id === opId)
            if (op) {
              dayByDaySchedule[dayISO][shift] = { operatorId: op.id, operatorName: op.full_name }
              weekHoursConsumed[opId]  = (weekHoursConsumed[opId]  ?? 0) + SHIFT_HRS[shift]
              monthHoursConsumed[opId] = (monthHoursConsumed[opId] ?? 0) + SHIFT_HRS[shift]
            }
          } else {
            sundayWarnings.push(
              `${dayISO} ${shift}: nessun operatore disponibile (causa assoluta). Turno lasciato vuoto.`
            )
          }
        }
        // Propaga V3 per il giorno successivo
        prevNightOpId = assignment.notte ?? null
      } else {
        // Anche con allowEmpty il SAT non trova soluzione (non dovrebbe succedere)
        if (debugMode) console.warn(`[FASE 3] ${dayISO}: impossibile anche con allowEmpty`)
        for (const shift of SHIFTS) {
          sundayWarnings.push(`${dayISO} ${shift}: nessun operatore disponibile. Turno lasciato vuoto.`)
        }
        prevNightOpId = null
      }
    }

    weekResults.push({
      success: true, schedule: dayByDaySchedule,
      relaxedPreferences: [], weekendViolations: [], splitWeekendNames: [],
      weekIndex: i, weekDaysISO, weekendOffIds: offIds, weekendOnIds: onIds,
    })
  }

  onWeekProgress?.(totalSteps, totalSteps)

  // Unisce tutti gli schedule
  const schedule = {}
  for (const wr of weekResults) Object.assign(schedule, wr.schedule)

  // ─── Verifica equità mensile (≥ 2 domeniche libere in mesi ≥ 4 settimane) ──
  const monthDaySet        = new Set(monthDays)
  const weekEquityWarnings = []
  const weeksInMonth       = weekResults.filter(wr => wr.weekDaysISO.some(d => monthDaySet.has(d)))
  if (weeksInMonth.length >= 4) {
    const freeWeekendCount = Object.fromEntries(operators.map(op => [op.id, 0]))
    for (const wr of weeksInMonth) {
      const workedThis = extractSundayWorkedIds(wr.schedule, wr.weekDaysISO)
      for (const op of operators)
        if (!workedThis.has(op.id)) freeWeekendCount[op.id]++
    }
    for (const op of operators) {
      if ((freeWeekendCount[op.id] ?? 0) < 2)
        weekEquityWarnings.push(op.full_name)
    }
  }

  return {
    success: true,
    schedule,
    weeks:              weekResults,
    weekendOffIdsByWeek,
    weekendOnIdsByWeek,
    relaxedPreferences: [...allRelaxed],
    weekendViolations:  [...allViolations],
    splitWeekendNames:  [...allSplits],
    weekEquityWarnings,
    sundayWarnings,      // ← NUOVO: turni domenicali lasciati vuoti
  }
}
