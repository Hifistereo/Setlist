import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../state/app'
import type { Conflict } from '../lib/types'

const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

/** Lists conflicts (optionally for one record) and lets the user pick a version. */
export function Conflicts({ recordId }: { recordId?: string }) {
  const { db, engine } = useApp()
  const list = useLiveQuery(
    () => (recordId ? db.conflicts.where('record_id').equals(recordId).toArray() : db.conflicts.toArray()),
    [db, recordId], [] as Conflict[],
  )
  if (!list.length) return null
  return (
    <div className="card border-bad/60 p-4 flex flex-col gap-3">
      <h3 className="font-semibold text-bad">Conflict — choose version</h3>
      <p className="text-xs text-mute">Someone changed the same field while you were editing. Nothing was lost — pick which version to keep.</p>
      {list.map((c) => (
        <div key={c.id} className="flex flex-col gap-2 border-t border-line pt-3">
          <div className="text-xs text-mute">{c.table.replace('_', ' ')} · <b className="text-ink">{c.field}</b></div>
          <div className="grid md:grid-cols-2 gap-2">
            <div className="rounded-lg bg-panel2 p-2">
              <div className="text-[11px] text-mute mb-1">Current (from band)</div>
              <pre className="whitespace-pre-wrap text-xs max-h-48 overflow-auto">{show(c.server_value)}</pre>
              <button className="btn mt-2 text-xs" onClick={() => engine.resolveConflict(c.id!, 'server')}>Keep this</button>
            </div>
            <div className="rounded-lg bg-panel2 p-2">
              <div className="text-[11px] text-mute mb-1">Yours</div>
              <pre className="whitespace-pre-wrap text-xs max-h-48 overflow-auto">{show(c.client_value)}</pre>
              <button className="btn-primary mt-2 text-xs" onClick={() => engine.resolveConflict(c.id!, 'mine')}>Use mine</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
