import { useState } from 'react'
import { supabase } from '../lib/supabase'
import logo from '../assets/logoblu2.svg'

function EyeIcon({ open }) {
  return open ? (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ) : (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  )
}

const EMPTY_FORM = {
  code:             '',
  organizationName: '',
  fullName:         '',
  phone:            '',
  email:            '',
  password:         '',
  passwordConfirm:  '',
}

export default function Register({ onGoToLogin }) {
  const [form, setForm]           = useState(EMPTY_FORM)
  const [codeStatus, setCodeStatus] = useState('idle') // idle | checking | valid | invalid
  const [codeData, setCodeData]   = useState(null)     // { role, structure_id }
  const [submitStatus, setSubmitStatus] = useState('idle') // idle | loading | success
  const [error, setError]         = useState('')
  const [showPwd, setShowPwd]           = useState(false)
  const [showConfirmPwd, setShowConfirmPwd] = useState(false)

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function validateCode() {
    const code = form.code.trim().toUpperCase()
    if (!code) return
    setCodeStatus('checking')
    setCodeData(null)

    const { data, error } = await supabase
      .from('invitation_codes')
      .select('role, structure_id')
      .eq('code', code)
      .eq('is_used', false)
      .maybeSingle()

    if (error || !data) {
      setCodeStatus('invalid')
    } else {
      setCodeData(data)
      setCodeStatus('valid')
    }
  }

  function handleCodeChange(e) {
    set('code', e.target.value.toUpperCase())
    setCodeStatus('idle')
    setCodeData(null)
  }

  function validate() {
    if (codeStatus !== 'valid')           return 'Verifica il codice di invito.'
    if (!form.fullName.trim())            return 'Inserisci il tuo nome completo.'
    if (codeData?.role === 'manager' && !form.organizationName.trim())
                                          return 'Inserisci il nome dell\'organizzazione.'
    const digits = form.phone.replace(/\D/g, '')
    if (!form.phone.trim())               return 'Inserisci il tuo numero di telefono.'
    if (digits.length < 7)                return 'Numero di telefono non valido (minimo 7 cifre).'
    if (!form.email.trim())               return 'Inserisci la tua email.'
    if (form.password.length < 6)         return 'La password deve avere almeno 6 caratteri.'
    if (form.password !== form.passwordConfirm) return 'Le password non coincidono.'
    return null
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const err = validate()
    if (err) { setError(err); return }

    setError('')
    setSubmitStatus('loading')

    const metadata = {
      full_name:       form.fullName.trim(),
      phone:           form.phone.trim(),
      invitation_code: form.code.trim().toUpperCase(),
      ...(codeData.role === 'manager' && { organization_name: form.organizationName.trim() }),
    }

    const { error: signUpError } = await supabase.auth.signUp({
      email:    form.email.trim(),
      password: form.password,
      options:  { data: metadata },
    })

    if (signUpError) {
      const msg = signUpError.message?.toLowerCase() ?? ''
      if (msg.includes('already registered')) {
        setError('Questa email è già registrata.')
      } else if (msg.includes('codice') || msg.includes('invitation')) {
        setError('Codice invito non valido o già utilizzato.')
      } else {
        setError('Errore durante la registrazione. Riprova.')
      }
      setSubmitStatus('idle')
      return
    }

    setSubmitStatus('success')
  }

  // ── Schermata di successo ────────────────────────────────────────────────
  if (submitStatus === 'success') {
    return (
      <div className="min-h-screen flex flex-col justify-center px-6 bg-[#f8f9fa]">
        <div className="w-full max-w-sm mx-auto bg-white rounded-2xl shadow-sm border border-[#e2e8f0] p-8 text-center">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-xl font-bold text-[#1a202c] mb-2">Account creato!</h2>
          <p className="text-[#718096] text-sm mb-6">
            Controlla la tua email per confermare l'account,
            poi torna qui per accedere.
          </p>
          <button
            onClick={onGoToLogin}
            className="w-full h-12 rounded-xl bg-[#1e3a5f] text-white font-semibold text-base
                       active:bg-[#152b47] transition-colors"
          >
            Vai al login
          </button>
        </div>
      </div>
    )
  }

  // ── Form ─────────────────────────────────────────────────────────────────
  const isManager     = codeStatus === 'valid' && codeData?.role === 'manager'
  const isOperator    = codeStatus === 'valid' && codeData?.role === 'operator'
  const isCoordinator = codeStatus === 'valid' && codeData?.role === 'admin_secondary'

  return (
    <div className="min-h-screen flex flex-col justify-center px-6 bg-[#f8f9fa] py-12">

      {/* Logo */}
      <div className="mb-8 text-center">
        <img src={logo} alt="Turno" className="h-20 w-auto mx-auto mb-2" />
        <p className="text-[#718096] mt-1 text-sm">Crea il tuo account</p>
      </div>

      <div className="w-full max-w-sm mx-auto bg-white rounded-2xl shadow-sm border border-[#e2e8f0] p-8">
        <h2 className="text-xl font-semibold text-[#1a202c] mb-6">Registrazione</h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">

          {/* ── CODICE DI INVITO ── */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[#1a202c]">
              Codice di invito <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.code}
                onChange={handleCodeChange}
                onBlur={validateCode}
                placeholder="TURNO-XXX-000"
                autoCapitalize="characters"
                spellCheck={false}
                className={`flex-1 h-12 px-4 rounded-xl border text-[#1a202c] text-base bg-white
                  outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 transition-colors
                  uppercase tracking-wider placeholder:normal-case placeholder:tracking-normal
                  ${codeStatus === 'valid'   ? 'border-green-400'
                  : codeStatus === 'invalid' ? 'border-red-400'
                  : 'border-[#e2e8f0] focus:border-[#1e3a5f]'}`}
              />
              <button
                type="button"
                onClick={validateCode}
                disabled={codeStatus === 'checking' || !form.code.trim()}
                className="h-12 px-4 rounded-xl bg-[#1e3a5f] text-white text-sm font-medium shrink-0
                           active:bg-[#152b47] disabled:opacity-50 transition-colors"
              >
                {codeStatus === 'checking' ? '…' : 'Verifica'}
              </button>
            </div>

            {/* Feedback codice */}
            {codeStatus === 'valid' && codeData && (
              <div className="flex items-center gap-2">
                <span className="text-green-600 text-sm font-semibold">✓ Codice valido</span>
                <span className={`text-xs font-semibold rounded-full px-2.5 py-0.5
                  ${isManager     ? 'bg-[#eef2f7] text-[#1e3a5f]'
                  : isCoordinator ? 'bg-indigo-50 text-indigo-700'
                  :                 'bg-green-50 text-green-700'}`}>
                  {isManager ? 'Responsabile' : isCoordinator ? 'Coordinatore' : 'Operatore'}
                </span>
              </div>
            )}
            {codeStatus === 'invalid' && (
              <p className="text-xs text-red-600">Codice non valido o già utilizzato.</p>
            )}
          </div>

          {/* ── NOME ORGANIZZAZIONE (solo responsabile) ── */}
          {isManager && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[#1a202c]">
                Nome dell'organizzazione <span className="text-red-500">*</span>
              </label>
              <p className="text-xs text-[#718096]">
                Es. Cooperativa Sociale Aurora. Le strutture si aggiungono dalla dashboard.
              </p>
              <input
                type="text"
                value={form.organizationName}
                onChange={e => set('organizationName', e.target.value)}
                placeholder="Es. Cooperativa Sociale Aurora"
                className="w-full h-12 px-4 rounded-xl border border-[#e2e8f0] text-[#1a202c] text-base
                           bg-white outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                           transition-colors placeholder:text-[#a0aec0]"
              />
            </div>
          )}

          {/* Info struttura (operatore o coordinatore) */}
          {(isOperator || isCoordinator) && (
            <div className="rounded-xl bg-[#eef2f7] px-4 py-3 text-sm text-[#1e3a5f]">
              {isCoordinator
                ? 'Verrai collegato alle strutture associate al tuo codice di coordinatore.'
                : 'Verrai collegato alla struttura associata al tuo codice.'}
            </div>
          )}

          {/* ── NOME COMPLETO ── */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[#1a202c]">
              Nome completo <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.fullName}
              onChange={e => set('fullName', e.target.value)}
              placeholder="Mario Rossi"
              autoComplete="name"
              className="w-full h-12 px-4 rounded-xl border border-[#e2e8f0] text-[#1a202c] text-base
                         bg-white outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                         transition-colors placeholder:text-[#a0aec0]"
            />
          </div>

          {/* ── TELEFONO ── */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[#1a202c]">
              Numero di telefono <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#a0aec0]">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M2.25 6.338c0-1.01.684-1.87 1.67-2.084l2.083-.416a1.5 1.5 0 011.62.806l1.03 2.06a1.5 1.5 0 01-.43 1.883l-.663.497a11.257 11.257 0 005.576 5.576l.497-.663a1.5 1.5 0 011.883-.43l2.06 1.03a1.5 1.5 0 01.806 1.62l-.416 2.083A2.25 2.25 0 0117.662 21.75C9.12 21.75 2.25 14.88 2.25 6.338z" />
                </svg>
              </div>
              <input
                type="tel"
                value={form.phone}
                onChange={e => {
                  const v = e.target.value
                  if (/^[\d\s\+\-\(\)]*$/.test(v)) set('phone', v)
                }}
                placeholder="+39 333 1234567"
                autoComplete="tel"
                inputMode="tel"
                className="w-full h-12 pl-10 pr-4 rounded-xl border border-[#e2e8f0] text-[#1a202c] text-base
                           bg-white outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                           transition-colors placeholder:text-[#a0aec0]"
              />
            </div>
          </div>

          {/* ── EMAIL ── */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[#1a202c]">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={form.email}
              onChange={e => set('email', e.target.value)}
              placeholder="nome@email.com"
              autoComplete="email"
              className="w-full h-12 px-4 rounded-xl border border-[#e2e8f0] text-[#1a202c] text-base
                         bg-white outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                         transition-colors placeholder:text-[#a0aec0]"
            />
          </div>

          {/* ── PASSWORD ── */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[#1a202c]">
              Password <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                value={form.password}
                onChange={e => set('password', e.target.value)}
                placeholder="Minimo 6 caratteri"
                autoComplete="new-password"
                className="w-full h-12 pl-4 pr-12 rounded-xl border border-[#e2e8f0] text-[#1a202c] text-base
                           bg-white outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                           transition-colors placeholder:text-[#a0aec0]"
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a0aec0] hover:text-[#718096] transition-colors p-1"
                aria-label={showPwd ? 'Nascondi password' : 'Mostra password'}
              >
                <EyeIcon open={showPwd} />
              </button>
            </div>
          </div>

          {/* ── CONFERMA PASSWORD ── */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[#1a202c]">
              Conferma password <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showConfirmPwd ? 'text' : 'password'}
                value={form.passwordConfirm}
                onChange={e => set('passwordConfirm', e.target.value)}
                placeholder="Ripeti la password"
                autoComplete="new-password"
                className="w-full h-12 pl-4 pr-12 rounded-xl border border-[#e2e8f0] text-[#1a202c] text-base
                           bg-white outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20
                           transition-colors placeholder:text-[#a0aec0]"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPwd(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a0aec0] hover:text-[#718096] transition-colors p-1"
                aria-label={showConfirmPwd ? 'Nascondi password' : 'Mostra password'}
              >
                <EyeIcon open={showConfirmPwd} />
              </button>
            </div>
          </div>

          {/* Errore */}
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitStatus === 'loading'}
            className="w-full h-12 rounded-xl bg-[#1e3a5f] text-white font-semibold text-base
                       active:bg-[#152b47] disabled:opacity-60 transition-colors mt-1"
          >
            {submitStatus === 'loading' ? 'Creazione account…' : 'Crea account'}
          </button>
        </form>

        <p className="text-center text-sm text-[#718096] mt-6">
          Hai già un account?{' '}
          <button
            onClick={onGoToLogin}
            className="text-[#1e3a5f] font-semibold"
          >
            Accedi
          </button>
        </p>
      </div>
    </div>
  )
}
