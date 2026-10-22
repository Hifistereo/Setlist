import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Gate as GateState } from '../state/app'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full flex items-center justify-center p-4">
      <div className="w-full max-w-sm card p-6 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <img src="icon.svg" alt="" className="h-10 w-10" />
          <div>
            <h1 className="text-xl font-bold">Setlist</h1>
            <p className="text-xs text-mute">Songs, setlists, chords &amp; tabs for your band</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Gate({ g }: { g: GateState }) {
  if (g.step === 'loading') return <Shell><p className="text-mute text-sm">Loading…</p></Shell>
  if (g.step === 'login') return <Login />
  if (g.step === 'band') return <ChooseBand g={g} />
  return null
}

/** Email + 6-digit code. Codes (not magic links) work inside an installed iOS/Android PWA. */
function Login() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    const { error } = await supabase!.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } })
    setBusy(false)
    if (error) setErr(error.message)
    else setSent(true)
  }
  const verify = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    const { error } = await supabase!.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
    setBusy(false)
    if (error) setErr(error.message)
  }

  return (
    <Shell>
      {!sent ? (
        <form onSubmit={send} className="flex flex-col gap-3">
          <label>
            <span className="label">Email</span>
            <input className="field" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button className="btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send sign-in code'}</button>
        </form>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-3">
          <p className="text-sm text-mute">We emailed a 6-digit code to <b className="text-ink">{email}</b>.</p>
          <label>
            <span className="label">Code</span>
            <input className="field text-center text-2xl tracking-[0.4em] font-mono" inputMode="numeric" autoComplete="one-time-code"
              pattern="[0-9]{6,10}" required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
          </label>
          <button className="btn-primary" disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</button>
          <button type="button" className="btn-ghost text-xs" onClick={() => { setSent(false); setCode('') }}>Use another email / resend</button>
        </form>
      )}
      {err && <p className="text-bad text-sm">{err}</p>}
    </Shell>
  )
}

function ChooseBand({ g }: { g: Extract<GateState, { step: 'band' }> }) {
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const [mode, setMode] = useState<'pick' | 'create' | 'join'>(params.get('join') ? 'join' : 'pick')
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [instrument, setInstrument] = useState('')
  const [code, setCode] = useState(params.get('join') ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (mode === 'pick' && g.bands.length === 1 && !params.get('join')) g.choose(g.bands[0])
  }, [g, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    const { data, error } = await supabase!.rpc('create_band', { p_name: name, p_display_name: displayName, p_instrument: instrument })
    setBusy(false)
    if (error) return setErr(error.message)
    g.choose({ id: data.band_id, name, role: 'admin' })
  }
  const join = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    const { data, error } = await supabase!.rpc('join_band', { p_code: code.trim(), p_display_name: displayName, p_instrument: instrument })
    setBusy(false)
    if (error) return setErr(error.message)
    if (!data.ok) return setErr(data.error)
    history.replaceState(null, '', location.pathname + '#/')
    await g.refresh()
    const { data: b } = await supabase!.from('bands').select('name').eq('id', data.band_id).single()
    g.choose({ id: data.band_id, name: b?.name ?? 'Band', role: 'member' })
  }

  const profile = (
    <>
      <label><span className="label">Your name in the band</span>
        <input className="field" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
      <label><span className="label">Instrument</span>
        <input className="field" placeholder="vocals, guitar, bass…" value={instrument} onChange={(e) => setInstrument(e.target.value)} /></label>
    </>
  )

  return (
    <Shell>
      <p className="text-xs text-mute">Signed in as {g.user.email}</p>
      {mode === 'pick' && (
        <div className="flex flex-col gap-2">
          {g.bands.map((b) => (
            <button key={b.id} className="btn justify-between" onClick={() => g.choose(b)}>
              <span>{b.name}</span><span className="chip">{b.role}</span>
            </button>
          ))}
          {!g.bands.length && <p className="text-sm text-mute">You're not in a band yet.</p>}
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button className="btn-primary" onClick={() => setMode('create')}>Create band</button>
            <button className="btn" onClick={() => setMode('join')}>Join with code</button>
          </div>
          <button className="btn-ghost text-xs" onClick={() => void supabase?.auth.signOut()}>Sign out</button>
        </div>
      )}
      {mode === 'create' && (
        <form onSubmit={create} className="flex flex-col gap-3">
          <label><span className="label">Band name</span>
            <input className="field" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></label>
          {profile}
          <button className="btn-primary" disabled={busy}>Create</button>
          <button type="button" className="btn-ghost" onClick={() => setMode('pick')}>Back</button>
        </form>
      )}
      {mode === 'join' && (
        <form onSubmit={join} className="flex flex-col gap-3">
          <label><span className="label">Invite code</span>
            <input className="field font-mono text-xs" required value={code} onChange={(e) => setCode(e.target.value)} /></label>
          {profile}
          <button className="btn-primary" disabled={busy}>Join band</button>
          <button type="button" className="btn-ghost" onClick={() => setMode('pick')}>Back</button>
        </form>
      )}
      {err && <p className="text-bad text-sm">{err}</p>}
    </Shell>
  )
}
