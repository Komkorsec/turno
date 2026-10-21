// ─── Costanti esportate (usate anche in ManagerDashboard) ────────────────────

export const EMPTY_FILTERS = { dateFrom: '', dateTo: '', operatorId: '', onlyIncidents: false, preset: '' }

export function todayFilters() {
  const today = new Date().toISOString().slice(0, 10)
  return { ...EMPTY_FILTERS, preset: 'today', dateFrom: today, dateTo: today }
}

const DATE_PRESETS = [
  { id: 'today',  label: 'Oggi' },
  { id: '7days',  label: 'Ultimi 7gg' },
  { id: 'month',  label: 'Ultimo mese' },
  { id: 'custom', label: 'Personalizzato', icon: true },
]

// ─── Componente ──────────────────────────────────────────────────────────────

export default function FilterPanel({ filters, setFilters, operators }) {
  function set(field, value) {
    setFilters(prev => ({ ...prev, [field]: value }))
  }

  function applyPreset(preset) {
    const now   = new Date()
    const today = now.toISOString().slice(0, 10)
    let dateFrom = '', dateTo = ''

    if (preset === 'today') {
      dateFrom = dateTo = today
    } else if (preset === '7days') {
      const from = new Date(now); from.setDate(from.getDate() - 6)
      dateFrom = from.toISOString().slice(0, 10); dateTo = today
    } else if (preset === 'month') {
      const from = new Date(now); from.setDate(from.getDate() - 29)
      dateFrom = from.toISOString().slice(0, 10); dateTo = today
    }
    // custom: non toccare le date, mostra solo gli input
    setFilters(prev => ({
      ...prev,
      preset,
      ...(preset !== 'custom' && { dateFrom, dateTo }),
    }))
  }

  const inputClass = `w-full h-11 px-3 rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c] text-sm
    outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 transition-colors`

  return (
    <div className="bg-white rounded-2xl border border-[#e2e8f0] p-4 flex flex-col gap-4 shadow-sm">

      {/* Preset pills */}
      <div>
        <p className="text-xs font-semibold text-[#718096] uppercase tracking-wide mb-2">Periodo</p>
        <div className="flex gap-2 flex-wrap">
          {DATE_PRESETS.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p.id)}
              className={`flex items-center gap-1.5 h-9 px-3 rounded-xl border text-sm font-medium transition-colors active:scale-95
                ${filters.preset === p.id
                  ? 'bg-[#1e3a5f] border-[#1e3a5f] text-white'
                  : 'bg-white border-[#e2e8f0] text-[#1a202c]'}`}
            >
              {p.icon && (
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <rect x="3" y="4" width="18" height="18" rx="2"/>
                  <path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18"/>
                </svg>
              )}
              {p.label}
            </button>
          ))}
        </div>

        {/* Input date personalizzato — animazione max-height */}
        <div
          className="overflow-hidden transition-all duration-200 ease-in-out"
          style={{ maxHeight: filters.preset === 'custom' ? '110px' : '0px' }}
        >
          <div className="grid grid-cols-2 gap-2 pt-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-[#a0aec0]">Dal</span>
              <input type="date" value={filters.dateFrom} onChange={e => set('dateFrom', e.target.value)} className={inputClass} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-[#a0aec0]">Al</span>
              <input type="date" value={filters.dateTo}   onChange={e => set('dateTo',   e.target.value)} className={inputClass} />
            </div>
          </div>
        </div>
      </div>

      {/* Operatore */}
      <div>
        <p className="text-xs font-semibold text-[#718096] uppercase tracking-wide mb-2">Operatore</p>
        <select
          value={filters.operatorId}
          onChange={e => set('operatorId', e.target.value)}
          className={inputClass + ' appearance-none'}
        >
          <option value="">Tutti gli operatori</option>
          {operators.map(op => (
            <option key={op.id} value={op.id}>{op.name}</option>
          ))}
        </select>
      </div>

      {/* Solo episodi critici */}
      <button
        type="button"
        onClick={() => set('onlyIncidents', !filters.onlyIncidents)}
        className={`w-full h-11 rounded-xl border-2 font-semibold text-sm flex items-center justify-center gap-2
          transition-colors active:scale-95
          ${filters.onlyIncidents
            ? 'bg-red-500 border-red-500 text-white'
            : 'bg-white border-[#e2e8f0] text-[#1a202c]'}`}
      >
        <span>⚠️</span>
        {filters.onlyIncidents ? 'Mostrando solo episodi critici' : 'Solo episodi critici'}
      </button>

      {/* Reset */}
      <button
        type="button"
        onClick={() => setFilters(EMPTY_FILTERS)}
        className="text-xs text-[#718096] underline text-center"
      >
        Azzera filtri
      </button>
    </div>
  )
}
