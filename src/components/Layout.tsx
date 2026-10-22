import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Link } from 'react-router-dom'
import { useApp, useSyncStatus } from '../state/app'

export function SyncBadge() {
  const s = useSyncStatus()
  let label: string, tone: string
  if (s.mode === 'demo') { label = 'Demo · local only'; tone = 'text-warn' }
  else if (s.authError) { label = 'Sign in to sync'; tone = 'text-bad' }
  else if (s.conflicts) { label = `${s.conflicts} conflict${s.conflicts > 1 ? 's' : ''}`; tone = 'text-bad' }
  else if (s.failed) { label = `${s.failed} failed`; tone = 'text-bad' }
  else if (!s.online) { label = s.pending ? `Offline · ${s.pending} unsynced` : 'Offline'; tone = 'text-warn' }
  else if (s.syncing) { label = 'Syncing…'; tone = 'text-mute' }
  else if (s.pending) { label = `${s.pending} unsynced`; tone = 'text-warn' }
  else { label = 'Synced'; tone = 'text-ok' }
  return (
    <Link to="/band#sync" className={`chip gap-1 ${tone}`} title={s.lastError ?? undefined}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </Link>
  )
}

export function DemoBanner() {
  const { demo } = useApp()
  if (!demo) return null
  return (
    <div className="bg-warn text-black text-xs font-semibold text-center py-1 px-2 no-print" role="status">
      DEMO — data stays in this browser and is not shared with your band. Configure Supabase to go live.
    </div>
  )
}

function Toasts() {
  const { engine } = useApp()
  const [items, setItems] = useState<{ id: number; text: string }[]>([])
  useEffect(() => {
    const off = engine.onNotice((n) => {
      const id = Date.now() + Math.random()
      setItems((x) => [...x, { id, text: n.message }])
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 5000)
    })
    return () => { off() }
  }, [engine])
  return (
    <div className="fixed bottom-20 inset-x-0 flex flex-col items-center gap-2 pointer-events-none z-50">
      {items.map((t) => <div key={t.id} className="card px-4 py-2 text-sm shadow-lg">{t.text}</div>)}
    </div>
  )
}

const tabs = [
  { to: '/songs', label: 'Songs', icon: '♪' },
  { to: '/setlists', label: 'Setlists', icon: '☰' },
  { to: '/band', label: 'Band', icon: '⚙' },
]

export function Layout({ children, title, actions }: { children: ReactNode; title?: ReactNode; actions?: ReactNode }) {
  const { bandName } = useApp()
  return (
    <div className="min-h-full flex flex-col">
      <DemoBanner />
      <header className="sticky top-0 z-30 bg-bg/95 backdrop-blur border-b border-line no-print" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-mute truncate">{bandName}</div>
            <div className="font-semibold truncate leading-tight">{title}</div>
          </div>
          {actions}
          <SyncBadge />
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-4 pb-24">{children}</main>
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-panel/95 backdrop-blur border-t border-line no-print" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="max-w-5xl mx-auto grid grid-cols-3">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to}
              className={({ isActive }) => `flex flex-col items-center py-2 text-xs ${isActive ? 'text-accent' : 'text-mute'}`}>
              <span className="text-lg leading-none">{t.icon}</span>
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <Toasts />
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card p-6 text-center text-mute text-sm">{children}</div>
}
