import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import { AppProvider } from './state/app'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Gate } from './pages/Gate'
import { Songs } from './pages/Songs'
import { Song } from './pages/Song'
import { SongEdit } from './pages/SongEdit'
import { Setlists } from './pages/Setlists'
import { SetlistEdit } from './pages/SetlistEdit'
import { Stage } from './pages/Stage'
import { Band } from './pages/Band'
import { Print } from './pages/Print'
import { Import } from './pages/Import'

// Android share sheet (manifest share_target) opens <base>import?title=&text=&url= as a real path;
// hand it to the hash router's #/import route.
const base = import.meta.env.BASE_URL
if (location.pathname === `${base}import` || location.pathname === `${base}import/`) {
  location.replace(`${base}#/import${location.search}`)
}

/** Remount on each new share/bookmarklet hit so the form picks up the new text. */
function ImportRoute() {
  const { search } = useLocation()
  return <Import key={search} />
}

registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
    <HashRouter>
      <AppProvider gate={(g) => <Gate g={g} />}>
        <Routes>
          <Route path="/" element={<Navigate to="/setlists" replace />} />
          <Route path="/songs" element={<Songs />} />
          <Route path="/songs/new" element={<SongEdit />} />
          <Route path="/songs/:id" element={<Song />} />
          <Route path="/songs/:id/edit" element={<SongEdit />} />
          <Route path="/setlists" element={<Setlists />} />
          <Route path="/setlists/:id" element={<SetlistEdit />} />
          <Route path="/setlists/:id/print" element={<Print />} />
          <Route path="/stage/:kind/:id" element={<Stage />} />
          <Route path="/band" element={<Band />} />
          <Route path="/import" element={<ImportRoute />} />
          <Route path="*" element={<Navigate to="/setlists" replace />} />
        </Routes>
      </AppProvider>
    </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
)
