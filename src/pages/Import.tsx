import { useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp, useSyncStatus } from '../state/app'
import { Layout } from '../components/Layout'
import { ChordProView } from '../components/ChordProView'
import { decodeText, isSameSong, prepareSong, readClipboard, readSongFile } from '../lib/importer'
import { appendChart, replaceChart } from '../lib/chordpro'
import type { Notation } from '../lib/transpose'
import type { Fields, Song } from '../lib/types'

type Action = 'skip' | 'new' | 'replace' | 'append'

/** Fields for a brand-new song from prepared text. */
function newSongFields(p: { title: string; artist: string; key: string; bpm: number | null; chordpro: string; notation: Notation }): Fields<'songs'> {
  return {
    title: p.title.trim(), artist: p.artist.trim(), lyrics_chordpro: p.chordpro, chord_notation: p.notation,
    ...(p.key.trim() ? { key: p.key.trim() } : {}), ...(p.bpm ? { bpm: p.bpm } : {}),
  }
}

/** Replace or append the chart of an existing song. */
function chartFields(song: Song, action: 'replace' | 'append', chordpro: string): Fields<'songs'> {
  if (action === 'replace') {
    const next = replaceChart(song, chordpro)
    return { lyrics_chordpro: next.lyrics_chordpro, chord_notation: next.chord_notation, ...(next.key !== song.key ? { key: next.key } : {}) }
  }
  // Converts the fragment to the song's notation so existing B/H chords keep their pitch.
  const merged = appendChart(song, chordpro)
  return {
    lyrics_chordpro: merged.lyrics_chordpro,
    ...(merged.chord_notation !== (song.chord_notation ?? 'standard') ? { chord_notation: merged.chord_notation } : {}),
  }
}

/** Add songs from your own text: paste chords straight in, or upload Notepad .txt files (one song per file). */
export function Import() {
  const { db, bandId } = useApp()
  // "Paste chart" from a song or setlist row: /import?song=<id>&from=setlist:<id>
  const params = new URLSearchParams(useLocation().search)
  const songParam = params.get('song')
  const setlistId = /^setlist:(.+)$/.exec(params.get('from') ?? '')?.[1] ?? null
  const [mode, setMode] = useState<'paste' | 'files'>('paste')
  const songs = useLiveQuery(() => db.songs.where('band_id').equals(bandId).filter((s) => !s.deleted_at).sortBy('title'), [db, bandId], [] as Song[])
  return (
    <Layout title="Add songs">
      <div className="flex flex-col gap-4">
        <div className="flex gap-2" role="tablist">
          <button role="tab" aria-selected={mode === 'paste'} className={mode === 'paste' ? 'btn-primary' : 'btn'} onClick={() => setMode('paste')}>Paste chords</button>
          <button role="tab" aria-selected={mode === 'files'} className={mode === 'files' ? 'btn-primary' : 'btn'} onClick={() => setMode('files')}>Upload .txt files</button>
        </div>
        {mode === 'paste' ? <PasteSong songs={songs} songParam={songParam} setlistId={setlistId} /> : <TxtFiles songs={songs} />}
      </div>
    </Layout>
  )
}

function PasteSong({ songs, songParam, setlistId }: { songs: Song[]; songParam: string | null; setlistId: string | null }) {
  const { engine } = useApp()
  const nav = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | undefined>()
  // null = not edited yet: show what was found in the text (header lines or an "Artist – Song" first line).
  const [title, setTitle] = useState<string | null>(null)
  const [artist, setArtist] = useState<string | null>(null)
  const [key, setKey] = useState<string | null>(null)
  const [bpm, setBpm] = useState<string | null>(null)
  const [target, setTarget] = useState(songParam ?? 'new')
  const [action, setAction] = useState<'replace' | 'append'>('replace')
  const [msg, setMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const p = useMemo(() => prepareSong({ name: fileName, text }), [fileName, text])
  const targetSong = songs.find((s) => s.id === target)
  const t = title ?? p.title
  const a = artist ?? p.artist
  const k = key ?? p.key
  const b = bpm ?? (p.bpm ? String(p.bpm) : '')
  const dup = target === 'new' ? songs.find((s) => isSameSong(s, { title: t, artist: a })) : undefined

  const paste = async () => {
    const clip = await readClipboard()
    if (clip == null) return setMsg('Clipboard not available here — tap the box below and paste (long-press → Paste, or Ctrl+V).')
    setText(clip)
    setFileName(undefined)
    setMsg(null)
  }

  const loadFile = async (file: File) => {
    try {
      setText(decodeText(await file.arrayBuffer()))
      setFileName(file.name)
      setMsg(null)
    } catch (e) {
      setMsg(`Can't read ${file.name}: ${e instanceof Error ? e.message : e}`)
    }
  }

  const done = (songId: string) => nav(setlistId ? `/setlists/${setlistId}?highlight=${songId}` : `/songs/${songId}`, { replace: true })

  const save = async () => {
    if (!p.chordpro.trim()) return setMsg('Paste or type the chords and lyrics first.')
    setSaving(true)
    try {
      if (target === 'new') {
        if (!t.trim()) return setMsg('Add a title.')
        const id = await engine.mutate('songs', null, newSongFields({ title: t, artist: a, key: k, bpm: parseInt(b) || null, chordpro: p.chordpro, notation: p.notation }))
        done(id)
      } else {
        const song = targetSong
        if (!song) return setMsg('That song is no longer on this device — pick one under “Save to”.')
        if (action === 'replace' && song.lyrics_chordpro.trim() && !confirm(`Replace the chords of “${song.title}”?`)) return
        await engine.mutate('songs', song.id, chartFields(song, action, p.chordpro))
        done(song.id)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {targetSong && (
        <div className="card p-3 border-accent" role="status" aria-label="Import target">
          <span className="text-xs text-mute block">Importing into</span>
          <b className="truncate block">{targetSong.title}{targetSong.artist ? ` – ${targetSong.artist}` : ''}</b>
        </div>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        <button className="btn" onClick={paste}>Paste from clipboard</button>
        <button className="btn" onClick={() => fileInput.current?.click()}>Load .txt file</button>
        <input ref={fileInput} type="file" accept=".txt,text/plain" hidden aria-label="Load .txt file"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); e.target.value = '' }} />
        <span className="text-xs text-mute">Or type / paste straight into the box. Chords above the lyrics are converted automatically.</span>
      </div>
      {msg && <p className="text-sm text-warn">{msg}</p>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="col-span-2 md:col-span-4">
          <span className="label">Save to</span>
          <select className="field" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Save to">
            <option value="new">New song</option>
            {songs.map((s) => <option key={s.id} value={s.id}>Existing: {s.title}{s.artist ? ` – ${s.artist}` : ''}</option>)}
          </select>
        </label>
        {target === 'new' ? (
          <>
            <label className="col-span-2"><span className="label">Title</span><input className="field" value={t} onChange={(e) => setTitle(e.target.value)} /></label>
            <label className="col-span-2"><span className="label">Artist</span><input className="field" value={a} onChange={(e) => setArtist(e.target.value)} /></label>
            <label><span className="label">Key</span><input className="field" value={k} onChange={(e) => setKey(e.target.value)} placeholder="Am" /></label>
            <label><span className="label">BPM</span><input className="field" inputMode="numeric" value={b} onChange={(e) => setBpm(e.target.value)} /></label>
          </>
        ) : (
          <label className="col-span-2">
            <span className="label">Chords</span>
            <select className="field" value={action} onChange={(e) => setAction(e.target.value as 'replace' | 'append')} aria-label="Replace or append">
              <option value="replace">Replace the song's chords</option>
              <option value="append">Add to the end</option>
            </select>
          </label>
        )}
      </div>
      {dup && <p className="text-sm text-warn">“{dup.title}”{dup.artist ? ` – ${dup.artist}` : ''} is already in your songs. Pick it under “Save to” to update it, or save anyway as a second copy.</p>}
      <div className="grid md:grid-cols-2 gap-3">
        <textarea className="field font-mono text-xs min-h-72" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)}
          aria-label="Chords and lyrics" placeholder={'Prāta Vētra - Tu jau esi\n\nAm        G\nTeksts ar akordiem virs tā…'} />
        <div className="card p-3 overflow-auto max-h-[32rem]">
          {p.notation === 'h' && <p className="text-xs text-sky-300 mb-2">H notation detected (H = B, B = B♭) — transposing will respect it.</p>}
          {p.chordpro ? <ChordProView src={p.chordpro} fontSize={15} notation={p.notation} /> : <p className="text-xs text-mute">Preview appears here.</p>}
        </div>
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" onClick={save} disabled={saving}>{target === 'new' ? 'Save song' : 'Update song'}</button>
        <button className="btn" onClick={() => history.back()}>Cancel</button>
      </div>
    </div>
  )
}

interface Row {
  id: number
  file: string
  title: string
  artist: string
  key: string
  bpm: string
  chordpro: string
  notation: Notation
  error?: string
  action: Action
  status: 'ready' | 'saving' | 'saved' | 'failed'
  saveError?: string
  songId?: string
  open: boolean
}

let nextRow = 1

function TxtFiles({ songs }: { songs: Song[] }) {
  const { engine, db } = useApp()
  const sync = useSyncStatus()
  const input = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const existingFor = (r: Row) => songs.find((s) => isSameSong(s, r))
  const earlierDup = (r: Row, list: Row[]) => list.find((o) => o.id !== r.id && !o.error && o.status !== 'saved' && list.indexOf(o) < list.indexOf(r) && isSameSong(o, r))
  const update = (id: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const pick = async (files: FileList) => {
    setLoading(true)
    const added: Row[] = []
    for (const f of Array.from(files)) {
      const base: Row = { id: nextRow++, file: f.name, title: '', artist: '', key: '', bpm: '', chordpro: '', notation: 'standard', action: 'skip', status: 'ready', open: false }
      try {
        const p = await readSongFile(f)
        added.push({ ...base, title: p.title, artist: p.artist, key: p.key, bpm: p.bpm ? String(p.bpm) : '', chordpro: p.chordpro, notation: p.notation })
      } catch (e) {
        added.push({ ...base, error: e instanceof Error ? e.message : String(e) })
      }
    }
    setRows((rs) => {
      const all = [...rs, ...added]
      // Duplicates (already in the library, or twice in this batch) start unticked; the user can override.
      return all.map((r) => (added.includes(r) && !r.error ? { ...r, action: existingFor(r) || earlierDup(r, all) ? 'skip' : 'new' } : r))
    })
    setLoading(false)
  }

  const todo = rows.filter((r) => !r.error && r.action !== 'skip' && r.status !== 'saved')

  const saveAll = async () => {
    const replacing = todo.filter((r) => r.action === 'replace').length
    if (replacing && !confirm(`Replace the chords of ${replacing} existing song${replacing > 1 ? 's' : ''}?`)) return
    setSaving(true)
    setProgress({ done: 0, total: todo.length })
    let done = 0
    for (const r of todo) {
      update(r.id, { status: 'saving', saveError: undefined })
      try {
        if (!r.title.trim()) throw new Error('Title is missing')
        let songId: string
        const match = existingFor(r)
        // Re-read the song: an earlier file in this batch may already have changed its chart.
        const existing = match && (await db.songs.get(match.id))
        if ((r.action === 'replace' || r.action === 'append') && existing) {
          songId = await engine.mutate('songs', existing.id, chartFields(existing, r.action, r.chordpro))
        } else {
          songId = await engine.mutate('songs', null, newSongFields({ ...r, bpm: parseInt(r.bpm) || null }))
        }
        update(r.id, { status: 'saved', songId })
      } catch (e) {
        update(r.id, { status: 'failed', saveError: e instanceof Error ? e.message : String(e) })
      }
      setProgress({ done: ++done, total: todo.length })
    }
    setSaving(false)
  }

  const saved = rows.filter((r) => r.status === 'saved').length
  const failed = rows.filter((r) => r.status === 'failed').length
  const syncText = sync.mode === 'demo' ? 'demo mode: this browser only'
    : sync.failed > 0 ? `${sync.failed} change${sync.failed === 1 ? '' : 's'} rejected by the server — see Band → Sync`
    : sync.pending > 0 || sync.syncing ? `waiting to sync with the band (${sync.pending} change${sync.pending === 1 ? '' : 's'}${sync.online ? '' : ', offline'})`
    : 'synced with the band ✓'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 items-center">
        <button className="btn-primary" onClick={() => input.current?.click()} disabled={loading || saving}>Choose .txt files</button>
        <input ref={input} type="file" accept=".txt,text/plain" multiple hidden aria-label="Choose .txt files"
          onChange={(e) => { if (e.target.files?.length) void pick(e.target.files); e.target.value = '' }} />
        <span className="text-xs text-mute">One song per file. Name files “Artist - Title.txt”. Optional first lines: <code>Key: Am</code>, <code>BPM: 120</code>.</span>
      </div>
      {loading && <p className="text-sm text-mute">Reading files…</p>}
      {rows.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Files">
          {rows.map((r) => {
            const existing = r.error || r.status === 'saved' ? undefined : existingFor(r)
            const dup = r.error || r.status === 'saved' || existing ? undefined : earlierDup(r, rows)
            return (
              <li key={r.id} className="card p-3 flex flex-col gap-2" data-file={r.file}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {!r.error && r.status !== 'saved' && !existing && (
                    <input type="checkbox" aria-label={`Import ${r.file}`} checked={r.action === 'new'} onChange={(e) => update(r.id, { action: e.target.checked ? 'new' : 'skip' })} />
                  )}
                  <span className="font-mono text-xs text-mute truncate flex-1">{r.file}</span>
                  {r.error && <span className="text-xs text-bad">Can't read: {r.error}</span>}
                  {r.status === 'saving' && <span className="text-xs text-mute">Saving…</span>}
                  {r.status === 'saved' && <Link className="text-xs text-accent" to={`/songs/${r.songId}`}>Saved ✓</Link>}
                  {r.status === 'failed' && <span className="text-xs text-bad">Failed: {r.saveError}</span>}
                  {!r.error && <button className="btn-ghost text-xs" onClick={() => update(r.id, { open: !r.open })}>{r.open ? 'Hide' : 'Preview'}</button>}
                </div>
                {!r.error && r.status !== 'saved' && (
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                    <input className="field col-span-2" aria-label="Title" placeholder="Title" value={r.title} onChange={(e) => update(r.id, { title: e.target.value })} />
                    <input className="field col-span-2" aria-label="Artist" placeholder="Artist" value={r.artist} onChange={(e) => update(r.id, { artist: e.target.value })} />
                    <input className="field" aria-label="Key" placeholder="Key" value={r.key} onChange={(e) => update(r.id, { key: e.target.value })} />
                    <input className="field" aria-label="BPM" placeholder="BPM" inputMode="numeric" value={r.bpm} onChange={(e) => update(r.id, { bpm: e.target.value })} />
                  </div>
                )}
                {existing && (
                  <label className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-warn">Already in your songs: “{existing.title}”{existing.artist ? ` – ${existing.artist}` : ''}.</span>
                    <select className="field !w-auto" aria-label={`What to do with ${r.file}`} value={r.action} onChange={(e) => update(r.id, { action: e.target.value as Action })}>
                      <option value="skip">Skip</option>
                      <option value="replace">Replace its chords</option>
                      <option value="append">Add to its chords</option>
                      <option value="new">Create a second copy</option>
                    </select>
                  </label>
                )}
                {dup && <span className="text-xs text-warn">Same song as “{dup.file}” above — tick to import it anyway.</span>}
                {!r.error && !r.artist.trim() && r.status !== 'saved' && <span className="text-xs text-mute">No artist.</span>}
                {r.open && !r.error && (
                  <div className="rounded-lg bg-panel2 p-2 overflow-auto max-h-80">
                    {r.notation === 'h' && <p className="text-xs text-sky-300 mb-1">H notation (H = B, B = B♭)</p>}
                    <ChordProView src={r.chordpro} fontSize={14} notation={r.notation} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center sticky bottom-20 bg-bg/90 py-2">
          <button className="btn-primary" onClick={saveAll} disabled={saving || !todo.length}>
            {failed && !todo.some((r) => r.status !== 'failed') ? `Retry ${todo.length} failed` : `Import ${todo.length} song${todo.length === 1 ? '' : 's'}`}
          </button>
          <button className="btn" onClick={() => setRows([])} disabled={saving}>Clear list</button>
          {progress && saving && <span className="text-sm text-mute">Saving {progress.done}/{progress.total}…</span>}
          {!saving && saved > 0 && (
            <span className="text-sm" role="status">{saved} saved on this device{failed ? ` · ${failed} failed` : ''} · {syncText}. <Link className="text-accent" to="/songs">Go to songs</Link></span>
          )}
        </div>
      )}
    </div>
  )
}
