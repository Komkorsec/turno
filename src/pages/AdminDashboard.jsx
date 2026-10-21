import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import logo from '../assets/logobianco2.svg'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return (
    d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  )
}

function formatDateShort(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ─── Copy button ─────────────────────────────────────────────────────────────

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  async function handle() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={handle}
      className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors shrink-0
        ${copied ? 'bg-green-50 border-green-200 text-green-700' : 'bg-white border-[#e2e8f0] text-[#1a202c] active:bg-[#f8f9fa]'}`}
    >
      {copied ? '✓ Copiato' : 'Copia'}
    </button>
  )
}

// ─── Tab: Codici Invito ───────────────────────────────────────────────────────

function CodesTab({ codes, structures, loading, generating, error, onGenerateManager, onGenerateOperator, onDeleteCode }) {
  const [showMgrForm, setShowMgrForm]       = useState(false)
  const [maxStructures, setMaxStructures]   = useState(1)
  const [showOpForm, setShowOpForm]         = useState(false)
  const [selectedStructId, setSelectedStructId] = useState('')

  async function handleManager() {
    await onGenerateManager(maxStructures)
    setShowMgrForm(false)
    setMaxStructures(1)
  }

  async function handleOperator() {
    if (!selectedStructId) return
    await onGenerateOperator(Number(selectedStructId))
    setShowOpForm(false)
    setSelectedStructId('')
  }

  const inputClass = `w-full h-12 px-4 rounded-xl border border-[#e2e8f0] bg-white text-[#1a202c] text-base
    outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 transition-colors`

  return (
    <div className="flex flex-col gap-6">

      {/* Azioni */}
      <div className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold text-[#718096] uppercase tracking-wider">Genera codice</h3>

        {/* Manager */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => { setShowMgrForm(v => !v); setShowOpForm(false) }}
            disabled={generating}
            className={`w-full h-14 rounded-xl font-semibold text-base flex items-center justify-center gap-2
              transition-colors disabled:opacity-60
              ${showMgrForm
                ? 'bg-[#eef2f7] border-2 border-[#1e3a5f] text-[#1e3a5f]'
                : 'bg-[#1e3a5f] text-white active:bg-[#152b47]'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Genera Codice Manager
          </button>

          {showMgrForm && (
            <div className="bg-white rounded-xl border border-[#e2e8f0] p-4 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-[#1a202c]">
                  Numero strutture incluse
                </label>
                <p className="text-xs text-[#718096]">
                  Il manager potrà creare fino a questo numero di strutture nella sua organizzazione.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setMaxStructures(v => Math.max(1, v - 1))}
                    className="w-12 h-12 rounded-xl border border-[#e2e8f0] bg-white text-xl font-bold text-[#1a202c]
                               flex items-center justify-center active:bg-[#f8f9fa] transition-colors shrink-0"
                  >−</button>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={maxStructures}
                    onChange={e => setMaxStructures(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                    className={inputClass + ' text-center text-xl font-bold'}
                  />
                  <button
                    type="button"
                    onClick={() => setMaxStructures(v => Math.min(50, v + 1))}
                    className="w-12 h-12 rounded-xl border border-[#e2e8f0] bg-white text-xl font-bold text-[#1a202c]
                               flex items-center justify-center active:bg-[#f8f9fa] transition-colors shrink-0"
                  >+</button>
                </div>
              </div>
              <button
                onClick={handleManager}
                disabled={generating}
                className="h-12 rounded-xl bg-[#1e3a5f] text-white font-semibold text-base
                           active:bg-[#152b47] disabled:opacity-50 transition-colors"
              >
                {generating ? 'Generazione…' : `Crea codice · ${maxStructures} struttur${maxStructures === 1 ? 'a' : 'e'}`}
              </button>
            </div>
          )}
        </div>

        {/* Operatore */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => { setShowOpForm(v => !v); setShowMgrForm(false) }}
            disabled={generating}
            className={`w-full h-14 rounded-xl font-semibold text-base flex items-center justify-center gap-2
              border-2 transition-colors disabled:opacity-60
              ${showOpForm ? 'bg-[#eef2f7] border-[#1e3a5f] text-[#1e3a5f]' : 'bg-white border-[#e2e8f0] text-[#1a202c] active:bg-[#f8f9fa]'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            Genera Codice Operatore
          </button>

          {showOpForm && (
            <div className="bg-white rounded-xl border border-[#e2e8f0] p-4 flex flex-col gap-3">
              <p className="text-sm font-semibold text-[#1a202c]">Struttura di destinazione</p>
              <select
                value={selectedStructId}
                onChange={e => setSelectedStructId(e.target.value)}
                className={inputClass + ' appearance-none'}
              >
                <option value="">Scegli struttura…</option>
                {structures.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button
                onClick={handleOperator}
                disabled={generating || !selectedStructId}
                className="h-12 rounded-xl bg-[#1e3a5f] text-white font-semibold text-base
                           active:bg-[#152b47] disabled:opacity-50 transition-colors"
              >
                {generating ? 'Generazione…' : 'Crea codice'}
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
      </div>

      {/* Lista codici */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-[#718096] uppercase tracking-wider">Codici generati</h3>
          <span className="text-xs text-[#a0aec0]">{codes.length} totali</span>
        </div>

        {loading ? (
          <div className="flex flex-col gap-2">
            {[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-white border border-[#e2e8f0] animate-pulse" />)}
          </div>
        ) : codes.length === 0 ? (
          <div className="rounded-xl bg-white border border-dashed border-[#cbd5e0] p-8 text-center">
            <p className="text-[#718096] text-sm">Nessun codice generato.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-[#e2e8f0] overflow-hidden shadow-sm">
            {codes.map((c, idx) => (
              <div
                key={c.id}
                className={`px-4 py-3 flex flex-col gap-1.5 ${idx !== 0 ? 'border-t border-[#f0f4f8]' : ''} ${c.is_used ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Codice */}
                  <span className="font-mono font-bold text-[#1a202c] text-sm tracking-widest flex-1 min-w-0">
                    {c.code}
                  </span>

                  {/* Ruolo */}
                  <span className={`text-xs font-semibold rounded-full px-2.5 py-0.5 shrink-0
                    ${c.role === 'manager' ? 'bg-[#eef2f7] text-[#1e3a5f]' : 'bg-purple-50 text-purple-700'}`}>
                    {c.role === 'manager' ? 'Manager' : 'Operatore'}
                  </span>

                  {/* Strutture incluse (solo codici manager) */}
                  {c.role === 'manager' && (
                    <span className="text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2.5 py-0.5 shrink-0">
                      {c.max_structures ?? 1} struttur{(c.max_structures ?? 1) === 1 ? 'a' : 'e'}
                    </span>
                  )}

                  {/* Struttura destinazione (codici operatore) */}
                  {c.structures?.name && (
                    <span className="text-xs text-[#718096] shrink-0">{c.structures.name}</span>
                  )}

                  {/* Stato */}
                  <span className={`flex items-center gap-1.5 text-xs font-semibold shrink-0
                    ${c.is_used ? 'text-red-500' : 'text-green-600'}`}>
                    <span className={`w-2 h-2 rounded-full ${c.is_used ? 'bg-red-500' : 'bg-green-500'}`} />
                    {c.is_used ? 'Riscattato' : 'Disponibile'}
                  </span>

                  {!c.is_used && <CopyButton text={c.code} />}
                  <button
                    onClick={() => onDeleteCode(c)}
                    className="shrink-0 h-7 w-7 rounded-lg border border-red-200 bg-red-50 text-red-500
                               flex items-center justify-center active:bg-red-100 transition-colors"
                    title="Elimina codice"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m2 0a1 1 0 00-1-1h-4a1 1 0 00-1 1m-4 0h12" />
                    </svg>
                  </button>
                </div>

                {/* Chi ha riscattato */}
                {c.is_used && c.redeemer && (
                  <p className="text-xs text-[#718096] pl-0.5">
                    Riscattato da <span className="font-semibold text-[#1a202c]">{c.redeemer.full_name}</span>
                    {c.redeemer.email && <span className="text-[#a0aec0]"> · {c.redeemer.email}</span>}
                    <span className="text-[#a0aec0]"> · {formatDate(c.created_at)}</span>
                  </p>
                )}
                {!c.is_used && (
                  <p className="text-xs text-[#a0aec0] pl-0.5">{formatDate(c.created_at)}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Tab: Anagrafica ─────────────────────────────────────────────────────────

const ROLE_CFG = {
  manager:         { label: 'Manager',         bg: 'bg-blue-50',   text: 'text-blue-700'   },
  admin_secondary: { label: 'Coordinatore',      bg: 'bg-indigo-50', text: 'text-indigo-700' },
  operator:        { label: 'Operatore',        bg: 'bg-purple-50', text: 'text-purple-700' },
}

function AnagraficaTab({ users, structures, loading, onDeleteUser }) {
  const [search,          setSearch]          = useState('')
  const [filterStructure, setFilterStructure] = useState('')
  const [confirmDelete,   setConfirmDelete]   = useState(null)  // user obj

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-3">
          {[1,2,3].map(i => <div key={i} className="h-20 rounded-2xl bg-white border border-[#e2e8f0] animate-pulse" />)}
        </div>
        <div className="flex flex-col gap-2">
          {[1,2,3,4].map(i => <div key={i} className="h-16 rounded-xl bg-white border border-[#e2e8f0] animate-pulse" />)}
        </div>
      </div>
    )
  }

  // ── Stats ────────────────────────────────────────────────────────────────────
  const totalUsers     = users.length
  const totalManagers  = users.filter(u => u.role === 'manager').length
  const uniqueStructs  = new Set(users.map(u => u.primary_structure).filter(Boolean)).size

  // ── Filtro ───────────────────────────────────────────────────────────────────
  const q = search.trim().toLowerCase()
  const filtered = users.filter(u => {
    if (q && !u.full_name?.toLowerCase().includes(q) && !u.email?.toLowerCase().includes(q)) return false
    if (filterStructure && u.primary_structure !== filterStructure) return false
    return true
  })

  // ── Lista strutture uniche per dropdown ──────────────────────────────────────
  const structureNames = [...new Set(users.map(u => u.primary_structure).filter(Boolean))].sort()

  return (
    <div className="flex flex-col gap-4">

      {/* ── Stats bar ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: '👥', label: 'Totale utenti',    value: totalUsers   },
          { icon: '🔑', label: 'Manager',           value: totalManagers },
          { icon: '🏥', label: 'Strutture attive',  value: uniqueStructs },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-[#e2e8f0] px-3 py-3 shadow-sm text-center">
            <p className="text-xl leading-none mb-1">{s.icon}</p>
            <p className="text-2xl font-bold text-[#1e3a5f] leading-none">{s.value}</p>
            <p className="text-[10px] text-[#a0aec0] mt-1 leading-tight">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Filtri ── */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#a0aec0] pointer-events-none"
            fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Cerca per nome o email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#e2e8f0] bg-white text-sm
                       text-[#1a202c] outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                       transition-colors placeholder:text-[#a0aec0]"
          />
        </div>
        <select
          value={filterStructure}
          onChange={e => setFilterStructure(e.target.value)}
          className="h-10 px-3 rounded-xl border border-[#e2e8f0] bg-white text-sm text-[#1a202c]
                     outline-none focus:border-[#1e3a5f] appearance-none shrink-0 max-w-[140px]"
        >
          <option value="">Tutte le strutture</option>
          {structureNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {/* ── Tabella ── */}
      {filtered.length === 0 ? (
        <div className="rounded-xl bg-white border border-dashed border-[#cbd5e0] p-8 text-center">
          <p className="text-[#718096] text-sm">
            {users.length === 0 ? 'Nessun utente registrato.' : 'Nessun utente corrisponde ai filtri.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#e2e8f0] overflow-hidden shadow-sm">
          {/* Intestazione colonne */}
          <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-3 px-4 py-2.5 bg-[#f8f9fa] border-b border-[#e2e8f0]">
            {['Profilo', 'Email', 'Struttura', ''].map((h, i) => (
              <span key={i} className="text-[10px] font-bold text-[#718096] uppercase tracking-wider">{h}</span>
            ))}
          </div>

          {filtered.map((u, idx) => {
            const roleCfg = ROLE_CFG[u.role] ?? ROLE_CFG.operator
            const allStructures = []
            if (u.primary_structure) allStructures.push(u.primary_structure)
            for (const name of u.extra_structures ?? []) {
              if (name && !allStructures.includes(name)) allStructures.push(name)
            }

            return (
              <div
                key={u.id}
                className={`grid grid-cols-[1fr_1fr_auto_auto] items-center gap-3 px-4 py-3
                  ${idx !== 0 ? 'border-t border-[#f0f4f8]' : ''}`}
              >
                {/* Nome + badge ruolo */}
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-[#eef2f7] flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-[#1e3a5f]">
                      {u.full_name?.charAt(0)?.toUpperCase() ?? '?'}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-[#1a202c] text-sm truncate leading-tight">
                      {u.full_name || '—'}
                    </p>
                    <span className={`text-[9px] font-bold rounded-full px-1.5 py-0.5 leading-none
                      ${roleCfg.bg} ${roleCfg.text}`}>
                      {roleCfg.label}
                    </span>
                  </div>
                </div>

                {/* Email */}
                <p className="text-xs text-[#718096] truncate">
                  {u.email || <span className="text-[#c0ccd8] italic text-[11px]">Non impostata</span>}
                </p>

                {/* Strutture */}
                <div className="flex flex-wrap gap-1 justify-end">
                  {allStructures.length > 0
                    ? allStructures.slice(0, 2).map((name, i) => (
                        <span key={i} className="text-[10px] bg-[#f0f4f8] text-[#1e3a5f] rounded-full px-2 py-0.5 font-medium whitespace-nowrap">
                          {name}
                        </span>
                      ))
                    : <span className="text-[11px] text-[#a0aec0] italic">Nessuna</span>
                  }
                </div>

                {/* Azione elimina */}
                <button
                  type="button"
                  onClick={() => setConfirmDelete(u)}
                  className="shrink-0 w-8 h-8 rounded-lg border border-red-200 bg-red-50 text-red-400
                             flex items-center justify-center active:bg-red-100 hover:text-red-600 transition-colors"
                  title="Elimina profilo"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m2 0a1 1 0 00-1-1h-4a1 1 0 00-1 1m-4 0h12" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Modal conferma eliminazione ── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setConfirmDelete(null)} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-[#1a202c]">Eliminazione Profilo</h3>
            </div>
            <p className="text-sm text-[#4a5568] leading-relaxed">
              Sei sicuro di voler eliminare definitivamente{' '}
              <span className="font-semibold text-[#1a202c]">{confirmDelete.full_name || 'questo utente'}</span>?
              <br /><br />
              Questa azione è irreversibile e l'utente perderà l'accesso a tutte le strutture.
            </p>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="flex-1 h-11 rounded-xl border border-[#e2e8f0] bg-white text-sm font-semibold
                           text-[#1a202c] active:bg-[#f8f9fa] transition-colors"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={() => { onDeleteUser(confirmDelete); setConfirmDelete(null) }}
                className="flex-1 h-11 rounded-xl bg-red-600 text-white text-sm font-semibold
                           active:bg-red-700 transition-colors"
              >
                Sì, Elimina definitivamente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tab: Strutture ───────────────────────────────────────────────────────────

const STRUCTURE_TYPE_COLORS = {
  'Comunità Alloggio':  'bg-blue-50 text-blue-700',
  'Gruppo Appartamento':'bg-purple-50 text-purple-700',
  'Centro Diurno':      'bg-green-50 text-green-700',
  'Casa Famiglia':      'bg-amber-50 text-amber-700',
  'Pronto Intervento':  'bg-red-50 text-red-700',
}

function StructuresTab({ structures, orgs, loading, onDelete, onDeleteOrg }) {
  const [expandedOrg, setExpandedOrg] = useState(null)

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-white border border-[#e2e8f0] animate-pulse" />)}
      </div>
    )
  }

  // Raggruppa strutture per organization_id
  const byOrg = {}
  for (const s of structures) {
    const key = s.organization_id ?? '__none__'
    if (!byOrg[key]) byOrg[key] = []
    byOrg[key].push(s)
  }

  const orgMap = Object.fromEntries((orgs ?? []).map(o => [o.id, o]))

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-700 leading-relaxed">
        <span className="font-bold">Zona pericolosa.</span> Eliminare una struttura cancella definitivamente
        tutti i diari, i codici e le visualizzazioni collegate. Gli operatori rimangono attivi ma scollegati.
      </div>

      {Object.entries(byOrg).map(([orgId, structs]) => {
        const org = orgId !== '__none__' ? orgMap[Number(orgId)] : null
        const isExpanded = expandedOrg === orgId
        return (
          <div key={orgId} className="bg-white rounded-2xl border border-[#e2e8f0] overflow-hidden shadow-sm">
            {/* Header organizzazione — cliccabile */}
            <div className="flex items-center gap-2 px-4 py-4">
              <button
                onClick={() => setExpandedOrg(isExpanded ? null : orgId)}
                className="flex-1 flex items-center gap-3 text-left"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[#1a202c] text-sm">
                    {org?.name ?? 'Senza organizzazione'}
                  </p>
                  <p className="text-xs text-[#a0aec0] mt-0.5">
                    {structs.length} / {org?.max_structures ?? '?'} struttur{(org?.max_structures ?? 1) === 1 ? 'a' : 'e'}
                    {orgId !== '__none__' && <span> · Org ID {orgId}</span>}
                  </p>
                </div>
                <svg
                  className={`w-4 h-4 text-[#a0aec0] transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                  fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
              {org && (
                <button
                  onClick={() => onDeleteOrg(org, structs.length)}
                  className="shrink-0 h-8 px-3 rounded-lg border border-red-200 bg-red-50 text-red-500
                             text-xs font-semibold flex items-center gap-1.5 active:bg-red-100 transition-colors"
                  title="Elimina intera cooperativa"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m2 0a1 1 0 00-1-1h-4a1 1 0 00-1 1m-4 0h12" />
                  </svg>
                  Elimina org
                </button>
              )}
            </div>

            {/* Lista strutture espansa */}
            {isExpanded && (
              <div className="border-t border-[#f0f4f8]">
                {structs.map((s, idx) => (
                  <div
                    key={s.id}
                    className={`px-4 py-4 flex flex-col gap-2 ${idx !== 0 ? 'border-t border-[#f0f4f8]' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[#1a202c] text-sm">{s.name}</p>
                        {s.address && (
                          <p className="text-xs text-[#718096] mt-0.5 flex items-center gap-1">
                            <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            {s.address}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => onDelete(s)}
                        className="shrink-0 h-8 w-8 rounded-lg border border-red-200 bg-red-50 text-red-500
                                   flex items-center justify-center active:bg-red-100 transition-colors"
                        title="Elimina struttura"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m2 0a1 1 0 00-1-1h-4a1 1 0 00-1 1m-4 0h12" />
                        </svg>
                      </button>
                    </div>

                    {/* Badge tipo + capacità */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {s.type && (
                        <span className={`text-xs font-semibold rounded-full px-2.5 py-0.5
                          ${STRUCTURE_TYPE_COLORS[s.type] ?? 'bg-[#f0f4f8] text-[#718096]'}`}>
                          {s.type}
                        </span>
                      )}
                      {s.capacity && (
                        <span className="text-xs font-medium text-[#718096] bg-[#f0f4f8] rounded-full px-2.5 py-0.5">
                          {s.capacity} posti
                        </span>
                      )}
                      {s.diary_count != null && (
                        <span className="text-xs text-[#a0aec0]">{s.diary_count} diari</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Pagina principale ────────────────────────────────────────────────────────

export default function AdminDashboard({ onBack }) {
  const [activeTab, setActiveTab]   = useState('codes') // 'codes' | 'anagrafica' | 'structures'

  const [codes, setCodes]           = useState([])
  const [structures, setStructures] = useState([])
  const [users, setUsers]           = useState([])

  const [orgs, setOrgs]                       = useState([])
  const [loadingCodes, setLoadingCodes]       = useState(true)
  const [loadingUsers, setLoadingUsers]       = useState(true)
  const [loadingStructures, setLoadingStructures] = useState(true)
  const [generating, setGenerating]           = useState(false)
  const [error, setError]                     = useState('')

  // ── Carica codici ────────────────────────────────────────────────────────
  const loadCodes = useCallback(async () => {
    setLoadingCodes(true)

    // Query base (sempre funziona, anche senza migrazione admin_users_schema)
    const { data: codesData, error } = await supabase
      .from('invitation_codes')
      .select('id, code, role, structure_id, is_used, used_by, created_at, max_structures, structures(name)')
      .order('created_at', { ascending: false })

    if (error || !codesData) { setLoadingCodes(false); return }

    // Arricchisci con il profilo di chi ha riscattato (se used_by è popolato)
    const usedByIds = codesData.filter(c => c.used_by).map(c => c.used_by)
    let redeemersMap = {}
    if (usedByIds.length > 0) {
      const { data: redeemers } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', usedByIds)
      for (const r of redeemers ?? []) redeemersMap[r.id] = r
    }

    setCodes(codesData.map(c => ({
      ...c,
      redeemer: c.used_by ? (redeemersMap[c.used_by] ?? null) : null,
    })))
    setLoadingCodes(false)
  }, [])

  // ── Carica strutture (per dropdown) + utenti (per anagrafica) ────────────
  const loadStructuresAndUsers = useCallback(async () => {
    setLoadingUsers(true)

    // Strutture (per dropdown generazione codici)
    const { data: structsData } = await supabase
      .from('structures').select('id, name').order('name')
    if (structsData) setStructures(structsData)

    // Profili con email da auth.users (tramite RPC)
    const { data: profilesData } = await supabase.rpc('admin_get_users_with_email')

    if (!profilesData) { setLoadingUsers(false); return }

    // Struttura primaria per ogni profilo
    const structIds = [...new Set(profilesData.map(p => p.structure_id).filter(Boolean))]
    let structMap = {}
    if (structIds.length > 0) {
      const { data: structs } = await supabase
        .from('structures').select('id, name').in('id', structIds)
      for (const s of structs ?? []) structMap[s.id] = s.name
    }

    // Strutture aggiuntive da user_structures (se la tabella esiste)
    let userStructsMap = {}
    const { data: userStructs } = await supabase
      .from('user_structures')
      .select('user_id, structure_id, structures(name)')
      .in('user_id', profilesData.map(p => p.id))
    for (const us of userStructs ?? []) {
      if (!userStructsMap[us.user_id]) userStructsMap[us.user_id] = []
      userStructsMap[us.user_id].push(us.structures?.name)
    }

    setUsers(profilesData.map(p => ({
      ...p,
      primary_structure: structMap[p.structure_id] ?? null,
      extra_structures:  userStructsMap[p.id] ?? [],
    })))
    setLoadingUsers(false)
  }, [])

  // ── Carica strutture con conteggio diari ────────────────────────────────
  const loadStructuresFull = useCallback(async () => {
    setLoadingStructures(true)
    const { data } = await supabase
      .from('structures')
      .select('id, name, address, type, capacity, organization_id')
      .order('organization_id, name')

    if (!data) { setLoadingStructures(false); return }

    // Conta diari per struttura
    const ids = data.map(s => s.id)
    const { data: counts } = await supabase
      .from('diaries')
      .select('structure_id')
      .in('structure_id', ids)
    const countMap = {}
    for (const d of counts ?? []) {
      countMap[d.structure_id] = (countMap[d.structure_id] ?? 0) + 1
    }

    // Carica organizzazioni prima di aggiornare le strutture
    const orgIds = [...new Set(data.map(s => s.organization_id).filter(Boolean))]
    let orgsData = []
    if (orgIds.length > 0) {
      const { data: fetched } = await supabase
        .from('organizations')
        .select('id, name, max_structures')
        .in('id', orgIds)
      orgsData = fetched ?? []
    }

    // Aggiorna entrambi nello stesso ciclo di render
    setOrgs(orgsData)
    setStructures(data.map(s => ({ ...s, diary_count: countMap[s.id] ?? 0 })))
    setLoadingStructures(false)
  }, [])

  useEffect(() => {
    loadCodes()
    loadStructuresAndUsers()
    loadStructuresFull()
  }, [loadCodes, loadStructuresAndUsers, loadStructuresFull])

  // ── Genera manager ───────────────────────────────────────────────────────
  async function handleGenerateManager(maxStructures) {
    setGenerating(true); setError('')
    const { error } = await supabase
      .from('invitation_codes')
      .insert({ code: generateCode(), role: 'manager', structure_id: null, max_structures: maxStructures })
    if (error) setError('Errore: ' + error.message)
    else await loadCodes()
    setGenerating(false)
  }

  // ── Elimina codice (hard delete) ─────────────────────────────────────────
  async function handleDeleteCode(code) {
    const ok = window.confirm(
      `Eliminare definitivamente il codice "${code.code}"?\n\nQuesta operazione non è reversibile.`
    )
    if (!ok) return
    const { error } = await supabase
      .from('invitation_codes')
      .delete()
      .eq('id', code.id)
    if (error) setError('Errore eliminazione: ' + error.message)
    else await loadCodes()
  }

  // ── Elimina struttura (hard delete + cascade) ─────────────────────────────
  async function handleDeleteStructure(structure) {
    const ok = window.confirm(
      `⚠️ ATTENZIONE\n\n` +
      `Stai per eliminare definitivamente la struttura "${structure.name}".\n\n` +
      `Questa azione eliminerà:\n` +
      `• Tutti i diari di turno (${structure.diary_count ?? '?'} report)\n` +
      `• Tutti i codici invito collegati\n` +
      `• Tutte le visualizzazioni e lo storico modifiche\n\n` +
      `Gli account degli operatori rimarranno attivi ma scollegati.\n\n` +
      `QUESTA OPERAZIONE NON È REVERSIBILE.\n\nConfermi?`
    )
    if (!ok) return
    const { error } = await supabase.rpc('admin_delete_structure', { p_structure_id: structure.id })
    if (error) {
      setError('Errore eliminazione struttura: ' + error.message)
    } else {
      await loadStructuresFull()
      await loadStructuresAndUsers()
      await loadCodes()
    }
  }

  // ── Elimina profilo utente ───────────────────────────────────────────────
  async function handleDeleteUser(user) {
    // Prova prima con la RPC completa (elimina anche auth.users)
    const { error: rpcErr } = await supabase.rpc('admin_delete_user', { p_user_id: user.id })
    if (!rpcErr) {
      await loadStructuresAndUsers()
      return
    }
    // Fallback: elimina solo il profilo (l'utente perde accesso ma resta in auth.users)
    const { error: profileErr } = await supabase
      .from('profiles')
      .delete()
      .eq('id', user.id)
    if (profileErr) {
      setError('Errore eliminazione: ' + (rpcErr.message || profileErr.message))
    } else {
      await loadStructuresAndUsers()
    }
  }

  // ── Elimina organizzazione completa ──────────────────────────────────────
  async function handleDeleteOrg(org, structureCount) {
    const ok = window.confirm(
      `⚠️ ATTENZIONE\n\n` +
      `Stai per eliminare definitivamente l'organizzazione "${org.name}".\n\n` +
      `Verranno eliminate:\n` +
      `• ${structureCount} struttur${structureCount === 1 ? 'a' : 'e'}\n` +
      `• Tutti i diari, residenti, turni e documenti collegati\n` +
      `• Tutti i codici invito\n\n` +
      `Gli account degli utenti rimarranno attivi ma scollegati.\n\n` +
      `QUESTA OPERAZIONE NON È REVERSIBILE.\n\nConfermi?`
    )
    if (!ok) return
    const { error } = await supabase.rpc('admin_delete_organization', { p_org_id: org.id })
    if (error) {
      setError('Errore eliminazione organizzazione: ' + error.message)
    } else {
      await loadStructuresFull()
      await loadStructuresAndUsers()
      await loadCodes()
    }
  }

  // ── Genera operatore ─────────────────────────────────────────────────────
  async function handleGenerateOperator(structureId) {
    setGenerating(true); setError('')
    const { error } = await supabase
      .from('invitation_codes')
      .insert({ code: generateCode(), role: 'operator', structure_id: structureId })
    if (error) setError('Errore: ' + error.message)
    else await loadCodes()
    setGenerating(false)
  }

  // ─────────────────────────────────────────────────────────────────────────
  const TABS = [
    { id: 'codes',      label: 'Codici Invito' },
    { id: 'anagrafica', label: 'Anagrafica' },
    { id: 'structures', label: 'Strutture' },
  ]

  return (
    <div className="min-h-screen bg-[#f8f9fa]">

      {/* Header */}
      <header className="bg-[#1e3a5f] text-white px-5 flex items-center gap-3 sticky top-0 z-10 shadow-sm"
              style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1rem)', paddingBottom: '1rem' }}>
        <button
          onClick={onBack}
          className="w-8 h-8 flex items-center justify-center rounded-lg active:bg-[#152b47] transition-colors shrink-0"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex items-center gap-3">
          <img src={logo} alt="Turno" className="h-10 w-auto" />
          <p className="text-[#93c5fd] text-xs">Gestione licenze e utenti</p>
        </div>
      </header>

      {/* Tab bar */}
      <div className="bg-white border-b border-[#e2e8f0] px-4 sticky top-[72px] z-10">
        <div className="flex max-w-2xl mx-auto">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-3.5 px-4 text-sm font-semibold border-b-2 transition-colors
                ${activeTab === tab.id
                  ? 'border-[#1e3a5f] text-[#1e3a5f]'
                  : 'border-transparent text-[#718096] active:text-[#1a202c]'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <main className="px-4 py-6 max-w-2xl mx-auto pb-16">
        {activeTab === 'codes' && (
          <CodesTab
            codes={codes}
            structures={structures}
            loading={loadingCodes}
            generating={generating}
            error={error}
            onGenerateManager={maxStructures => handleGenerateManager(maxStructures)}
            onGenerateOperator={handleGenerateOperator}
            onDeleteCode={handleDeleteCode}
          />
        )}
        {activeTab === 'anagrafica' && (
          <AnagraficaTab
            users={users}
            structures={structures}
            loading={loadingUsers}
            onDeleteUser={handleDeleteUser}
          />
        )}
        {activeTab === 'structures' && (
          <StructuresTab
            structures={structures}
            orgs={orgs}
            loading={loadingStructures}
            onDelete={handleDeleteStructure}
            onDeleteOrg={handleDeleteOrg}
          />
        )}
      </main>
    </div>
  )
}
