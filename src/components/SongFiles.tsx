import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../state/app'
import type { FileKind, SongFile } from '../lib/types'
import { TabViewer, type TabSource } from './TabViewer'

const EXT_KIND: [RegExp, FileKind][] = [
  [/\.(gp|gp3|gp4|gp5|gpx|gp7)$/i, 'gp'],
  [/\.(musicxml|xml|mxl)$/i, 'musicxml'],
  [/\.(atex|alphatex|tex)$/i, 'tex'],
  [/\.pdf$/i, 'pdf'],
  [/\.(mp3|m4a|wav|ogg|aac|flac)$/i, 'audio'],
]
export const kindOf = (name: string): FileKind => EXT_KIND.find(([re]) => re.test(name))?.[1] ?? 'other'
const MAX_BYTES = 20 * 1024 * 1024

const NEW_RIFF = `\\title "New riff"
\\tempo 100
.
:8 0.6 3.6 5.6 0.6 3.6 6.6 5.6 r |`

export const FILE_ACCEPT = '.gp,.gp3,.gp4,.gp5,.gpx,.gp7,.musicxml,.xml,.mxl,.atex,.alphatex,.pdf,.mp3,.m4a,.wav,.ogg'

/** Attach a picked file to a song. Returns the new file id, or null if it was refused. */
export async function uploadSongFile(engine: ReturnType<typeof useApp>['engine'], bandId: string, songId: string, f: File): Promise<string | null> {
  if (f.size > MAX_BYTES) { alert('File is larger than 20 MB.'); return null }
  const id = crypto.randomUUID()
  const kind = kindOf(f.name)
  if (kind === 'tex') {
    await engine.mutate('song_files', id, { song_id: songId, kind, name: f.name, tex: await f.text(), part: '' })
  } else {
    const path = `${bandId}/${id}/${f.name.replace(/[^\w.\- ]+/g, '_')}`
    await engine.putBlob(path, f)
    await engine.mutate('song_files', id, { song_id: songId, kind, name: f.name, storage_path: path, size_bytes: f.size, part: '' })
  }
  return id
}

/** Local blob for a stored file; fetched from the server (and cached) when missing. */
export function useFileBlob(file: SongFile | undefined) {
  const { db, engine } = useApp()
  const path = file?.storage_path ?? null
  const cached = useLiveQuery(() => (path ? db.blobs.get(path) : undefined), [db, path])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!path || cached || !engine.server) return
    let cancelled = false
    engine.server.downloadBlob(path)
      .then((blob) => db.blobs.put({ key: path, blob }))
      .catch((e) => { if (!cancelled) setError(navigator.onLine ? String(e.message ?? e) : 'Offline — not downloaded yet') })
    return () => { cancelled = true }
  }, [path, cached, db, engine])
  return { blob: cached?.blob, error: !cached && !engine.server && path ? 'File missing on this device' : error }
}

export function SongFiles({ songId }: { songId: string }) {
  const { db, engine, bandId } = useApp()
  const files = useLiveQuery(() => db.song_files.where('song_id').equals(songId).filter((f) => !f.deleted_at).toArray(), [db, songId], [] as SongFile[])
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open && files.length) setOpen(files[0].id)
  }, [files, open])

  const upload = async (f: File) => {
    const id = await uploadSongFile(engine, bandId, songId, f)
    if (id) setOpen(id)
  }

  const newRiff = async () => {
    const id = await engine.mutate('song_files', null, { song_id: songId, kind: 'tex', name: 'Riff', part: 'Guitar', tex: NEW_RIFF })
    setOpen(id)
    setEditing(id)
  }

  return (
    <section className="card p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold flex-1">Tabs &amp; files</h2>
        <button className="btn text-xs" onClick={newRiff}>+ Riff / solo (alphaTex)</button>
        <button className="btn text-xs" onClick={() => input.current?.click()}>Import Guitar Pro / MusicXML / PDF</button>
        <input ref={input} type="file" hidden accept={FILE_ACCEPT}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
      </div>
      {!files.length && <p className="text-sm text-mute">No tabs yet. Import a Guitar Pro file you have, or write a riff/solo in alphaTex.</p>}
      <div className="flex flex-wrap gap-2">
        {files.map((f) => (
          <button key={f.id} className={open === f.id ? 'btn-primary text-xs' : 'btn text-xs'} onClick={() => { setOpen(f.id); setEditing(null) }}>
            {f.name || 'Untitled'}{f.part ? ` · ${f.part}` : ''} <span className="opacity-60 uppercase">{f.kind}</span>
          </button>
        ))}
      </div>
      {files.filter((f) => f.id === open).map((f) =>
        editing === f.id ? <TabEditor key={f.id} file={f} onDone={() => setEditing(null)} />
          : <FilePanel key={f.id} file={f} onEdit={() => setEditing(f.id)} />,
      )}
    </section>
  )
}

function FilePanel({ file, onEdit }: { file: SongFile; onEdit: () => void }) {
  const { engine } = useApp()
  const { blob, error } = useFileBlob(file)
  const [data, setData] = useState<ArrayBuffer | null>(null)
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  useEffect(() => {
    if (blob && (file.kind === 'gp' || file.kind === 'musicxml')) void blob.arrayBuffer().then(setData)
  }, [blob, file.kind])
  const source = useMemo<TabSource | null>(
    () => (file.kind === 'tex' ? { kind: 'tex', tex: file.tex } : data ? { kind: 'bytes', data } : null),
    [file.kind, file.tex, data],
  )

  const rename = () => {
    const name = prompt('Name', file.name)
    if (name != null) void engine.mutate('song_files', file.id, { name })
  }
  const setPart = () => {
    const part = prompt('Part / instrument (e.g. Lead guitar, Bass)', file.part)
    if (part != null) void engine.mutate('song_files', file.id, { part })
  }
  const remove = () => { if (confirm(`Remove “${file.name}”?`)) void engine.remove('song_files', file.id) }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2 text-xs">
        {file.kind === 'tex' && <button className="btn text-xs" onClick={onEdit}>Edit</button>}
        <button className="btn-ghost text-xs" onClick={rename}>Rename</button>
        <button className="btn-ghost text-xs" onClick={setPart}>Part</button>
        {url && <a className="btn-ghost text-xs" href={url} download={file.name}>Download</a>}
        <button className="btn-ghost text-xs text-bad" onClick={remove}>Remove</button>
      </div>
      {error && !blob && <p className="text-warn text-sm">{error}</p>}
      {source && <TabViewer source={source} />}
      {file.kind === 'pdf' && url && <object data={url} type="application/pdf" className="w-full h-[70vh] rounded-lg bg-white" aria-label={file.name} />}
      {file.kind === 'audio' && url && <audio controls src={url} className="w-full" />}
      {file.kind === 'other' && url && <p className="text-sm text-mute">Preview not available — use Download.</p>}
    </div>
  )
}

/** Split view: alphaTex source on the left, live rendering on the right. */
export function TabEditor({ file, onDone }: { file: SongFile; onDone: () => void }) {
  const { engine } = useApp()
  const [tex, setTex] = useState(file.tex)
  const [preview, setPreview] = useState<TabSource>({ kind: 'tex', tex: file.tex })
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    const t = setTimeout(() => setPreview({ kind: 'tex', tex }), 400)
    return () => clearTimeout(t)
  }, [tex])
  const save = async () => {
    if (tex !== file.tex) await engine.mutate('song_files', file.id, { tex })
    onDone()
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="grid md:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <textarea className="field font-mono text-xs min-h-72 flex-1" spellCheck={false} value={tex} onChange={(e) => setTex(e.target.value)} aria-label="alphaTex source" />
          <p className="text-[11px] text-mute">
            Syntax: <code>fret.string</code> notes, <code>:8</code> sets duration, <code>|</code> bar line, <code>r</code> rest, <code>(0.6 2.5)</code> chord.
            {' '}<a className="text-accent" href="https://www.alphatab.net/docs/alphatex/introduction" target="_blank" rel="noreferrer">alphaTex guide</a>
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <TabViewer source={preview} playerless scale={0.8} onError={setErr} />
          {err && <p className="text-bad text-xs">{err}</p>}
        </div>
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" onClick={save}>Save</button>
        <button className="btn" onClick={onDone}>Cancel</button>
      </div>
    </div>
  )
}
