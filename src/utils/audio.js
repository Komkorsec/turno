/**
 * audio.js — Effetti sonori UI sintetizzati via Web Audio API
 * Nessun file esterno: i suoni vengono generati a runtime (carico zero).
 *
 * Tipi supportati:
 *   'success' — ding ascendente per salvataggi riusciti
 *   'error'   — bup discendente per errori e fallimenti
 *   'action'  — click/pop leggero per azioni (copia, conferma)
 */

const SFX_KEY = 'turno_sfx_enabled'

export function isSfxEnabled() {
  try { return localStorage.getItem(SFX_KEY) !== 'false' } catch { return true }
}

export function setSfxEnabled(value) {
  try { localStorage.setItem(SFX_KEY, value ? 'true' : 'false') } catch { /* noop */ }
}

// AudioContext condiviso e lazy (si crea solo al primo suono)
let _ctx = null
function getCtx() {
  if (!_ctx) {
    const Ctor = window.AudioContext ?? window.webkitAudioContext
    if (Ctor) _ctx = new Ctor()
  }
  return _ctx
}

export function playAudio(type) {
  if (!isSfxEnabled()) return
  if (typeof window === 'undefined') return
  try {
    const ctx = getCtx()
    if (!ctx) return
    if (ctx.state === 'suspended') ctx.resume()

    const t = ctx.currentTime

    if (type === 'success') {
      // Due note ascendenti (ding positivo)
      ;[
        { freq: 880,  start: 0,    dur: 0.35 },
        { freq: 1108, start: 0.12, dur: 0.28 },
      ].forEach(({ freq, start, dur }) => {
        const osc  = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, t + start)
        gain.gain.setValueAtTime(0, t + start)
        gain.gain.linearRampToValueAtTime(0.13, t + start + 0.015)
        gain.gain.exponentialRampToValueAtTime(0.001, t + start + dur)
        osc.start(t + start); osc.stop(t + start + dur)
      })

    } else if (type === 'error') {
      // Tono discendente cupo (bup)
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(320, t)
      osc.frequency.exponentialRampToValueAtTime(140, t + 0.22)
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.13, t + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28)
      osc.start(t); osc.stop(t + 0.28)

    } else if (type === 'action') {
      // Click/pop breve e leggero
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(680, t)
      osc.frequency.exponentialRampToValueAtTime(380, t + 0.07)
      gain.gain.setValueAtTime(0.09, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08)
      osc.start(t); osc.stop(t + 0.08)
    }
  } catch {
    // Silenzio se AudioContext non è disponibile
  }
}
