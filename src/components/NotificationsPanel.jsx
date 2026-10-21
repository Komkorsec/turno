import { supabase } from '../lib/supabase'

// ─── Configurazione icone per tipo ───────────────────────────────────────────

export const NOTIF_ICON = {
  diary:         { emoji: '📝', bg: '#eef2f7', text: '#1e3a5f' },
  absence:       { emoji: '🗓', bg: '#fef3c7', text: '#92400e' },
  absence_reply: { emoji: '🗓', bg: '#fef3c7', text: '#92400e' },
  document:      { emoji: '📄', bg: '#d1fae5', text: '#065f46' },
  expiry:        { emoji: '⚠️', bg: '#fee2e2', text: '#991b1b' },
  schedule:              { emoji: '📅', bg: '#ede9fe', text: '#5b21b6' },
  urgent:                { emoji: '🚨', bg: '#fee2e2', text: '#991b1b' },
  appointment:           { emoji: '📅', bg: '#e0f2fe', text: '#075985' },
  appointment_reminder:  { emoji: '⏰', bg: '#fef9c3', text: '#713f12' },
  medication_alert:      { emoji: '💊', bg: '#fee2e2', text: '#991b1b' },
  info:                  { emoji: '🔔', bg: '#f0f4f8', text: '#718096' },
  task_assigned:         { emoji: '📋', bg: '#ede9fe', text: '#5b21b6' },
  task_completed:        { emoji: '✅', bg: '#d1fae5', text: '#065f46' },
  task_deleted:          { emoji: '🗑️', bg: '#fee2e2', text: '#991b1b' },
}

// ─── Helper tempo relativo ────────────────────────────────────────────────────

function fmtTime(iso) {
  const d    = new Date(iso)
  const now  = new Date()
  const diff = Math.floor((now - d) / 60000)
  if (diff < 1)  return 'Ora'
  if (diff < 60) return `${diff} min fa`
  const h = Math.floor(diff / 60)
  if (h < 24)    return `${h} h fa`
  const dd = Math.floor(h / 24)
  if (dd < 7)    return `${dd} g fa`
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
}

// ─── Hook: caricamento + real-time notifiche ──────────────────────────────────

export function useNotifications(userId) {
  return { userId } // usato nel componente host via useEffect
}

// ─── Componente pannello ──────────────────────────────────────────────────────

export default function NotificationsPanel({ notifications, onClose, onMarkAllRead, onClearAll, onNavigate }) {
  const unread = notifications.filter(n => !n.is_read).length

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="relative w-full max-w-sm bg-white h-full flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex flex-col gap-2 px-5 border-b border-[#f0f4f8] shrink-0"
             style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1rem)', paddingBottom: '1rem' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">🔔</span>
              <h2 className="font-bold text-[#1a202c] text-base">Notifiche</h2>
              {unread > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full
                                 bg-red-500 text-white leading-none">
                  {unread}
                </span>
              )}
            </div>
            <button onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#f0f4f8]
                         text-[#718096] text-lg leading-none">
              ×
            </button>
          </div>
          {notifications.length > 0 && (
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button onClick={onMarkAllRead}
                  className="flex-1 text-[11px] font-semibold text-[#1e3a5f] px-2.5 py-1.5 rounded-lg
                             bg-[#eef2f7] active:bg-[#e2e8f0] transition-colors text-center">
                  Segna tutte lette
                </button>
              )}
              <button onClick={onClearAll}
                className="flex-1 text-[11px] font-semibold text-red-600 px-2.5 py-1.5 rounded-lg
                           bg-red-50 active:bg-red-100 transition-colors text-center">
                Svuota tutto
              </button>
            </div>
          )}
        </div>

        {/* Lista */}
        <div className="overflow-y-auto flex-1">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6 pb-20">
              <span className="text-4xl mb-3">🔕</span>
              <p className="font-semibold text-sm text-[#1a202c]">Nessuna notifica</p>
              <p className="text-xs text-[#a0aec0] mt-1">Le novità appariranno qui.</p>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-[#f0f4f8]">
              {notifications.map(n => {
                const cfg = NOTIF_ICON[n.type] ?? NOTIF_ICON.info
                return (
                  <button key={n.id} onClick={() => onNavigate(n)}
                    className={`w-full flex items-start gap-3 px-5 py-4 text-left transition-colors
                      ${n.is_read
                        ? 'bg-white active:bg-[#f8f9fa]'
                        : 'bg-blue-50/60 active:bg-blue-100/60'}`}>
                    <span className="w-9 h-9 rounded-xl flex items-center justify-center
                                     text-base shrink-0"
                      style={{ backgroundColor: cfg.bg }}>
                      {cfg.emoji}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm leading-tight
                          ${n.is_read
                            ? 'font-medium text-[#1a202c]'
                            : 'font-bold text-[#1a202c]'}`}>
                          {n.title}
                        </p>
                        <span className="text-[10px] text-[#a0aec0] shrink-0 mt-0.5">
                          {fmtTime(n.created_at)}
                        </span>
                      </div>
                      {n.message && (
                        <p className="text-xs text-[#718096] mt-0.5 leading-relaxed line-clamp-2">
                          {n.message}
                        </p>
                      )}
                    </div>
                    {!n.is_read && (
                      <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 mt-1.5" />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Icona campanella riutilizzabile ──────────────────────────────────────────

export function BellButton({ unreadCount, onClick }) {
  return (
    <button onClick={onClick}
      className="relative w-10 h-10 flex items-center justify-center rounded-xl
                 bg-white text-[#1e3a5f] active:bg-[#e8eef5] transition-colors shrink-0">
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 rounded-full
                         bg-red-500 text-white text-[9px] font-bold
                         flex items-center justify-center leading-none">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  )
}

// ─── Helpers esportati per i componenti host ──────────────────────────────────

export async function fetchNotifications(userId) {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(50)
  return data ?? []
}

export function subscribeNotifications(userId, onNew) {
  return supabase
    .channel('notifications-' + userId)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${userId}`,
    }, payload => onNew(payload.new))
    .subscribe()
}
