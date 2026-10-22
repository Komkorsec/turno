import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import logo from '../assets/logobianco2.svg'
import ArchivioGenerale from '../components/ArchivioGenerale'

export default function SecretaryHome() {
  const { profile, signOut } = useAuth()
  const [structures, setStructures] = useState([])

  useEffect(() => {
    if (!profile?.organization_id) return
    supabase
      .from('structures')
      .select('id, name')
      .eq('organization_id', profile.organization_id)
      .order('id')
      .then(({ data }) => setStructures(data ?? []))
  }, [profile?.organization_id])

  return (
    <ArchivioGenerale
      structures={structures}
      onClose={signOut}
      hideBackAsLogout
    />
  )
}
