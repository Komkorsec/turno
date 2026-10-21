import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
}

function fmtLabel(iso) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Oggi'
  if (d.toDateString() === yesterday.toDateString()) return 'Ieri'
  return fmtDate(iso)
}

const AVATAR_PALETTE = [
  ['#dbeafe', '#1d4ed8'],
  ['#d1fae5', '#065f46'],
  ['#fce7f3', '#9d174d'],
  ['#fef3c7', '#92400e'],
  ['#ede9fe', '#5b21b6'],
  ['#fee2e2', '#991b1b'],
  ['#cffafe', '#164e63'],
  ['#f3f4f6', '#374151'],
]

function avatarColors(name) {
  const idx = (name?.charCodeAt(0) ?? 0) % AVATAR_PALETTE.length
  return AVATAR_PALETTE[idx]
}

function initials(name) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

// ─── Citazione (reply preview dentro la bolla) ────────────────────────────────

function QuotedMessage({ reply }) {
  if (!reply?.body) return null
  const name = reply.profiles?.full_name ?? 'Operatore'
  const [bg] = avatarColors(name)
  return (
    <div
      className="rounded-xl px-2.5 py-1.5 mb-1.5 border-l-[3px] text-left"
      style={{ backgroundColor: bg + '55', borderColor: avatarColors(name)[1] }}
    >
      <p className="text-[10px] font-bold mb-0.5" style={{ color: avatarColors(name)[1] }}>
        {name}
      </p>
      <p className="text-xs text-[#4a5568] leading-snug line-clamp-2">
        {reply.body}
      </p>
    </div>
  )
}

// ─── Bolla messaggio ──────────────────────────────────────────────────────────

function Bubble({ comment, isOwn, showName, onDelete, onReply }) {
  const [deleting, setDeleting] = useState(false)
  const [bg, text] = avatarColors(comment.profiles?.full_name)

  async function handleDelete() {
    if (!window.confirm('Eliminare questo commento?')) return
    setDeleting(true)
    await onDelete(comment.id)
  }

  return (
    <div className={`flex items-end gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'} group/row`}>
      {/* Avatar — solo per messaggi altrui */}
      {!isOwn && (
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-[10px] font-bold mb-0.5"
          style={{ backgroundColor: bg, color: text }}
        >
          {initials(comment.profiles?.full_name)}
        </div>
      )}

      <div className={`flex flex-col gap-0.5 max-w-[78%] ${isOwn ? 'items-end' : 'items-start'}`}>
        {showName && !isOwn && (
          <span className="text-[10px] font-semibold text-[#718096] px-1">
            {comment.profiles?.full_name ?? 'Operatore'}
          </span>
        )}

        <div className={`group relative px-3 py-2 rounded-2xl text-sm leading-relaxed break-words whitespace-pre-wrap
          ${isOwn
            ? 'bg-[#1e3a5f] text-white rounded-br-sm'
            : 'bg-white border border-[#e2e8f0] text-[#1a202c] rounded-bl-sm shadow-sm'
          }`}
        >
          {/* Citazione del messaggio a cui si risponde */}
          {comment.reply && (
            <QuotedMessage reply={comment.reply} />
          )}

          {comment.body}

          {/* Elimina — solo sui propri */}
          {isOwn && (
            <button
              type="button"
              disabled={deleting}
              onClick={handleDelete}
              className="absolute -left-7 bottom-0 w-6 h-6 flex items-center justify-center rounded-lg
                         text-[#cbd5e0] hover:text-red-400 hover:bg-red-50
                         opacity-0 group-hover:opacity-100 focus:opacity-100
                         transition-all disabled:opacity-40"
              aria-label="Elimina commento"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>

        <div className={`flex items-center gap-2 px-1 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
          <span className="text-[9px] text-[#a0aec0]">{fmtTime(comment.created_at)}</span>
          {/* Tasto rispondi — appare al hover della riga */}
          <button
            type="button"
            onClick={() => onReply(comment)}
            className="text-[9px] font-semibold text-[#a0aec0] hover:text-[#1e3a5f] transition-colors leading-none"
          >
            Rispondi
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Separatore data ──────────────────────────────────────────────────────────

function DateSeparator({ label }) {
  return (
    <div className="flex items-center gap-2 my-1">
      <div className="flex-1 h-px bg-[#f0f4f8]" />
      <span className="text-[10px] font-semibold text-[#a0aec0] px-2">{label}</span>
      <div className="flex-1 h-px bg-[#f0f4f8]" />
    </div>
  )
}

// ─── Componente principale ────────────────────────────────────────────────────

export default function DiaryComments({ diaryId, onCountChange }) {
  const { profile } = useAuth()
  const [comments,  setComments]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [text,      setText]      = useState('')
  const [posting,   setPosting]   = useState(false)
  const [error,     setError]     = useState('')
  const [replyTo,   setReplyTo]   = useState(null)   // commento a cui si sta rispondendo
  const bottomRef   = useRef(null)
  const inputRef    = useRef(null)

  // Mappa userId → full_name per risolvere nomi nei messaggi real-time
  const namesRef = useRef({})

  const scrollToBottom = useCallback((behavior = 'smooth') => {
    bottomRef.current?.scrollIntoView({ behavior, block: 'nearest' })
  }, [])

  // ── Fetch iniziale ────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data, error: err } = await supabase
        .from('diary_comments')
        .select(`
          id, body, created_at, user_id, reply_to_id,
          profiles!user_id ( full_name ),
          reply:diary_comments!reply_to_id ( id, body, user_id, profiles!user_id ( full_name ) )
        `)
        .eq('diary_id', diaryId)
        .order('created_at', { ascending: true })

      if (!err && data) {
        data.forEach(c => {
          if (c.user_id && c.profiles?.full_name) {
            namesRef.current[c.user_id] = c.profiles.full_name
          }
        })

        const missingIds = [...new Set(
          data.filter(c => !c.profiles?.full_name && c.user_id).map(c => c.user_id)
        )]
        if (missingIds.length > 0) {
          const { data: profilesData } = await supabase
            .rpc('get_profiles_names', { p_ids: missingIds })
          profilesData?.forEach(p => {
            if (p.full_name) namesRef.current[p.id] = p.full_name
          })
        }

        const resolved = data.map(c => ({
          ...c,
          profiles: { full_name: namesRef.current[c.user_id] ?? c.profiles?.full_name ?? null },
        }))
        setComments(resolved)
        onCountChange?.(resolved.length)
      }
      setLoading(false)
      setTimeout(() => scrollToBottom('instant'), 50)
    }
    load()
  }, [diaryId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Real-time ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`diary-comments-${diaryId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'diary_comments',
        filter: `diary_id=eq.${diaryId}`,
      }, payload => {
        const raw = payload.new
        const fullName =
          namesRef.current[raw.user_id] ??
          (raw.user_id === profile?.id ? profile?.full_name : null)

        const comment = {
          ...raw,
          profiles: { full_name: fullName ?? null },
          // Il reply viene risolto al prossimo load() se arriva via realtime
          reply: null,
        }

        if (!fullName) {
          supabase
            .rpc('get_profiles_names', { p_ids: [raw.user_id] })
            .then(({ data }) => {
              const name = data?.[0]?.full_name
              if (name) {
                namesRef.current[raw.user_id] = name
                setComments(prev =>
                  prev.map(c => c.id === raw.id
                    ? { ...c, profiles: { full_name: name } }
                    : c
                  )
                )
              }
            })
        }

        setComments(prev => {
          if (prev.some(c => c.id === raw.id)) return prev
          const next = [...prev, comment]
          onCountChange?.(next.length)
          return next
        })
        setTimeout(() => scrollToBottom(), 50)
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'diary_comments',
        filter: `diary_id=eq.${diaryId}`,
      }, payload => {
        setComments(prev => {
          const next = prev.filter(c => c.id !== payload.old.id)
          onCountChange?.(next.length)
          return next
        })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [diaryId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Post commento ─────────────────────────────────────────────────────────
  async function handlePost() {
    const trimmed = text.trim()
    if (!trimmed || posting) return
    setPosting(true)
    setError('')
    setText('')
    const currentReply = replyTo
    setReplyTo(null)

    const { data, error: err } = await supabase
      .from('diary_comments')
      .insert({
        diary_id:    diaryId,
        user_id:     profile.id,
        body:        trimmed,
        reply_to_id: currentReply?.id ?? null,
      })
      .select('id, body, created_at, user_id, reply_to_id')
      .single()

    if (err) {
      setError('Errore nell\'invio. Riprova.')
      setText(trimmed)
      setReplyTo(currentReply)
    } else {
      const comment = {
        ...data,
        profiles: { full_name: profile?.full_name ?? null },
        reply: currentReply
          ? {
              id:       currentReply.id,
              body:     currentReply.body,
              user_id:  currentReply.user_id,
              profiles: currentReply.profiles,
            }
          : null,
      }
      namesRef.current[profile.id] = profile?.full_name
      setComments(prev => {
        if (prev.some(c => c.id === data.id)) return prev
        const next = [...prev, comment]
        onCountChange?.(next.length)
        return next
      })
      setTimeout(() => scrollToBottom(), 50)
    }
    setPosting(false)
    inputRef.current?.focus()
  }

  // ── Elimina ───────────────────────────────────────────────────────────────
  async function handleDelete(id) {
    await supabase.from('diary_comments').delete().eq('id', id)
  }

  // ── Reply ─────────────────────────────────────────────────────────────────
  function handleReply(comment) {
    setReplyTo(comment)
    inputRef.current?.focus()
  }

  // ── Enter per inviare ─────────────────────────────────────────────────────
  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handlePost()
    }
    if (e.key === 'Escape') {
      setReplyTo(null)
    }
  }

  // ── Raggruppa per data ────────────────────────────────────────────────────
  const grouped = []
  let lastDate = null
  for (const c of comments) {
    const dateLabel = fmtLabel(c.created_at)
    if (dateLabel !== lastDate) {
      grouped.push({ type: 'separator', label: dateLabel, key: 'sep-' + c.id })
      lastDate = dateLabel
    }
    const prev = comments[comments.indexOf(c) - 1]
    const showName = !prev || prev.user_id !== c.user_id ||
      fmtLabel(prev.created_at) !== fmtLabel(c.created_at)
    grouped.push({ type: 'comment', comment: c, showName })
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3">

      {/* Lista messaggi */}
      {loading ? (
        <div className="flex flex-col gap-3 animate-pulse py-2">
          {[1, 2].map(i => (
            <div key={i} className={`flex gap-2 ${i % 2 === 0 ? 'flex-row-reverse' : ''}`}>
              <div className="w-7 h-7 rounded-lg bg-[#e2e8f0] shrink-0" />
              <div className="h-9 w-40 rounded-2xl bg-[#e2e8f0]" />
            </div>
          ))}
        </div>
      ) : comments.length === 0 ? (
        <p className="text-xs text-[#a0aec0] italic text-center py-4">
          Nessun messaggio. Sii il primo a scrivere.
        </p>
      ) : (
        <div className="flex flex-col gap-2 py-1">
          {grouped.map(item =>
            item.type === 'separator'
              ? <DateSeparator key={item.key} label={item.label} />
              : <Bubble
                  key={item.comment.id}
                  comment={item.comment}
                  isOwn={item.comment.user_id === profile?.id}
                  showName={item.showName}
                  onDelete={handleDelete}
                  onReply={handleReply}
                />
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Preview risposta sopra l'input */}
      {replyTo && (
        <div className="flex items-start gap-2 bg-[#f0f4f8] rounded-xl px-3 py-2 border-l-[3px] border-[#1e3a5f]">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-[#1e3a5f] mb-0.5">
              Rispondendo a {replyTo.profiles?.full_name ?? 'Operatore'}
            </p>
            <p className="text-xs text-[#718096] truncate">{replyTo.body}</p>
          </div>
          <button
            type="button"
            onClick={() => setReplyTo(null)}
            className="w-5 h-5 flex items-center justify-center rounded-full bg-[#e2e8f0]
                       text-[#718096] hover:bg-[#cbd5e0] transition-colors shrink-0 mt-0.5"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Input chat */}
      <div className="flex items-end gap-2 pt-1 border-t border-[#f0f4f8]">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={replyTo ? `Rispondi a ${replyTo.profiles?.full_name ?? 'Operatore'}…` : 'Scrivi un messaggio…'}
          maxLength={1000}
          className="flex-1 h-10 px-3 rounded-xl border border-[#e2e8f0] bg-[#f8f9fa]
                     text-sm text-[#1a202c] placeholder:text-[#a0aec0]
                     outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                     transition-colors"
        />
        <button
          type="button"
          disabled={!text.trim() || posting}
          onClick={handlePost}
          className="w-10 h-10 rounded-xl bg-[#1e3a5f] text-white flex items-center justify-center shrink-0
                     active:bg-[#152b47] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {posting ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          )}
        </button>
      </div>
      {error && <p className="text-xs text-red-500 -mt-1">{error}</p>}

    </div>
  )
}
