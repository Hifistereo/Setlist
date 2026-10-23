import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../state/app'
import { Layout } from '../components/Layout'
import { ChordProView } from '../components/ChordProView'
import { guessImport, readClipboard, toChordPro } from '../lib/importer'
import { chordsUsed } from '../lib/chordpro'
import { detectNotation } from '../lib/transpose'
import type { Song } from '../lib/types'

/**
 * Landing screen for shared text (Android share sheet), the "Send to Setlist" bookmarklet
 * and "Paste from clipboard". Shows a converted preview; nothing is saved until the user confirms.
 */
export function Import() {
  const { search } = useLocation()
  const { db, bandId, engine } = useApp()
  const nav = useNavigate()
  const initial = useMemo(() => {
    const p = new URLSearchParams(search)
    return guessImport({ title: p.get('title'), text: p.get('text'), url: p.get('url') })
  }, [search])
  const [title, setTitle] = useState(initial.title)
  const [artist, setArtist] = useState(initial.artist)
  const [url, setUrl] = useState(initial.url)
  const [text, setText] = useState(initial.text)
  const [target, setTarget] = useState('new')
  const [msg, setMsg] = useState<string | null>(null)
  const songs = useLiveQuery(() => db.songs.where('band_id').equals(bandId).filter((s) => !s.deleted_at).sortBy('title'), [db, bandId], [] as Song[])
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

  const save = async () => {
    if (!chordpro.trim()) return setMsg('Nothing to import yet.')
    const host = (() => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null } })()
    const link = url && host ? [{ label: `Source: ${host}`, url }] : []
    if (target === 'new') {
      if (!title.trim()) return setMsg('Add a title.')
      const id = await engine.mutate('songs', null, {
        title: title.trim(), artist: artist.trim(), lyrics_chordpro: chordpro, links: link, chord_notation: notation,
      })
      nav(`/songs/${id}`, { replace: true })
    } else {
      const song = songs.find((s) => s.id === target)
      if (!song) return
      const lyrics = song.lyrics_chordpro.trim() ? `${song.lyrics_chordpro.trimEnd()}\n\n${chordpro}` : chordpro
      const links = link.length && !song.links.some((l) => l.url === url) ? [...song.links, ...link] : song.links
      await engine.mutate('songs', song.id, {
        lyrics_chordpro: lyrics, links,
        ...(notation === 'h' && song.chord_notation !== 'h' ? { chord_notation: 'h' as const } : {}),
      })
      nav(`/songs/${song.id}`, { replace: true })
    }
  }

  return (
    <Layout title="Import chords">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2 items-center">
          <button className="btn-primary" onClick={paste}>Paste from clipboard</button>
          <span className="text-xs text-mute">Copy a chord sheet on any site, then tap here.</span>
        </div>
        {msg && <p className="text-sm text-warn">{msg}</p>}
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2">
            <span className="label">Save to</span>
            <select className="field" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Save to">
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
          <button className="btn-primary" onClick={save}>{target === 'new' ? 'Create song' : 'Add to song'}</button>
          <button className="btn" onClick={() => nav(-1)}>Cancel</button>
        </div>
      </div>
    </Layout>
  )
}
