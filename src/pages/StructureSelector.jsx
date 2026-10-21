import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import logo from '../assets/logobianco2.svg'
import AbsencesTab from '../components/AbsencesTab'
import NotificationsPanel, { BellButton, fetchNotifications, subscribeNotifications } from '../components/NotificationsPanel'
import OperatorSettingsPage from '../components/OperatorSettingsPage'
import ArchivioGenerale from '../components/ArchivioGenerale'

export default function StructureSelector() {
  const { profile, userStructures, setActiveStructure, signOut } = useAuth()
  const [activeTab, setActiveTab] = useState('strutture') // 'strutture' | 'ferie' | 'settings'
  const [showArchivio, setShowArchivio] = useState(false)

  // ── Notifiche ──────────────────────────────────────────────────────────────
  const [notifications,  setNotifications]  = useState([])
  const [showNotifPanel, setShowNotifPanel] = useState(false)

  useEffect(() => {
    if (!profile?.id) return
    fetchNotifications(profile.id).then(setNotifications)
    const channel = subscribeNotifications(profile.id, n =>
      setNotifications(prev => [n, ...prev])
    )
    return () => { supabase.removeChannel(channel) }
  }, [profile?.id])

  async function openNotifPanel() {
    setShowNotifPanel(true)
    await supabase.rpc('purge_old_notifications')
    fetchNotifications(profile.id).then(setNotifications)
  }

  async function handleMarkAllRead() {
    await supabase.rpc('mark_all_notifications_read')
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
  }

  async function handleClearAll() {
    await supabase.rpc('delete_all_notifications')
    setNotifications([])
  }

  async function handleNotifNavigate(notif) {
    setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n))
    setShowNotifPanel(false)
    await supabase.rpc('mark_notification_read', { notif_id: notif.id })
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex flex-col">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="bg-[#1e3a5f] px-4 flex items-center gap-2 sticky top-0 z-10 shadow-sm"
              style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)', paddingBottom: '0.75rem' }}>
        <img src={logo} alt="Turno" className="h-10 w-auto shrink-0" />
        <div className="flex-1" />
        <div className="flex items-center gap-2 shrink-0">
          <BellButton
            unreadCount={notifications.filter(n => !n.is_read).length}
            onClick={openNotifPanel}
          />
          <button
            onClick={() => setActiveTab(t => t === 'settings' ? 'strutture' : 'settings')}
            className={`w-10 h-10 flex items-center justify-center rounded-xl transition-colors
              ${activeTab === 'settings'
                ? 'bg-[#e8eef5] text-[#1e3a5f]'
                : 'bg-white text-[#1e3a5f] active:bg-[#e8eef5]'}`}
            title="Impostazioni"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </header>

      {/* Pannello notifiche */}
      {showNotifPanel && (
        <NotificationsPanel
          notifications={notifications}
          onClose={() => setShowNotifPanel(false)}
          onMarkAllRead={handleMarkAllRead}
          onClearAll={handleClearAll}
          onNavigate={handleNotifNavigate}
        />
      )}

      {/* ── Tab bar ────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-[#e2e8f0] flex px-4">
        {[
          ['strutture', 'Strutture'],
          ['ferie',     'Le mie Ferie'],
        ].filter(() => activeTab !== 'settings').map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`relative flex-1 py-3 text-sm font-semibold transition-colors
              ${activeTab === tab ? 'text-[#1e3a5f]' : 'text-[#a0aec0] active:text-[#718096]'}`}
          >
            {label}
            {activeTab === tab && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-0.5 bg-[#1e3a5f] rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* ── Contenuto ──────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">

        {/* ── TAB: Strutture ─────────────────────────────────────────────── */}
        {activeTab === 'strutture' && (
          <div className="flex flex-col items-center px-4 py-10">
            <div className="w-full max-w-md">

              {/* Hero */}
              <div className="flex flex-col items-center mb-8 text-center">
                <div className="w-16 h-16 rounded-2xl bg-[#1e3a5f] flex items-center justify-center mb-4 shadow-md">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                  </svg>
                </div>
                <h1 className="text-xl font-bold text-[#1a202c] leading-tight mb-1">
                  {userStructures.length === 1
                    ? userStructures[0].name
                    : 'Seleziona struttura'}
                </h1>
                <p className="text-sm text-[#718096]">
                  {userStructures.length === 1
                    ? `Benvenuto, ${profile?.full_name ?? ''}. Clicca per iniziare.`
                    : 'Scegli con quale struttura vuoi lavorare adesso.'}
                </p>
              </div>

              {/* Lista strutture */}
              <div className="flex flex-col gap-3">
                {userStructures.map(structure => (
                  <button
                    key={structure.id}
                    onClick={() => setActiveStructure(structure.id)}
                    className="w-full bg-white rounded-2xl border border-[#e2e8f0] shadow-sm
                               px-5 py-4 flex items-center gap-4 text-left
                               hover:border-[#1e3a5f]/40 hover:shadow-md active:bg-[#f0f4f8]
                               transition-all"
                  >
                    <div className="w-11 h-11 rounded-xl bg-[#eef2f7] flex items-center justify-center shrink-0">
                      <svg className="w-5 h-5 text-[#1e3a5f]" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[#1a202c] text-base leading-tight truncate">
                        {structure.name || `Struttura ${structure.id}`}
                      </p>
                      <p className="text-xs text-[#a0aec0] mt-0.5">Tocca per accedere</p>
                    </div>
                    <div className="w-8 h-8 rounded-xl bg-[#1e3a5f] flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                ))}

                {/* Archivio Generale — solo coordinator */}
                {profile?.role === 'admin_secondary' && (
                  <button
                    type="button"
                    onClick={() => setShowArchivio(true)}
                    className="w-full bg-white rounded-2xl border border-[#e2e8f0] shadow-sm
                               px-5 py-4 flex items-center gap-4 text-left
                               hover:border-[#1e3a5f]/40 hover:shadow-md active:bg-[#f0f4f8]
                               transition-all"
                  >
                    <div className="w-11 h-11 rounded-xl bg-[#eef2f7] flex items-center justify-center shrink-0">
                      <svg className="w-5 h-5 text-[#1e3a5f]" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[#1a202c] text-base leading-tight">Archivio Generale</p>
                      <p className="text-xs text-[#a0aec0] mt-0.5">Accreditamenti, autorizzazioni e documenti ente</p>
                    </div>
                    <div className="w-8 h-8 rounded-xl bg-[#1e3a5f] flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                )}
              </div>

              <p className="text-center text-xs text-[#a0aec0] mt-8">
                Accedi come <span className="font-medium text-[#718096]">{profile?.full_name ?? ''}</span>
              </p>
            </div>
          </div>
        )}

        {/* ── TAB: Le mie Ferie ──────────────────────────────────────────── */}
        {activeTab === 'ferie' && profile && (
          <div className="max-w-lg mx-auto">
            <AbsencesTab profile={profile} />
          </div>
        )}

        {/* ── TAB: Impostazioni ──────────────────────────────────────────── */}
        {activeTab === 'settings' && (
          <div className="max-w-lg mx-auto px-4 py-6">
            <OperatorSettingsPage signOut={signOut} />
          </div>
        )}

      </main>

      {/* ── Archivio Generale overlay ── */}
      {showArchivio && (
        <div className="fixed inset-0 z-40">
          <ArchivioGenerale
            structures={userStructures}
            onClose={() => setShowArchivio(false)}
          />
        </div>
      )}
    </div>
  )
}
