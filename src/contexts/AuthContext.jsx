import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession]   = useState(undefined) // undefined = loading
  const [profile, setProfile]   = useState(null)
  const [userStructures, setUserStructures] = useState([]) // strutture dell'utente
  const [activeStructureId, setActiveStructureIdState] = useState(null)
  const [loadingProfile, setLoadingProfile] = useState(false)

  // Carica il profilo utente dalla tabella profiles
  // freshLogin = true quando arriva da evento SIGNED_IN (login/registrazione esplicita)
  // freshLogin = false quando arriva da getSession (reload pagina)
  async function fetchProfile(userId, freshLogin = false) {
    setLoadingProfile(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role, structure_id, organization_id, is_secretary')
      .eq('id', userId)
      .single()

    if (error || !data) {
      console.error('Errore nel caricamento profilo:', error?.message)
      setProfile(null)
      setLoadingProfile(false)
      return
    }

    // Per manager: le strutture vengono caricate dalla dashboard stessa
    // Per operatori/coordinatori: carica tutte le strutture da user_structures
    if (data.role !== 'manager') {
      const { data: userStructRows } = await supabase
        .from('user_structures')
        .select('structure_id, structures(id, name)')
        .eq('user_id', userId)
        .eq('is_active', true)

      const structs = (userStructRows ?? [])
        .map(r => r.structures)
        .filter(Boolean)

      if (structs.length > 0) {
        setUserStructures(structs)

        // Ripristina l'ultima struttura attiva da localStorage
        const storageKey = `active_structure_${userId}`
        const saved = localStorage.getItem(storageKey)
        const savedId = saved ? Number(saved) : null
        const validSaved = savedId && structs.some(s => s.id === savedId)

        if (!freshLogin && validSaved) {
          // Reload di pagina con preferenza salvata → ripristina senza chiedere
          setActiveStructureIdState(savedId)
          setProfile({ ...data, structure_id: savedId })
        } else {
          // Login/registrazione freschi → sempre Menu Generale (anche con 1 sola struttura)
          setActiveStructureIdState(null)
          setProfile({ ...data, structure_id: null })
        }
      } else {
        // Nessuna struttura in user_structures → fallback a profilo
        setUserStructures(data.structure_id ? [{ id: data.structure_id, name: '' }] : [])
        setActiveStructureIdState(data.structure_id ?? null)
        setProfile(data)
      }
    } else {
      setProfile(data)
      setUserStructures([])
      setActiveStructureIdState(null)
    }

    setLoadingProfile(false)
  }

  function setActiveStructure(structureId) {
    if (!profile) return
    const storageKey = `active_structure_${profile.id}`
    if (structureId === null) {
      localStorage.removeItem(storageKey)
    } else {
      localStorage.setItem(storageKey, String(structureId))
    }
    setActiveStructureIdState(structureId)
    // Non tocchiamo profile.structure_id quando torniamo al selettore (null)
    if (structureId !== null) {
      setProfile(prev => prev ? { ...prev, structure_id: structureId } : prev)
    }
  }

  useEffect(() => {
    // Sessione iniziale
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session?.user) fetchProfile(session.user.id)
    })

    // Ascolta i cambiamenti di stato auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session)
        if (session?.user) {
          // SIGNED_IN = login o registrazione esplicita → mostra selettore
          fetchProfile(session.user.id, event === 'SIGNED_IN')
        } else {
          setProfile(null)
          setUserStructures([])
          setActiveStructureIdState(null)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  const loading = session === undefined || loadingProfile

  return (
    <AuthContext.Provider value={{
      session,
      profile,
      loading,
      userStructures,
      activeStructureId,
      setActiveStructure,
      signIn,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve essere usato dentro <AuthProvider>')
  return ctx
}
