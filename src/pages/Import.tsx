import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../state/app'
import { Layout } from '../components/Layout'
import { ChordProView } from '../components/ChordProView'
import { guessImport, readClipboard, toChordPro } from '../lib/importer'
import { appendChart, chordsUsed } from '../lib/chordpro'
import { detectNotation } from '../lib/transpose'
import { clearPendingImport, readPendingImport } from '../lib/pendingImport'
import type { Song } from '../lib/types'

type Resolved = { target: string; setlistId: string | null; via: 'link' | 'pending' | null; note: string | null }

const PENDING_NOTE = {
  expired: 'The song you were finding chords for was a while ago — pick the song below.',
  'other-account': 'Pick the song this chart belongs to.',
  'song-gone': 'The song you were finding chords for is no longer on this device — pick one below.',
} as const

/**
 * Landing screen for shared text (Android share sheet), the "Send to Setlist" bookmarklet
 * and "Paste from clipboard". Shows a converted preview; nothing is saved until the user confirms.
 */
export function Import() {
  const { search } = useLocation()
  const { db, bandId, engine, user } = useApp()
  const nav = useNavigate()
  const params = useMemo(() => new URLSearchParams(search), [search])
  const initial = useMemo(() => guessImport({ title: params.get('title'), text: params.get('text'), url: params.get('url') }), [params])
  const [title, setTitle] = useState(initial.title)
  const [artist, setArtist] = useState(initial.artist)
  const [url, setUrl] = useState(initial.url)
  const [text, setText] = useState(initial.text)
  const [picked, setPicked] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const loaded = useLiveQuery(() => db.songs.where('band_id').equals(bandId).filter((s) => !s.deleted_at).sortBy('title'), [db, bandId])
  const songs = useMemo(() => loaded ?? ([] as Song[]), [loaded])

  // Which song this chart is for: an explicit ?song= from inside the app, else what "Find chords"
  // remembered on this device. If neither can be trusted the user picks; we never guess a song.
  const resolved = useMemo<Resolved>(() => {
    const has = (id: string) => songs.some((s) => s.id === id)
    const from = /^setlist:(.+)$/.exec(params.get('from') ?? '')?.[1] ?? null
    const songParam = params.get('song')
    if (songParam) {
      return has(songParam)
        ? { target: songParam, setlistId: from, via: 'link', note: null }
        : { target: '', setlistId: from, via: null, note: PENDING_NOTE['song-gone'] }
    }
    const pending = readPendingImport(user.id, bandId, has)
    if (pending.ok) return { target: pending.value.songId, setlistId: pending.value.setlistId, via: 'pending', note: null }
    if (pending.reason === 'none') return { target: 'new', setlistId: null, via: null, note: null }
    return { target: '', setlistId: null, via: null, note: PENDING_NOTE[pending.reason] }
  }, [songs, params, user.id, bandId])
  const target = picked ?? (loaded ? resolved.target : '')
  const targetSong = songs.find((s) => s.id === target)
  const chordpro = useMemo(() => toChordPro(text), [text])
  const notation = detectNotation(chordsUsed(chordpro))

  const paste = async () => {
    const clip = await readClipboard()
    if (clip == null) return setMsg('Clipboard not available here — long-press the box below and choose Paste.')
    const g = guessImport({ text: clip })
    setText(g.text)
    if (!title && g.title) setTitle(g.title)
    if (!artist && g.artist) setArtist(g.artist)
    if (!url && g.url) setUrl(g.url)
    setMsg(null)
  }

  const done = (songId: string) => {
    clearPendingImport(user.id, bandId)
    nav(resolved.setlistId ? `/setlists/${resolved.setlistId}?highlight=${songId}` : `/songs/${songId}`, { replace: true })
  }

  const save = async () => {
    if (!chordpro.trim()) return setMsg('Nothing to import yet.')
    if (!target) return setMsg('Choose which song this chart is for.')
    const host = (() => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null } })()
    const link = url && host ? [{ label: `Source: ${host}`, url }] : []
    if (target === 'new') {
      if (!title.trim()) return setMsg('Add a title.')
      const id = await engine.mutate('songs', null, {
        title: title.trim(), artist: artist.trim(), lyrics_chordpro: chordpro, links: link, chord_notation: notation,
      })
      done(id)
    } else {
      const song = songs.find((s) => s.id === target)
      if (!song) return
      // Converts the fragment to the song's notation so existing B/H chords keep their pitch.
      const merged = appendChart(song, chordpro)
      const links = link.length && !song.links.some((l) => l.url === url) ? [...song.links, ...link] : song.links
      await engine.mutate('songs', song.id, {
        lyrics_chordpro: merged.lyrics_chordpro, links,
        ...(merged.chord_notation !== (song.chord_notation ?? 'standard') ? { chord_notation: merged.chord_notation } : {}),
      })
      done(song.id)
    }
  }

  return (
    <Layout title="Import chords">
      <div className="flex flex-col gap-4">
        {targetSong && (
          <div className="card p-3 flex items-center gap-2 border-accent" role="status" aria-label="Import target">
            <span className="flex-1 min-w-0">
              <span className="text-xs text-mute block">Importing into</span>
              <b className="truncate block">{targetSong.title}{targetSong.artist ? ` – ${targetSong.artist}` : ''}</b>
              {resolved.via === 'pending' && target === resolved.target && <span className="text-[11px] text-mute">Remembered from “Find chords” on this device.</span>}
            </span>
            <button className="btn text-xs" onClick={() => document.getElementById('import-target')?.focus()}>Change</button>
          </div>
        )}
        {!target && loaded && (
          <p className="card p-3 text-sm text-warn">
            {resolved.note ?? 'Choose which song this chart is for.'} Opened from a different app or browser? Pick the song below.
          </p>
        )}
        <div className="flex flex-wrap gap-2 items-center">
          <button className="btn-primary" onClick={paste}>Paste from clipboard</button>
          <span className="text-xs text-mute">Copy a chord sheet on any site, then tap here.</span>
        </div>
        {msg && <p className="text-sm text-warn">{msg}</p>}
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2">
            <span className="label">Save to</span>
            <select id="import-target" className="field" value={target} onChange={(e) => setPicked(e.target.value)} aria-label="Save to">
              {!target && <option value="" disabled>Choose a song…</option>}
              <option value="new">New song</option>
              {songs.map((s) => <option key={s.id} value={s.id}>Add to: {s.title}{s.artist ? ` – ${s.artist}` : ''}</option>)}
            </select>
          </label>
          {target === 'new' && (
            <>
              <label><span className="label">Title</span><input className="field" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
              <div>
                <label htmlFor="import-artist" className="label">Artist</label>
                <div className="flex gap-1">
                  <input id="import-artist" className="field" value={artist} onChange={(e) => setArtist(e.target.value)} />
                  <button type="button" className="btn !px-2" title="Swap title and artist" aria-label="Swap title and artist"
                    onClick={() => { setTitle(artist); setArtist(title) }}>⇄</button>
                </div>
              </div>
            </>
          )}
          {url && <p className="col-span-2 text-xs text-mute truncate">Source: {url} (saved as a link)</p>}
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <textarea className="field font-mono text-xs min-h-72" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)}
            aria-label="Imported text" placeholder="Chord sheet text…" />
          <div className="card p-3 overflow-auto max-h-[32rem]">
            {notation === 'h' && <p className="text-xs text-sky-300 mb-2">H notation detected (H = B, B = B♭) — transposing will respect it.</p>}
            <ChordProView src={chordpro} fontSize={15} notation={notation} />
          </div>
        </div>
        <p className="text-xs text-mute">Check the preview: chord sheets are converted by column position. Trim anything that isn't part of the song (ads, comments) in the box on the left.</p>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={save} disabled={!target}>{target === 'new' ? 'Create song' : 'Add to song'}</button>
          <button className="btn" onClick={() => nav(-1)}>Cancel</button>
        </div>
      </div>
    </Layout>
  )
}
