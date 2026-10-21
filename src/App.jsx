import { useState, useEffect } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ErrorProvider } from './contexts/ErrorContext'
import ErrorBoundary from './components/ErrorBoundary'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import UpdatePassword from './pages/UpdatePassword'
import OperatorHome from './pages/OperatorHome'
import ManagerDashboard from './pages/ManagerDashboard'
import AdminDashboard from './pages/AdminDashboard'
import StructureSelector from './pages/StructureSelector'
import logo from './assets/logobianco2.svg'

const ADMIN_EMAIL = 'umberto.vignati05@gmail.com'

const Spinner = () => (
  <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
    <div className="w-8 h-8 rounded-full border-2 border-[#1e3a5f] border-t-transparent animate-spin" />
  </div>
)

function NoStructurePage() {
  const { signOut } = useAuth()
  return (
    <div className="min-h-screen bg-[#f8f9fa] flex flex-col">
      <header className="bg-[#1e3a5f] px-4 py-3 flex items-center justify-between shadow-sm">
        <img src={logo} alt="Turno" className="h-10 w-auto -ml-2" />
        <button
          onClick={signOut}
          className="text-white/70 text-xs font-medium px-3 py-1.5 rounded-lg
                     hover:text-white hover:bg-white/10 transition-colors"
        >
          Esci
        </button>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <span className="text-5xl mb-5">🏠</span>
        <h1 className="text-xl font-bold text-[#1a202c] mb-2">
          Nessuna struttura associata
        </h1>
        <p className="text-sm text-[#718096] max-w-xs">
          Non sei ancora stato associato a nessuna struttura.
          Contatta il tuo coordinatore o manager per ricevere un codice di accesso.
        </p>
      </main>
    </div>
  )
}

// ── Router minimale basato su window.location.pathname ───────────────────────
function useRouter() {
  const [path, setPath] = useState(window.location.pathname)

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function navigate(to) {
    window.history.pushState(null, '', to)
    setPath(to)
  }

  return { path, navigate }
}

// ─────────────────────────────────────────────────────────────────────────────

function AppRoutes() {
  const { session, profile, loading, userStructures, activeStructureId, signOut } = useAuth()
  const { path, navigate }            = useRouter()
  const [authView, setAuthView]       = useState('login')

  if (loading) return <Spinner />

  // ── Rotte pubbliche speciali (bypass auth) ────────────────────────────────
  if (path === '/forgot-password')
    return <ForgotPassword onBack={() => navigate('/')} />

  if (path === '/update-password')
    return <UpdatePassword onDone={() => navigate('/')} />

  // ── Rotta /admin ──────────────────────────────────────────────────────────
  if (path === '/admin') {
    if (!session)  { navigate('/'); return <Spinner /> }
    if (!profile)  return <Spinner />
    if (session.user.email !== ADMIN_EMAIL) { navigate('/'); return null }
    return <AdminDashboard onBack={() => navigate('/')} />
  }

  // ── Rotte pubbliche (non autenticato) ─────────────────────────────────────
  if (!session) {
    if (authView === 'register') {
      return <Register onGoToLogin={() => setAuthView('login')} />
    }
    return <Login
      onGoToRegister={() => setAuthView('register')}
      onForgotPassword={() => navigate('/forgot-password')}
    />
  }

  if (!profile) return <Spinner />

  // ── App autenticata ───────────────────────────────────────────────────────
  if (session.user.email === ADMIN_EMAIL)
    return <AdminDashboard onBack={signOut} />

  if (profile.role === 'manager')
    return <ManagerDashboard onGoToAdmin={() => navigate('/admin')} />

  // Operatore: nessuna struttura associata → pagina di attesa
  if (userStructures.length === 0 && !profile.structure_id)
    return <NoStructurePage />

  // Senza struttura attiva → Menu Generale (sempre, anche con 1 sola struttura)
  if (!activeStructureId)
    return <StructureSelector />

  // key garantisce unmount/remount completo al cambio struttura
  return <OperatorHome key={activeStructureId} />
}

// ─── Banner "Aggiungi a schermata Home" ──────────────────────────────────────
function InstallBanner() {
  const [prompt,    setPrompt]    = useState(null)  // evento beforeinstallprompt (Android)
  const [showIOS,   setShowIOS]   = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (dismissed) return
    const already = localStorage.getItem('pwa-installed')
    if (already) return

    // Android / Chrome: cattura l'evento prima che il browser lo mostri da solo
    const handler = e => { e.preventDefault(); setPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)

    // iOS Safari: non supporta beforeinstallprompt → mostriamo banner manuale
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const isStandalone = window.navigator.standalone === true
    if (isIOS && !isStandalone) {
      const timer = setTimeout(() => setShowIOS(true), 3000)
      return () => { clearTimeout(timer); window.removeEventListener('beforeinstallprompt', handler) }
    }

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [dismissed])

  function dismiss() {
    setPrompt(null); setShowIOS(false); setDismissed(true)
    localStorage.setItem('pwa-installed', '1')
  }

  async function install() {
    if (!prompt) return
    prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') localStorage.setItem('pwa-installed', '1')
    setPrompt(null)
  }

  // Android: banner con pulsante "Installa"
  if (prompt) return (
    <div className="fixed bottom-0 left-0 right-0 z-[9999] px-4 pb-safe-or-4 pb-4">
      <div className="bg-[#1e3a5f] rounded-2xl px-4 py-3.5 flex items-center gap-3 shadow-2xl">
        <img src="/icons/icon-192.png" alt="" className="w-10 h-10 rounded-xl shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-sm leading-tight">Installa Turno</p>
          <p className="text-white/70 text-xs leading-tight mt-0.5">Aggiungila alla schermata Home</p>
        </div>
        <button type="button" onClick={dismiss}
          className="text-white/50 text-lg leading-none px-1">✕</button>
        <button type="button" onClick={install}
          className="bg-white text-[#1e3a5f] font-bold text-sm px-4 py-2 rounded-xl shrink-0">
          Installa
        </button>
      </div>
    </div>
  )

  // iOS: istruzioni passo-passo
  if (showIOS) return (
    <div className="fixed bottom-0 left-0 right-0 z-[9999] px-4 pb-4">
      <div className="bg-[#1e3a5f] rounded-2xl px-4 py-4 shadow-2xl">
        <div className="flex items-start justify-between mb-2">
          <p className="text-white font-semibold text-sm">Aggiungi Turno alla Home</p>
          <button type="button" onClick={dismiss} className="text-white/50 text-lg leading-none ml-3">✕</button>
        </div>
        <p className="text-white/80 text-xs leading-relaxed">
          Tocca <span className="text-white font-semibold">Condividi</span> (□↑) in basso,
          poi <span className="text-white font-semibold">"Aggiungi a schermata Home"</span>.
          L'app si aprirà senza la barra del browser.
        </p>
        {/* Freccia che punta verso il basso (verso il tasto Condividi di Safari) */}
        <div className="flex justify-center mt-3">
          <span className="text-white/60 text-2xl animate-bounce">↓</span>
        </div>
      </div>
    </div>
  )

  return null
}

export default function App() {
  return (
    <ErrorBoundary>
      <ErrorProvider>
        <AuthProvider>
          <AppRoutes />
          <InstallBanner />
        </AuthProvider>
      </ErrorProvider>
    </ErrorBoundary>
  )
}
