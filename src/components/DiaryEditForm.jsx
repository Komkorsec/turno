import { useState } from 'react'
import { supabase } from '../lib/supabase'

const MOOD_OPTIONS = [
  { value: 1, emoji: '😔', label: 'Molto difficile' },
  { value: 2, emoji: '😕', label: 'Difficile'       },
  { value: 3, emoji: '😐', label: 'Nella norma'     },
  { value: 4, emoji: '🙂', label: 'Buono'           },
  { value: 5, emoji: '😊', label: 'Ottimo'          },
]
const MOOD_ACTIVE = {
  1: 'bg-red-500    border-red-500    text-white',
  2: 'bg-orange-500 border-orange-500 text-white',
  3: 'bg-amber-500  border-amber-500  text-white',
  4: 'bg-lime-500   border-lime-500   text-white',
  5: 'bg-green-500  border-green-500  text-white',
}
const INCIDENT_TYPES = [
  { value: 'conflitto_ragazzi', label: 'Conflitto tra ragazzi' },
  { value: 'fuga',              label: 'Fuga'                  },
  { value: 'problema_esterno',  label: 'Problema esterno'      },
  { value: 'altro',             label: 'Altro'                 },
]

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('it-IT', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function DiaryEditForm({ diary, profile, onEdited, onCancel }) {
  const [form, setForm] = useState({
    mood:          diary.mood,
    hasIncident:   diary.has_incident,
    incidentType:  diary.incident_type  ?? '',
    incidentNotes: diary.incident_notes ?? '',
    handoverNotes: diary.handover_notes ?? '',
    managerNotes:  diary.manager_notes  ?? '',
    shiftStart:    diary.shift_start    ?? '',
    shiftEnd:      diary.shift_end      ?? '',
  })
  const [status, setStatus]     = useState('idle') // idle | submitting | success | error
  const [errorMsg, setErrorMsg] = useState('')

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function validate() {
    if (form.mood === null)        return 'Seleziona l\'umore del turno.'
    if (form.hasIncident === null)  return 'Indica se ci sono stati episodi critici.'
    if (form.hasIncident && !form.incidentType) return 'Seleziona la categoria dell\'episodio.'
    return null
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const err = validate()
    if (err) { setErrorMsg(err); return }

    setErrorMsg('')
    setStatus('submitting')

    const { error } = await supabase.rpc('edit_diary', {
      p_diary_id:       diary.id,
      p_mood:           form.mood,
      p_has_incident:   form.hasIncident,
      p_incident_type:  form.hasIncident ? form.incidentType : null,
      p_incident_notes: form.hasIncident && form.incidentNotes.trim() ? form.incidentNotes.trim() : null,
      p_handover_notes: form.handoverNotes.trim() || null,
      p_manager_notes:  form.managerNotes.trim()  || null,
      p_shift_start:    form.shiftStart || null,
      p_shift_end:      form.shiftEnd   || null,
    })

    if (error) {
      const msg = error.message ?? ''
      if (msg.includes('report più recente')) {
        setErrorMsg('Non puoi più modificare questo report: un collega ha già inviato un turno successivo.')
      } else if (msg.includes('accesso negato')) {
        setErrorMsg('Non hai i permessi per modificare questo report.')
      } else {
        setErrorMsg('Errore durante il salvataggio. Riprova.')
      }
      setStatus('error')
      return
    }

    setStatus('success')
    setTimeout(() => onEdited(), 2500)
  }

  if (status === 'success') {
    return (
      <div className="rounded-2xl bg-green-50 border border-green-200 p-8 text-center">
        <div className="text-4xl mb-3">✅</div>
        <p className="font-semibold text-green-800 text-lg">Report aggiornato!</p>
        <p className="text-green-700 text-sm mt-1">La versione precedente è stata archiviata.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">

      {/* Banner informativo */}
      <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-3">
        <span className="text-lg shrink-0 mt-0.5">✏️</span>
        <div>
          <p className="text-sm font-semibold text-amber-800">Modifica report</p>
          <p className="text-xs text-amber-700 mt-0.5">
            Report del {formatDate(diary.created_at)}.
            La versione attuale verrà salvata automaticamente nello storico.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-7">

        {/* ORARIO TURNO */}
        <div>
          <label className="block text-sm font-semibold text-[#1a202c] mb-3">Orario del turno</label>
          <div className="grid grid-cols-2 gap-3">
            {[['shiftStart','Inizio'],['shiftEnd','Fine']].map(([field, label]) => (
              <div key={field} className="flex flex-col gap-1.5">
                <span className="text-xs text-[#718096] font-medium">{label}</span>
                <input
                  type="time"
                  value={form[field]}
                  onChange={e => set(field, e.target.value)}
                  className="w-full h-14 px-4 rounded-xl border border-[#e2e8f0] bg-white
                             text-[#1a202c] text-lg font-semibold text-center
                             outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 transition-colors"
                />
              </div>
            ))}
          </div>
        </div>

        {/* UMORE */}
        <div>
          <label className="block text-sm font-semibold text-[#1a202c] mb-3">
            Com'è andato il turno? <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-5 gap-2">
            {MOOD_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => set('mood', opt.value)}
                className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 py-3
                  transition-all active:scale-95
                  ${form.mood === opt.value ? MOOD_ACTIVE[opt.value] : 'bg-white border-[#e2e8f0]'}`}
              >
                <span className="text-2xl leading-none">{opt.emoji}</span>
                <span className="text-xs font-bold">{opt.value}</span>
              </button>
            ))}
          </div>
        </div>

        {/* EPISODI CRITICI */}
        <div>
          <label className="block text-sm font-semibold text-[#1a202c] mb-3">
            Ci sono stati episodi critici? <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            {[{ value: false, label: 'No' }, { value: true, label: 'Sì' }].map(opt => (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => {
                  set('hasIncident', opt.value)
                  if (!opt.value) { set('incidentType', ''); set('incidentNotes', '') }
                }}
                className={`h-14 rounded-xl border-2 font-semibold text-base transition-all active:scale-95
                  ${form.hasIncident === opt.value
                    ? (opt.value ? 'bg-red-500 border-red-500 text-white' : 'bg-[#1e3a5f] border-[#1e3a5f] text-white')
                    : 'bg-white border-[#e2e8f0] text-[#1a202c]'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {form.hasIncident === true && (
          <div className="flex flex-col gap-4 rounded-2xl bg-red-50 border border-red-100 p-4">
            <div>
              <label className="block text-sm font-semibold text-[#1a202c] mb-2">
                Categoria episodio <span className="text-red-500">*</span>
              </label>
              <select
                value={form.incidentType}
                onChange={e => set('incidentType', e.target.value)}
                className="w-full h-12 px-4 rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c] text-base
                           outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 appearance-none"
              >
                <option value="">Seleziona…</option>
                {INCIDENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#1a202c] mb-2">Descrizione episodio</label>
              <textarea
                rows={3}
                value={form.incidentNotes}
                onChange={e => set('incidentNotes', e.target.value)}
                placeholder="Descrivi brevemente cosa è successo…"
                className="w-full px-4 py-3 rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c] text-base
                           outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 resize-none placeholder:text-[#a0aec0]"
              />
            </div>
          </div>
        )}

        {/* PASSAGGIO DI CONSEGNE */}
        <div>
          <label className="block text-sm font-semibold text-[#1a202c] mb-2">Passaggio di consegne</label>
          <textarea
            rows={4}
            value={form.handoverNotes}
            onChange={e => set('handoverNotes', e.target.value)}
            placeholder="Cosa deve sapere il turno successivo?"
            className="w-full px-4 py-3 rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c] text-base
                       outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 resize-none placeholder:text-[#a0aec0]"
          />
        </div>

        {/* NOTE PER LA RESPONSABILE */}
        <div>
          <label className="block text-sm font-semibold text-[#1a202c] mb-2">Note per la responsabile</label>
          <textarea
            rows={3}
            value={form.managerNotes}
            onChange={e => set('managerNotes', e.target.value)}
            placeholder="Informazioni riservate per il management."
            className="w-full px-4 py-3 rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c] text-base
                       outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 resize-none placeholder:text-[#a0aec0]"
          />
        </div>

        {(errorMsg || status === 'error') && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {errorMsg || 'Errore durante il salvataggio. Riprova.'}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 h-12 rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c] font-semibold text-sm
                       active:bg-[#f8f9fa] transition-colors"
          >
            Annulla
          </button>
          <button
            type="submit"
            disabled={status === 'submitting'}
            className="flex-1 h-12 rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm
                       active:bg-[#152b47] disabled:opacity-60 transition-colors"
          >
            {status === 'submitting' ? 'Salvataggio…' : 'Salva modifiche'}
          </button>
        </div>

      </form>
    </div>
  )
}
