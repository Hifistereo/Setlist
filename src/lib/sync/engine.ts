import type { SetlistDB } from '../db'
import { emptyRow, type Fields, type OutboxEntry, type RowByTable, type TableName } from '../types'
import { SyncError, type SyncServer } from './server'

export interface SyncStatus {
  mode: 'demo' | 'cloud'
  online: boolean
  syncing: boolean
  pending: number
  failed: number
  conflicts: number
  authError: boolean
  lastError: string | null
  lastSyncAt: number | null
}

export interface SyncNotice {
  kind: 'reordered'
  message: string
}

const PAGE = 500
const uuid = () => crypto.randomUUID()
const cursorKey = (band: string) => `cursor:${band}`

type Listener = (s: SyncStatus) => void

export class SyncEngine {
  readonly db: SetlistDB
  readonly server: SyncServer | null
  readonly userId: string
  readonly bandId: string
  private status: SyncStatus
  private listeners = new Set<Listener>()
  private noticeListeners = new Set<(n: SyncNotice) => void>()
  private running: Promise<void> | null = null
  private again = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryDelay = 2000
  private cleanups: (() => void)[] = []
  /** Background syncing (timers, events, realtime) only runs after start(). */
  private started = false
  memberName: (userId: string) => string = () => 'a bandmate'

  constructor(db: SetlistDB, server: SyncServer | null, userId: string, bandId: string) {
    this.db = db
    this.server = server
    this.userId = userId
    this.bandId = bandId
    this.status = {
      mode: server ? 'cloud' : 'demo',
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
      syncing: false, pending: 0, failed: 0, conflicts: 0,
      authError: false, lastError: null, lastSyncAt: null,
    }
  }

  // ───────────── status ─────────────

  getStatus() {
    return this.status
  }

  onStatus(l: Listener) {
    this.listeners.add(l)
    l(this.status)
    return () => this.listeners.delete(l)
  }

  onNotice(l: (n: SyncNotice) => void) {
    this.noticeListeners.add(l)
    return () => this.noticeListeners.delete(l)
  }

  private setStatus(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch }
    this.listeners.forEach((l) => l(this.status))
  }

  async refreshCounts() {
    const all = await this.db.outbox.toArray()
    this.setStatus({
      pending: all.filter((e) => !e.error).length,
      failed: all.filter((e) => e.error).length,
      conflicts: await this.db.conflicts.where('band_id').equals(this.bandId).count(),
    })
  }

  // ───────────── local writes ─────────────

  /** Apply a change locally (instantly) and queue it for the server. Returns the record id. */
  async mutate<T extends TableName>(table: T, id: string | null, fields: Fields<T>): Promise<string> {
    const recordId = id ?? uuid()
    const f: Record<string, unknown> = { ...fields }
    if ('deleted_at' in f && f.deleted_at) f.deleted_at = new Date().toISOString()
    const tbl = this.db.table(table)
    await this.db.transaction('rw', tbl, this.db.outbox, async () => {
      const existing = (await tbl.get(recordId)) as RowByTable[T] | undefined
      const row = existing ?? emptyRow(table, recordId, this.bandId)
      const local = { ...row, ...f } as Record<string, unknown>
      if (table === 'song_notes') local.user_id = this.userId
      await tbl.put(local)
      if (!this.server) return
      const base: Record<string, number> = {}
      for (const k of Object.keys(f)) base[k] = row.field_versions?.[k] ?? 0
      // Coalesce with a queued (not yet sent) entry for the same record.
      const queued = (await this.db.outbox.where('record_id').equals(recordId).toArray())
        .filter((e) => !e.in_flight && !e.error)
        .pop()
      if (queued) {
        await this.db.outbox.update(queued.seq!, {
          fields: { ...queued.fields, ...f },
          base: { ...base, ...queued.base },
        })
      } else {
        await this.db.outbox.add({
          mutation_id: uuid(), table, band_id: this.bandId, record_id: recordId,
          fields: f, base, created_at: Date.now(), attempts: 0,
        })
      }
    })
    await this.refreshCounts()
    this.schedule()
    return recordId
  }

  async remove(table: TableName, id: string) {
    await this.mutate(table, id, { deleted_at: new Date().toISOString() } as Fields<typeof table>)
  }

  async restore(table: TableName, id: string) {
    await this.mutate(table, id, { deleted_at: null } as Fields<typeof table>)
  }

  /** Store a file blob locally; it is uploaded before the metadata row is sent. */
  async putBlob(path: string, blob: Blob) {
    await this.db.blobs.put({ key: path, blob, pending_upload: !!this.server })
    this.schedule()
  }

  // ───────────── conflicts & failures ─────────────

  async resolveConflict(conflictId: number, choice: 'server' | 'mine') {
    const c = await this.db.conflicts.get(conflictId)
    // Only the engine of the conflict's own band may resolve it (mutate() queues with this.bandId).
    if (!c || c.band_id !== this.bandId) return
    await this.db.conflicts.delete(conflictId)
    if (choice === 'mine') {
      await this.mutate(c.table, c.record_id, { [c.field]: c.client_value } as Fields<typeof c.table>)
    }
    await this.refreshCounts()
  }

  async retryFailed() {
    await this.db.outbox.toCollection().modify((e) => { delete e.error })
    await this.refreshCounts()
    this.schedule()
  }

  /** Only on explicit user request. */
  async discardFailed(seq: number) {
    const entry = await this.db.outbox.get(seq)
    if (!entry) return
    // Put back the authoritative row so the discarded optimistic edit stops showing.
    // Fetch first: if that fails (offline) the entry is kept and the caller sees the error.
    const serverRow = this.server ? await this.server.fetchRow(entry.table, entry.record_id) : null
    const tbl = this.db.table(entry.table)
    await this.db.transaction('rw', tbl, this.db.outbox, async () => {
      await this.db.outbox.delete(seq)
      const rest = await this.db.outbox.where('record_id').equals(entry.record_id).toArray()
      if (serverRow) await tbl.put({ ...serverRow, ...this.overlay(rest) })
      else if (!rest.length) await tbl.delete(entry.record_id)
    })
    await this.refreshCounts()
  }

  // ───────────── sync loop ─────────────

  start() {
    if (!this.server) return
    this.started = true
    const kick = () => this.schedule()
    const online = () => { this.setStatus({ online: true }); kick() }
    const offline = () => this.setStatus({ online: false })
    const visible = () => { if (document.visibilityState === 'visible') kick() }
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    window.addEventListener('focus', kick)
    document.addEventListener('visibilitychange', visible)
    const interval = setInterval(kick, 60_000)
    this.cleanups.push(() => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
      window.removeEventListener('focus', kick)
      document.removeEventListener('visibilitychange', visible)
      clearInterval(interval)
    })
    if (this.server.subscribe) this.cleanups.push(this.server.subscribe(this.bandId, kick))
    void this.recover().then(kick)
  }

  stop() {
    this.started = false
    this.cleanups.forEach((c) => c())
    this.cleanups = []
    if (this.retryTimer) clearTimeout(this.retryTimer)
  }

  /** After a crash/restart, entries marked in-flight are simply resent (mutation ids make that safe). */
  async recover() {
    await this.db.outbox.toCollection().modify((e) => { delete e.in_flight })
    await this.refreshCounts()
  }

  schedule() {
    if (!this.server || !this.started) return
    if (this.running) { this.again = true; return }
    this.running = this.syncNow().finally(() => {
      this.running = null
      if (this.again) { this.again = false; this.schedule() }
    })
  }

  /** Push the outbox, then pull the change feed. Safe to call any time. */
  async syncNow(): Promise<void> {
    if (!this.server) return
    this.setStatus({ syncing: true })
    try {
      await this.uploadBlobs()
      await this.flush()
      await this.pull()
      await this.refreshMembers()
      this.retryDelay = 2000
      this.setStatus({ online: true, authError: false, lastError: null, lastSyncAt: Date.now() })
    } catch (e) {
      const err = e instanceof SyncError ? e : new SyncError('network', String(e))
      if (err.kind === 'auth') this.setStatus({ authError: true, lastError: err.message })
      else {
        this.setStatus({ online: err.kind === 'network' ? false : this.status.online, lastError: err.message })
        if (this.started) {
          if (this.retryTimer) clearTimeout(this.retryTimer)
          this.retryTimer = setTimeout(() => this.schedule(), this.retryDelay)
          this.retryDelay = Math.min(this.retryDelay * 2, 60_000)
        }
      }
    } finally {
      this.setStatus({ syncing: false })
      await this.refreshCounts()
    }
  }

  private async uploadBlobs() {
    const pending = await this.db.blobs.filter((b) => !!b.pending_upload).toArray()
    for (const b of pending) {
      await this.server!.uploadBlob(b.key, b.blob)
      await this.db.blobs.update(b.key, { pending_upload: false })
    }
  }

  async flush() {
    const server = this.server!
    for (;;) {
      const entry = await this.db.outbox.filter((e) => !e.error).first()
      if (!entry) return
      await this.db.outbox.update(entry.seq!, { in_flight: Date.now(), attempts: entry.attempts + 1 })
      let result
      try {
        result = await server.applyMutation(entry)
      } catch (e) {
        if (e instanceof SyncError && e.kind === 'rejected') {
          await this.db.outbox.update(entry.seq!, { error: e.message, in_flight: undefined })
          continue
        }
        await this.db.outbox.update(entry.seq!, { in_flight: undefined })
        throw e
      }
      const tbl = this.db.table(entry.table)
      await this.db.transaction('rw', tbl, this.db.outbox, this.db.conflicts, async () => {
        await this.db.outbox.delete(entry.seq!)
        const rest = await this.db.outbox.where('record_id').equals(entry.record_id).toArray()
        // Fields this mutation applied are now at result.version for any later queued edits.
        for (const r of rest) {
          const base = { ...r.base }
          for (const f of result.applied) if (f in r.fields) base[f] = result.version
          await this.db.outbox.update(r.seq!, { base })
        }
        await tbl.put({ ...result.row, ...this.overlay(rest) })
        for (const c of result.conflicts) {
          await this.db.conflicts.add({
            band_id: entry.band_id, table: entry.table, record_id: entry.record_id, field: c.field,
            server_value: c.server_value, client_value: c.client_value, at: Date.now(),
          })
        }
      })
    }
  }

  private overlay(entries: OutboxEntry[]) {
    return entries.reduce<Record<string, unknown>>((acc, e) => ({ ...acc, ...e.fields }), {})
  }

  async pull() {
    const server = this.server!
    let cursor = await this.db.getMeta<number>(cursorKey(this.bandId), 0)
    for (;;) {
      const rows = await server.pullChanges(this.bandId, cursor, PAGE)
      if (!rows.length) return
      const notices: string[] = []
      const tables = [...new Set(rows.map((r) => r.table_name))].map((t) => this.db.table(t))
      await this.db.transaction('rw', [...tables, this.db.outbox, this.db.meta], async () => {
        for (const r of rows) {
          const tbl = this.db.table(r.table_name)
          const pending = await this.db.outbox.where('record_id').equals(r.data.id as string).toArray()
          if (r.table_name === 'setlist_items' && r.data.updated_by !== this.userId) {
            const before = await tbl.get(r.data.id as string)
            if (before && before.position !== r.data.position && !pending.some((p) => 'position' in p.fields)) {
              notices.push(r.data.updated_by as string)
            }
          }
          await tbl.put({ ...r.data, ...this.overlay(pending) })
        }
        cursor = rows[rows.length - 1].seq
        await this.db.setMeta(cursorKey(this.bandId), cursor)
      })
      for (const who of new Set(notices)) {
        this.noticeListeners.forEach((l) => l({ kind: 'reordered', message: `Setlist reordered by ${this.memberName(who)}` }))
      }
      if (rows.length < PAGE) return
    }
  }

  private async refreshMembers() {
    const { band, members } = await this.server!.fetchBand(this.bandId)
    await this.db.transaction('rw', this.db.bands, this.db.members, async () => {
      await this.db.bands.put(band)
      await this.db.members.where('band_id').equals(this.bandId).delete()
      await this.db.members.bulkPut(members)
    })
  }
}
