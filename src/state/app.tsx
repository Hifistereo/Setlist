import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { IS_DEMO } from '../lib/config'
import { SetlistDB, DEMO_DB_NAME, cloudDbName } from '../lib/db'
import { supabase } from '../lib/supabase'
import { SyncEngine, type SyncStatus } from '../lib/sync/engine'
import { SupabaseServer } from '../lib/sync/supabaseServer'
import type { Member } from '../lib/types'
import { seedDemo } from '../lib/seed'
import { requestPersistence } from '../lib/gig'

export interface SessionUser {
  id: string
  email: string
}

export interface BandChoice {
  id: string
  name: string
  role: 'admin' | 'member'
}

interface AppState {
  demo: boolean
  user: SessionUser
  bandId: string
  bandName: string
  db: SetlistDB
  engine: SyncEngine
  members: Member[]
  isAdmin: boolean
  memberName: (id: string | null | undefined) => string
  switchBand: () => void
  signOut: () => Promise<void>
}

const Ctx = createContext<AppState | null>(null)

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside provider')
  return v
}

export function useSyncStatus(): SyncStatus {
  const { engine } = useApp()
  const [s, set] = useState(engine.getStatus())
  useEffect(() => {
    const off = engine.onStatus(set)
    return () => { off() }
  }, [engine])
  return s
}

const LS_USER = 'setlist.user'
const LS_BAND = 'setlist.band'
const LS_BANDS = 'setlist.bands'

function readLS<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : null
  } catch {
    return null
  }
}
function writeLS(key: string, v: unknown) {
  try {
    if (v == null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(v))
  } catch { /* storage unavailable */ }
}

export type Gate =
  | { step: 'loading' }
  | { step: 'login' }
  | { step: 'band'; user: SessionUser; bands: BandChoice[]; refresh: () => Promise<void>; choose: (b: BandChoice) => void }
  | { step: 'ready' }

export async function fetchMyBands(userId: string): Promise<BandChoice[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('band_members').select('band_id, role, bands(name)').eq('user_id', userId)
  if (error) throw error
  const bands = (data ?? []).map((r) => ({
    id: r.band_id as string,
    role: r.role as 'admin' | 'member',
    name: ((r.bands as unknown as { name: string } | null)?.name) ?? 'Band',
  }))
  writeLS(LS_BANDS, bands)
  return bands
}

export function AppProvider({ children, gate }: { children: ReactNode; gate: (g: Gate) => ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(IS_DEMO ? { id: 'demo-user', email: 'demo' } : readLS<SessionUser>(LS_USER))
  const [band, setBand] = useState<BandChoice | null>(
    IS_DEMO ? { id: 'demo-band', name: 'Demo Band', role: 'admin' } : readLS<BandChoice>(LS_BAND),
  )
  const [bands, setBands] = useState<BandChoice[]>(readLS<BandChoice[]>(LS_BANDS) ?? [])
  const [authChecked, setAuthChecked] = useState(IS_DEMO)

  // Session: Supabase keeps it in localStorage; we also remember the last user so the app opens offline.
  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        const u = { id: data.session.user.id, email: data.session.user.email ?? '' }
        setUser(u)
        writeLS(LS_USER, u)
      } else if (navigator.onLine) {
        // Online with no session at all → must sign in. Offline → keep working locally.
        setUser(null)
      }
      setAuthChecked(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        const u = { id: session.user.id, email: session.user.email ?? '' }
        setUser((prev) => (prev?.id === u.id ? prev : u))
        writeLS(LS_USER, u)
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const refreshBands = useCallback(async () => {
    if (!user || IS_DEMO) return
    try {
      setBands(await fetchMyBands(user.id))
    } catch { /* offline: keep cached list */ }
  }, [user])

  useEffect(() => { void refreshBands() }, [refreshBands])

  const db = useMemo(() => (user ? new SetlistDB(IS_DEMO ? DEMO_DB_NAME : cloudDbName(user.id)) : null), [user])
  const engine = useMemo(() => {
    if (!db || !user || !band) return null
    return new SyncEngine(db, supabase ? new SupabaseServer(supabase) : null, user.id, band.id)
  }, [db, user, band])

  useEffect(() => {
    if (!engine) return
    if (IS_DEMO) void seedDemo(engine)
    void requestPersistence()
    engine.start()
    return () => engine.stop()
  }, [engine])

  const members = useLiveQuery(
    () => (db && band ? db.members.where('band_id').equals(band.id).toArray() : Promise.resolve([] as Member[])),
    [db, band],
    [] as Member[],
  )

  const memberName = useCallback(
    (id: string | null | undefined) => {
      if (!id) return ''
      if (id === user?.id) return 'you'
      return members.find((m) => m.user_id === id)?.display_name || 'a bandmate'
    },
    [members, user],
  )

  useEffect(() => {
    if (engine) engine.memberName = memberName
  }, [engine, memberName])

  const switchBand = useCallback(() => {
    writeLS(LS_BAND, null)
    setBand(null)
  }, [])

  const signOut = useCallback(async () => {
    if (engine) {
      const s = engine.getStatus()
      if (s.pending > 0 && !confirm(`${s.pending} change(s) are not synced yet and will stay on this device until you sign in again. Sign out?`)) return
    }
    await supabase?.auth.signOut()
    writeLS(LS_USER, null)
    writeLS(LS_BAND, null)
    setBand(null)
    setUser(null)
  }, [engine])

  if (!authChecked) return <>{gate({ step: 'loading' })}</>
  if (!user) return <>{gate({ step: 'login' })}</>
  if (!band || !engine || !db) {
    return (
      <>
        {gate({
          step: 'band', user, bands, refresh: refreshBands,
          choose: (b) => { writeLS(LS_BAND, b); setBand(b) },
        })}
      </>
    )
  }

  const me = members.find((m) => m.user_id === user.id)
  const value: AppState = {
    demo: IS_DEMO, user, bandId: band.id, bandName: band.name, db, engine, members,
    isAdmin: IS_DEMO || (me ? me.role === 'admin' : band.role === 'admin'),
    memberName, switchBand, signOut,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
