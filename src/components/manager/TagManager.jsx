import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { playAudio } from '../../utils/audio'

// ─── Palette colori pastello ──────────────────────────────────────────────────

export const TAG_COLORS = [
  { id: 'blue',   bg: '#dbeafe', text: '#1d4ed8' },
  { id: 'green',  bg: '#d1fae5', text: '#065f46' },
  { id: 'yellow', bg: '#fef3c7', text: '#92400e' },
  { id: 'red',    bg: '#fee2e2', text: '#991b1b' },
  { id: 'purple', bg: '#ede9fe', text: '#5b21b6' },
  { id: 'gray',   bg: '#f3f4f6', text: '#374151' },
]

export function getTagColor(colorId) {
  return TAG_COLORS.find(c => c.id === colorId) ?? TAG_COLORS[5]
}

// ─── Pills read-only (per operatori) ─────────────────────────────────────────

export function TagPills({ tags, tiny }) {
  if (!tags?.length) return null
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map(tag => {
        const c = getTagColor(tag.color)
        return (
          <span
            key={tag.id}
            style={{ backgroundColor: c.bg, color: c.text }}
            className={`font-bold rounded-full leading-none
              ${tiny ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5'}`}
          >
            {tag.label}
          </span>
        )
      })}
    </div>
  )
}

// ─── TagManager (solo manager) ────────────────────────────────────────────────

export default function TagManager({ memberId, structureId, tags, allStructureTags, onTagsChange }) {
  const [open,          setOpen]          = useState(false)
  const [newLabel,      setNewLabel]      = useState('')
  const [selectedColor, setSelectedColor] = useState('blue')
  const [saving,        setSaving]        = useState(false)
  const popoverRef = useRef(null)

  // Chiudi al click esterno
  useEffect(() => {
    if (!open) return
    function onOutside(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setOpen(false)
        setNewLabel('')
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  // Suggerimenti: tag già esistenti nella struttura, non ancora assegnati a questo membro
  const suggestions = allStructureTags.reduce((acc, t) => {
    if (tags.some(existing => existing.label === t.label)) return acc
    if (acc.some(a => a.label === t.label)) return acc
    return [...acc, t]
  }, [])

  async function addTag(label, color) {
    const trimmed = label.trim()
    if (!trimmed) return
    setSaving(true)
    const { data, error } = await supabase
      .from('operator_tags')
      .insert({ profile_id: memberId, structure_id: structureId, label: trimmed, color })
      .select()
      .single()
    setSaving(false)
    if (!error && data) {
      playAudio('action')
      onTagsChange([...tags, data])
      setNewLabel('')
      setOpen(false)
    }
  }

  async function removeTag(tagId, e) {
    e.stopPropagation()
    await supabase.from('operator_tags').delete().eq('id', tagId)
    onTagsChange(tags.filter(t => t.id !== tagId))
  }

  return (
    <div className="flex flex-wrap gap-1 items-center mt-1.5">
      {/* Pill esistenti con × */}
      {tags.map(tag => {
        const c = getTagColor(tag.color)
        return (
          <span
            key={tag.id}
            style={{ backgroundColor: c.bg, color: c.text }}
            className="inline-flex items-center gap-0.5 text-[10px] font-bold px-2 py-0.5 rounded-full leading-none"
          >
            {tag.label}
            <button
              type="button"
              onClick={e => removeTag(tag.id, e)}
              className="opacity-50 hover:opacity-100 transition-opacity ml-0.5 leading-none"
            >
              ×
            </button>
          </span>
        )
      })}

      {/* Pulsante + e popover */}
      <div ref={popoverRef} className="relative">
        <button
          type="button"
          onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
          className="w-5 h-5 rounded-full bg-[#eef2f7] text-[#718096] text-xs font-bold
                     flex items-center justify-center hover:bg-[#e2e8f0] transition-colors leading-none"
        >
          +
        </button>

        {open && (
          <div
            className="absolute left-0 top-7 z-50 bg-white rounded-2xl border border-[#e2e8f0] shadow-xl p-3 w-60"
            onClick={e => e.stopPropagation()}
          >
            {/* Archivio struttura */}
            {suggestions.length > 0 && (
              <>
                <p className="text-[10px] font-bold text-[#a0aec0] uppercase tracking-wide mb-1.5">
                  Già usati nella struttura
                </p>
                <div className="flex flex-wrap gap-1 mb-2">
                  {suggestions.map((t, i) => {
                    const c = getTagColor(t.color)
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => addTag(t.label, t.color)}
                        style={{ backgroundColor: c.bg, color: c.text }}
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full leading-none
                                   hover:opacity-75 transition-opacity"
                      >
                        {t.label}
                      </button>
                    )
                  })}
                </div>
                <div className="h-px bg-[#f0f4f8] mb-3" />
              </>
            )}

            {/* Nuovo tag */}
            <p className="text-[10px] font-bold text-[#a0aec0] uppercase tracking-wide mb-1.5">
              Nuovo tag
            </p>
            <input
              type="text"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addTag(newLabel, selectedColor) }}
              placeholder="Es. Psicologo, Referente…"
              maxLength={30}
              autoFocus
              className="w-full h-9 px-3 rounded-xl border border-[#e2e8f0] text-sm text-[#1a202c]
                         outline-none focus:border-[#1e3a5f] transition-colors mb-2"
            />

            {/* Palette colori */}
            <div className="flex gap-1.5 mb-3">
              {TAG_COLORS.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedColor(c.id)}
                  style={{
                    backgroundColor: c.bg,
                    outline: selectedColor === c.id ? `2px solid ${c.text}` : '2px solid transparent',
                    outlineOffset: '2px',
                  }}
                  className="w-6 h-6 rounded-full transition-all shrink-0"
                />
              ))}
            </div>

            {/* Azioni */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setOpen(false); setNewLabel('') }}
                className="flex-1 h-8 rounded-xl border border-[#e2e8f0] text-xs text-[#718096]
                           font-semibold active:bg-[#f0f4f8] transition-colors"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={() => addTag(newLabel, selectedColor)}
                disabled={!newLabel.trim() || saving}
                className="flex-1 h-8 rounded-xl bg-[#1e3a5f] text-white text-xs font-semibold
                           disabled:opacity-50 active:bg-[#152b47] transition-colors"
              >
                {saving ? '…' : 'Aggiungi'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
