const MOOD_CONFIG = {
  1: { label: 'Molto difficile', color: '#ef4444', bg: '#fef2f2', emoji: '😔' },
  2: { label: 'Difficile',       color: '#f97316', bg: '#fff7ed', emoji: '😕' },
  3: { label: 'Nella norma',     color: '#f59e0b', bg: '#fffbeb', emoji: '😐' },
  4: { label: 'Buono',           color: '#84cc16', bg: '#f7fee7', emoji: '🙂' },
  5: { label: 'Ottimo',          color: '#22c55e', bg: '#f0fdf4', emoji: '😊' },
}

const INCIDENT_LABELS = {
  conflitto_ragazzi: 'Conflitto tra ragazzi',
  fuga:              'Fuga',
  problema_esterno:  'Problema esterno',
  altro:             'Altro',
}

function formatDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })
    + ' — '
    + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}

export default function LastDiaryCard({ diary }) {
  // Loading
  if (diary === undefined) {
    return (
      <div className="rounded-2xl bg-white border border-[#e2e8f0] p-5 animate-pulse">
        <div className="h-4 bg-[#e2e8f0] rounded w-1/3 mb-3" />
        <div className="h-3 bg-[#e2e8f0] rounded w-2/3 mb-2" />
        <div className="h-3 bg-[#e2e8f0] rounded w-1/2" />
      </div>
    )
  }

  // Empty state
  if (diary === null) {
    return (
      <div className="rounded-2xl bg-white border border-dashed border-[#cbd5e0] p-6 text-center">
        <p className="text-[#718096] text-sm">Nessun diario registrato per questa struttura.</p>
      </div>
    )
  }

  const mood = MOOD_CONFIG[diary.mood]

  return (
    <div className="rounded-2xl bg-white border border-[#e2e8f0] overflow-hidden">
      {/* Header card */}
      <div className="px-5 pt-4 pb-3 border-b border-[#f0f4f8]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-[#1a202c] text-sm leading-tight">
              {diary.profiles?.full_name ?? 'Operatore'}
            </p>
            <p className="text-[#a0aec0] text-xs mt-0.5">{formatDate(diary.created_at)}</p>
          </div>
          {/* Mood badge */}
          <div
            className="flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium shrink-0"
            style={{ backgroundColor: mood.bg, color: mood.color }}
          >
            <span>{mood.emoji}</span>
            <span className="hidden sm:inline">{mood.label}</span>
            <span className="font-bold">{diary.mood}/5</span>
          </div>
        </div>
      </div>

      <div className="px-5 py-4 flex flex-col gap-4">
        {/* Episodio critico */}
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

        {/* Passaggio di consegne */}
        {diary.handover_notes && (
          <div>
            <p className="text-xs font-semibold text-[#718096] uppercase tracking-wide mb-1">
              Passaggio di consegne
            </p>
            <p className="text-sm text-[#1a202c] leading-relaxed whitespace-pre-wrap">
              {diary.handover_notes}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
