import { exportDiaryPdf } from '../../utils/exportPdf'
import DiaryComments from '../DiaryComments'

// ─── Costanti umore ───────────────────────────────────────────────────────────

const MOOD_EMOJI  = { 1: '😔', 2: '😕', 3: '😐', 4: '🙂', 5: '😊' }
export const MOOD_LABEL = { 1: 'Molto difficile', 2: 'Difficile', 3: 'Nella norma', 4: 'Buono', 5: 'Ottimo' }
const MOOD_COLOR  = { 1: '#ef4444', 2: '#f97316', 3: '#f59e0b', 4: '#84cc16', 5: '#22c55e' }
const MOOD_BG     = { 1: '#fef2f2', 2: '#fff7ed', 3: '#fffbeb', 4: '#f7fee7', 5: '#f0fdf4' }

export const INCIDENT_LABELS = {
  conflitto_ragazzi: 'Conflitto tra ragazzi',
  fuga:              'Fuga',
  problema_esterno:  'Problema esterno',
  altro:             'Altro',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatTime(t) {
  if (!t) return null
  return t.slice(0, 5)
}

export function formatDateTime(iso) {
  const d = new Date(iso)
  return (
    d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  )
}

// ─── Componente ──────────────────────────────────────────────────────────────

export default function DiaryRow({ diary, expanded, onToggle, onDelete, views = [], orgName, structureName, structureAddress, logoUrl, canViewManagerNotes = true }) {
  // Badge "Aggiornato dopo la lettura": edited_at esiste e viene dopo almeno una visualizzazione
  const updatedAfterRead = diary.edited_at && views.length > 0 &&
    views.some(v => new Date(diary.edited_at) > new Date(v.viewed_at))

  return (
    <div className="bg-white rounded-2xl border border-[#e2e8f0] overflow-hidden shadow-sm">
      {/* Trash button row */}
      {onDelete && (
        <div className="flex justify-end px-3 pt-2 pb-0">
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onDelete(diary) }}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[#a0aec0]
                       hover:text-red-500 hover:bg-red-50 active:bg-red-100 transition-colors"
            title="Elimina report"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      )}
      <button
        onClick={onToggle}
        className="w-full px-4 py-4 flex items-center gap-3 active:bg-[#f8f9fa] transition-colors text-left"
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-xl leading-none"
          style={{ backgroundColor: MOOD_BG[diary.mood] }}
        >
          {MOOD_EMOJI[diary.mood]}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-[#1a202c] text-sm">
              {diary.profiles?.full_name ?? 'Operatore'}
            </p>
            {(formatTime(diary.shift_start) || formatTime(diary.shift_end)) && (
              <span className="text-xs font-medium bg-[#eef2f7] text-[#1e3a5f] rounded-full px-2.5 py-0.5 shrink-0">
                {formatTime(diary.shift_start) ?? '?'} – {formatTime(diary.shift_end) ?? '?'}
              </span>
            )}
            {updatedAfterRead && (
              <span className="text-xs font-semibold bg-amber-100 text-amber-700 rounded-full px-2.5 py-0.5 shrink-0">
                Aggiornato
              </span>
            )}
          </div>
          <p className="text-xs text-[#718096] mt-0.5">{formatDateTime(diary.created_at)}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {diary.has_incident && (
            <span className="text-xs font-semibold bg-red-100 text-red-600 rounded-full px-2.5 py-1">
              Episodio
            </span>
          )}
          {/* Indicatore "visto da" */}
          {views.length > 0 && (
            <div className="flex items-center gap-0.5 text-blue-500">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              <span className="text-xs font-bold">{views.length}</span>
            </div>
          )}
          <svg
            className={`w-4 h-4 text-[#a0aec0] transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-5 flex flex-col gap-4 border-t border-[#f0f4f8]">
          <div className="flex items-center gap-2 pt-4 flex-wrap">
            <span
              className="text-xs font-semibold rounded-full px-3 py-1"
              style={{ backgroundColor: MOOD_BG[diary.mood], color: MOOD_COLOR[diary.mood] }}
            >
              {MOOD_EMOJI[diary.mood]} {MOOD_LABEL[diary.mood]} ({diary.mood}/5)
            </span>
            {(formatTime(diary.shift_start) || formatTime(diary.shift_end)) && (
              <span className="text-xs font-semibold bg-[#eef2f7] text-[#1e3a5f] rounded-full px-3 py-1">
                🕐 {formatTime(diary.shift_start) ?? '?'} – {formatTime(diary.shift_end) ?? '?'}
              </span>
            )}
            {diary.edited_at && (
              <span className="text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-3 py-1">
                ✏️ Modificato il {formatDateTime(diary.edited_at)}
              </span>
            )}
          </div>

          {diary.has_incident && (
            <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3">
              <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-1">
                Episodio critico — {INCIDENT_LABELS[diary.incident_type] ?? diary.incident_type}
              </p>
              {diary.incident_notes && (
                <p className="text-sm text-[#1a202c] leading-relaxed">{diary.incident_notes}</p>
              )}
            </div>
          )}

          {diary.handover_notes && (
            <div>
              <p className="text-xs font-semibold text-[#718096] uppercase tracking-wide mb-1">
                Passaggio di consegne
              </p>
              <p className="text-sm text-[#1a202c] leading-relaxed whitespace-pre-wrap">{diary.handover_notes}</p>
            </div>
          )}

          {canViewManagerNotes && diary.manager_notes && (
            <div>
              <p className="text-xs font-semibold text-[#718096] uppercase tracking-wide mb-1">
                Note per la responsabile
              </p>
              <p className="text-sm text-[#1a202c] leading-relaxed whitespace-pre-wrap">{diary.manager_notes}</p>
            </div>
          )}

          {!diary.handover_notes && !(canViewManagerNotes && diary.manager_notes) && !diary.has_incident && (
            <p className="text-sm text-[#a0aec0] italic">Nessuna nota aggiuntiva.</p>
          )}

          {/* Sezione "Visto da" */}
          {views.length > 0 && (
            <div className="pt-3 border-t border-[#f0f4f8]">
              <p className="text-xs font-semibold text-[#718096] uppercase tracking-wide mb-2">
                Visto da
              </p>
              <div className="flex flex-col gap-1.5">
                {views.map((v, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="font-bold text-blue-500 tracking-tighter">✓✓</span>
                    <span className="font-semibold text-[#1a202c]">{v.full_name}</span>
                    <span className="text-[#a0aec0]">{formatDateTime(v.viewed_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Commenti */}
          <div className="pt-4 border-t border-[#f0f4f8]">
            <p className="text-xs font-semibold text-[#718096] uppercase tracking-wide mb-3">
              Commenti
            </p>
            <DiaryComments diaryId={diary.id} />
          </div>

          {/* Azione export PDF */}
          <div className="pt-3 border-t border-[#f0f4f8] flex justify-end">
            <button
              type="button"
              onClick={() => exportDiaryPdf(diary, orgName, structureName, structureAddress, logoUrl)}
              className="flex items-center gap-1.5 h-8 px-3 rounded-xl border border-[#e2e8f0]
                bg-white text-[#1a202c] text-xs font-medium
                active:bg-[#f8f9fa] transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17a4 4 0 004 4h10a4 4 0 004-4v-1" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M4 4h16a1 1 0 011 1v5H3V5a1 1 0 011-1z" />
              </svg>
              Scarica PDF
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
