import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = process.env.VITE_SUPABASE_URL
const serviceRoleKey  = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Mancano VITE_SUPABASE_URL o VITE_SUPABASE_SERVICE_ROLE_KEY nel .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const USERS = [
  {
    email:        'operatore@turno.it',
    password:     'password1234',
    full_name:    'Mario Rossi',
    role:         'operator',
    structure_id: 1,
  },
  {
    email:        'manager@turno.it',
    password:     'password1234',
    full_name:    'Laura Bianchi',
    role:         'manager',
    structure_id: 1,
  },
]

async function ensureStructure() {
  const { data, error } = await supabase
    .from('structures')
    .select('id, name')
    .eq('id', 1)
    .single()

  if (error || !data) {
    console.error('Struttura 1 non trovata. Esegui prima lo schema SQL.')
    process.exit(1)
  }
  console.log(`✓ Struttura trovata: "${data.name}" (id: ${data.id})`)
}

async function createUser({ email, password, full_name, role, structure_id }) {
  // 1. Crea l'utente in auth.users con i metadata per il trigger
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,          // niente email di verifica
    user_metadata: { full_name, role, structure_id },
  })

  if (error) {
    // Utente già esistente → non è un errore bloccante
    if (error.message.includes('already been registered')) {
      console.log(`⚠  ${email} esiste già, salto.`)
      return
    }
    throw new Error(`Errore creazione ${email}: ${error.message}`)
  }

  console.log(`✓ Utente creato: ${email} (${role}) — id: ${data.user.id}`)
}

async function main() {
  console.log('\n=== Seed utenti Turno ===\n')

  await ensureStructure()

  for (const user of USERS) {
    await createUser(user)
  }

  console.log('\nSeed completato. Puoi fare login con:')
  console.log('  operatore@turno.it / password1234')
  console.log('  manager@turno.it   / password1234\n')
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
