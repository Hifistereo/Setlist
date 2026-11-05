import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp, useSyncStatus } from '../state/app'
import { Layout } from '../components/Layout'
import { Conflicts } from '../components/Conflicts'
import { supabase } from '../lib/supabase'
import { exportBackup, restoreBackup, downloadBlob } from '../lib/backup'
import { BASE } from '../lib/config'
import type { OutboxEntry } from '../lib/types'

interface Invite { code: string; expires_at: string; max_uses: number; uses: number; revoked: boolean }

export function Band() {
  const { demo, bandName, user, members, isAdmin, switchBand, signOut } = useApp()
  useEffect(() => {
    if (location.hash.includes('#sync')) document.getElementById('sync')?.scrollIntoView()
  }, [])
  return (
    <Layout title="Band">
      <div className="flex flex-col gap-4">
        <section className="card p-4">
          <h2 className="font-semibold">{bandName}</h2>
          <p className="text-xs text-mute">{demo ? 'Demo mode' : `Signed in as ${user.email}`}</p>
          {!demo && <Profile />}
          <ul className="mt-3 divide-y divide-line">
            {members.map((m) => <MemberRow key={m.user_id} m={m} />)}
          </ul>
        </section>
        {isAdmin && !demo && <Invites />}
        <SyncPanel />
        <Backup />
        <Device />
        {!demo && (
          <div className="flex gap-2">
            <button className="btn" onClick={switchBand}>Switch band</button>
            <button className="btn-danger" onClick={() => void signOut()}>Sign out</button>
          </div>
        )}
        <p className="text-[11px] text-mute text-center">Setlist · tab rendering by alphaTab (MPL-2.0)</p>
      </div>
    </Layout>
  )
}

function Profile() {
  const { bandId, members, user, engine } = useApp()
  const me = members.find((m) => m.user_id === user.id)
  const [name, setName] = useState(me?.display_name ?? '')
  const [inst, setInst] = useState(me?.instrument ?? '')
  useEffect(() => { setName(me?.display_name ?? ''); setInst(me?.instrument ?? '') }, [me?.display_name, me?.instrument])
  const save = async () => {
    const { error } = await supabase!.rpc('update_my_profile', { p_band: bandId, p_display_name: name, p_instrument: inst })
    if (error) alert(error.message)
    else void engine.syncNow()
  }
  return (
    <div className="grid grid-cols-2 gap-2 mt-3">
      <input className="field" aria-label="Your name" value={name} onChange={(e) => setName(e.target.value)} onBlur={save} />
      <input className="field" aria-label="Your instrument" placeholder="Instrument" value={inst} onChange={(e) => setInst(e.target.value)} onBlur={save} />
    </div>
  )
}

function MemberRow({ m }: { m: ReturnType<typeof useApp>['members'][number] }) {
  const { isAdmin, user, bandId, engine, demo } = useApp()
  const act = async (fn: string, args: Record<string, unknown>) => {
    const { error } = await supabase!.rpc(fn, args)
    if (error) alert(error.message)
    else void engine.syncNow()
  }
  return (
    <li className="flex items-center gap-2 py-2 text-sm">
      <span className="flex-1">{m.display_name || 'Member'}{m.user_id === user.id && ' (you)'} <span className="text-mute">{m.instrument}</span></span>
      <span className="chip">{m.role}</span>
      {isAdmin && !demo && m.user_id !== user.id && (
        <>
          <button className="btn-ghost text-xs" onClick={() => act('set_member_role', { p_band: bandId, p_user: m.user_id, p_role: m.role === 'admin' ? 'member' : 'admin' })}>
            {m.role === 'admin' ? 'Make member' : 'Make admin'}
          </button>
          <button className="btn-ghost text-xs text-bad" onClick={() => confirm(`Remove ${m.display_name}?`) && act('remove_member', { p_band: bandId, p_user: m.user_id })}>Remove</button>
        </>
      )}
    </li>
  )
}

function Invites() {
  const { bandId } = useApp()
  const [list, setList] = useState<Invite[]>([])
  const [err, setErr] = useState<string | null>(null)
  const load = async () => {
    const { data, error } = await supabase!.from('band_invites').select('code, expires_at, max_uses, uses, revoked').eq('band_id', bandId).order('created_at', { ascending: false })
    if (error) setErr(navigator.onLine ? error.message : 'Offline'); else setList(data as Invite[])
  }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const create = async () => {
    const { error } = await supabase!.rpc('create_invite', { p_band: bandId, p_days: 14, p_max_uses: 10 })
    if (error) setErr(error.message); else void load()
  }
  const revoke = async (code: string) => {
    const { error } = await supabase!.rpc('revoke_invite', { p_code: code })
    if (error) setErr(error.message); else void load()
  }
  const link = (code: string) => `${location.origin}${BASE}#/?join=${code}`
  const share = async (code: string) => {
    const url = link(code)
    try {
      if (navigator.share) await navigator.share({ title: 'Join our band on Setlist', url })
      else { await navigator.clipboard.writeText(url); alert('Invite link copied') }
    } catch { /* cancelled */ }
  }
  const active = list.filter((i) => !i.revoked && new Date(i.expires_at) > new Date() && i.uses < i.max_uses)
  return (
    <section className="card p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold flex-1">Invite bandmates</h2>
        <button className="btn text-xs" onClick={create}>New invite</button>
      </div>
      <p className="text-xs text-mute">Invite links expire after 14 days or 10 uses. Revoke any you've shared by mistake.</p>
      {err && <p className="text-xs text-bad">{err}</p>}
      {active.map((i) => (
        <div key={i.code} className="flex items-center gap-2 text-xs">
          <code className="flex-1 truncate text-mute">{i.code.slice(0, 12)}…</code>
          <span className="text-mute">{i.uses}/{i.max_uses} · until {new Date(i.expires_at).toLocaleDateString()}</span>
          <button className="btn-primary text-xs" onClick={() => share(i.code)}>Share link</button>
          <button className="btn-ghost text-xs text-bad" onClick={() => revoke(i.code)}>Revoke</button>
        </div>
      ))}
      {!active.length && !err && <p className="text-xs text-mute">No active invites.</p>}
    </section>
  )
}

function SyncPanel() {
  const { engine, db } = useApp()
  const s = useSyncStatus()
  const failed = useLiveQuery(() => db.outbox.filter((e) => !!e.error).toArray(), [db], [] as OutboxEntry[])
  if (s.mode === 'demo') {
    return (
      <section id="sync" className="card p-4 text-sm">
        <h2 className="font-semibold">Sync</h2>
        <p className="text-mute text-xs mt-1">Demo mode keeps everything in this browser only. To share with your band, set up Supabase (see README) and rebuild with <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>.</p>
      </section>
    )
  }
  return (
    <section id="sync" className="card p-4 flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold flex-1">Sync</h2>
        <button className="btn text-xs" onClick={() => void engine.syncNow()} disabled={s.syncing}>{s.syncing ? 'Syncing…' : 'Sync now'}</button>
      </div>
      <div className="text-xs text-mute grid grid-cols-2 gap-1">
        <span>Connection: <b className={s.online ? 'text-ok' : 'text-warn'}>{s.online ? 'online' : 'offline'}</b></span>
        <span>Last sync: <b className="text-ink">{s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleTimeString() : 'never'}</b></span>
        <span>Waiting to send: <b className="text-ink">{s.pending}</b></span>
        <span>Conflicts: <b className={s.conflicts ? 'text-bad' : 'text-ink'}>{s.conflicts}</b></span>
      </div>
      {s.authError && <p className="text-bad text-xs">Your session expired. Your changes are safe on this device — sign out and back in to send them.</p>}
      {s.lastError && !s.authError && <p className="text-warn text-xs">Last error: {s.lastError}</p>}
      {failed.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-bad text-xs">The server rejected {failed.length} change(s). They are kept until you decide.</p>
          {failed.map((f) => (
            <div key={f.seq} className="flex items-center gap-2 text-xs">
              <span className="flex-1 truncate">{f.table} · {Object.keys(f.fields).join(', ')} — {f.error}</span>
              <button className="btn-ghost text-xs text-bad" onClick={async () => {
                if (!confirm('Discard this change permanently?')) return
                try { await engine.discardFailed(f.seq!) } catch { alert('Connect to the internet to discard — the current version has to be fetched first.') }
              }}>Discard</button>
            </div>
          ))}
          <button className="btn text-xs self-start" onClick={() => engine.retryFailed()}>Retry all</button>
        </div>
      )}
      <Conflicts />
    </section>
  )
}

function Backup() {
  const { engine, bandName, isAdmin, demo } = useApp()
  const input = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const exp = async () => {
    setMsg('Preparing backup…')
    try {
      const blob = await exportBackup(engine, bandName)
      downloadBlob(blob, `setlist-${bandName.replace(/\W+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.zip`)
      setMsg(`Backup saved (${Math.round(blob.size / 1024)} KB). Includes only your own private notes.`)
    } catch (e) { setMsg(`Export failed: ${(e as Error).message}`) }
  }
  const restore = async (f: File) => {
    if (!confirm('Restore this backup into the current band? Existing songs with the same id are updated; conflicts are shown for review.')) return
    setMsg('Restoring…')
    try {
      const r = await restoreBackup(engine, await f.arrayBuffer())
      setMsg(`Restored ${r.rows} records, ${r.files} files, ${r.notes} notes${r.skippedNotes ? ` (${r.skippedNotes} notes belonged to someone else and were skipped)` : ''}.`)
    } catch (e) { setMsg(`Restore failed: ${(e as Error).message}`) }
  }
  return (
    <section className="card p-4 flex flex-col gap-2">
      <h2 className="font-semibold">Backup</h2>
      <p className="text-xs text-mute">Export songs, setlists, tabs and your private notes as a .zip. Keep one before big gigs — free cloud plans can pause and phones can clear storage.</p>
      <div className="flex gap-2">
        <button className="btn" onClick={exp}>Export backup</button>
        {(isAdmin || demo) && <button className="btn" onClick={() => input.current?.click()}>Restore…</button>}
        <input ref={input} type="file" accept=".zip" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void restore(f); e.target.value = '' }} />
      </div>
      {msg && <p className="text-xs text-mute">{msg}</p>}
    </section>
  )
}

function Device() {
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [usage, setUsage] = useState<string | null>(null)
  const standalone = typeof window !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone)
  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted)
    void navigator.storage?.estimate?.().then((e) => setUsage(e.usage != null ? `${(e.usage / 1024 / 1024).toFixed(1)} MB used` : null))
  }, [])
  return (
    <section className="card p-4 text-xs text-mute flex flex-col gap-1">
      <h2 className="font-semibold text-sm text-ink">This device</h2>
      <span>Installed app: <b className="text-ink">{standalone ? 'yes' : 'no'}</b>{!standalone && ' — use “Add to Home Screen” (iOS Safari: Share → Add to Home Screen) for reliable offline use.'}</span>
      <span>Persistent storage: <b className={persisted ? 'text-ok' : 'text-warn'}>{persisted == null ? 'unknown' : persisted ? 'granted' : 'not granted'}</b>
        {!persisted && <button className="btn-ghost text-xs" onClick={() => void navigator.storage?.persist?.().then(setPersisted)}>Request</button>}</span>
      {usage && <span>{usage}</span>}
      <span>Even with persistent storage a browser may clear data under pressure — keep a backup.</span>
    </section>
  )
}
