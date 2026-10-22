import type { Band, ChangeRow, Member, MutationResult, OutboxEntry, TableName } from '../types'
import { emptyRow } from '../types'
import { SyncError, type SyncServer } from './server'

/**
 * In-memory backend with the same semantics as supabase/schema.sql (apply_mutation / pull_changes).
 * Used by the sync tests. Each FakeClient is one signed-in member talking to the shared FakeBackend.
 */
const LWW = ['position', 'deleted_at']

export class FakeBackend {
  rows = new Map<string, { table: TableName; row: Record<string, unknown> }>()
  log: { seq: number; band_id: string; table: TableName; id: string; owner?: string }[] = []
  processed = new Map<string, MutationResult>()
  blobs = new Map<string, Blob>()
  members: Member[] = []
  seq = 0
  offline = false
  expired = new Set<string>()
  /** Drop the response after applying (simulates a timeout after the server committed). */
  loseNextResponse = false

  client(userId: string): FakeClient {
    return new FakeClient(this, userId)
  }
}

export class FakeClient implements SyncServer {
  private b: FakeBackend
  private uid: string
  constructor(b: FakeBackend, uid: string) {
    this.b = b
    this.uid = uid
  }

  private guard(bandId: string) {
    if (this.b.offline) throw new SyncError('network', 'offline')
    if (this.b.expired.has(this.uid)) throw new SyncError('auth', 'expired')
    if (!this.b.members.some((m) => m.band_id === bandId && m.user_id === this.uid)) throw new SyncError('rejected', 'not a member')
  }

  async applyMutation(m: OutboxEntry): Promise<MutationResult> {
    this.guard(m.band_id)
    const prior = this.b.processed.get(m.mutation_id)
    if (prior) return structuredClone(prior)
    const now = new Date().toISOString()
    const existing = this.b.rows.get(m.record_id)
    const applied: string[] = []
    const conflicts: MutationResult['conflicts'] = []
    let status: MutationResult['status']
    let version: number
    if (!existing) {
      const fv: Record<string, number> = {}
      for (const k of Object.keys(m.fields)) { fv[k] = 1; applied.push(k) }
      const row: Record<string, unknown> = {
        ...emptyRow(m.table, m.record_id, m.band_id), ...m.fields,
        version: 1, field_versions: fv, created_by: this.uid, updated_by: this.uid, updated_at: now,
      }
      if (m.table === 'song_notes') row.user_id = this.uid
      if (row.deleted_at) row.deleted_at = now
      this.b.rows.set(m.record_id, { table: m.table, row })
      version = 1
      status = 'applied'
    } else {
      const cur = existing.row
      if (m.table === 'song_notes' && cur.user_id !== this.uid) throw new SyncError('rejected', 'private note')
      version = (cur.version as number) + 1
      const fv = { ...(cur.field_versions as Record<string, number>) }
      const next = { ...cur }
      for (const [k, v] of Object.entries(m.fields)) {
        if (JSON.stringify(cur[k]) === JSON.stringify(v)) continue
        if ((fv[k] ?? 0) <= (m.base[k] ?? 0) || LWW.includes(k)) {
          next[k] = k === 'deleted_at' && v ? now : v
          fv[k] = version
          applied.push(k)
        } else {
          conflicts.push({ field: k, server_value: cur[k], client_value: v })
        }
      }
      if (!applied.length) {
        version = cur.version as number
        status = conflicts.length ? 'conflict' : 'noop'
      } else {
        Object.assign(next, { version, field_versions: fv, updated_by: this.uid, updated_at: now })
        existing.row = next
        status = conflicts.length ? 'partial' : 'applied'
      }
    }
    if (applied.length) {
      this.b.log.push({ seq: ++this.b.seq, band_id: m.band_id, table: m.table, id: m.record_id,
        owner: m.table === 'song_notes' ? this.uid : undefined })
    }
    const result: MutationResult = { status, version, applied, conflicts, row: structuredClone(this.b.rows.get(m.record_id)!.row) }
    this.b.processed.set(m.mutation_id, result)
    if (this.b.loseNextResponse) {
      this.b.loseNextResponse = false
      throw new SyncError('network', 'response lost')
    }
    return structuredClone(result)
  }

  async pullChanges(bandId: string, afterSeq: number, limit: number): Promise<ChangeRow[]> {
    this.guard(bandId)
    const latest = new Map<string, { seq: number; table: TableName }>()
    for (const l of this.b.log) {
      if (l.band_id !== bandId || l.seq <= afterSeq || (l.owner && l.owner !== this.uid)) continue
      latest.set(l.id, { seq: l.seq, table: l.table })
    }
    return [...latest.entries()]
      .sort((a, b) => a[1].seq - b[1].seq)
      .slice(0, limit)
      .map(([id, l]) => ({ seq: l.seq, table_name: l.table, data: structuredClone(this.b.rows.get(id)!.row) }))
  }

  async uploadBlob(path: string, blob: Blob) {
    if (this.b.offline) throw new SyncError('network', 'offline')
    this.b.blobs.set(path, blob)
  }

  async downloadBlob(path: string) {
    if (this.b.offline) throw new SyncError('network', 'offline')
    const blob = this.b.blobs.get(path)
    if (!blob) throw new SyncError('rejected', 'not found')
    return blob
  }

  async fetchRow(_table: TableName, id: string) {
    if (this.b.offline) throw new SyncError('network', 'offline')
    const r = this.b.rows.get(id)?.row
    if (!r || (r.user_id && r.user_id !== this.uid)) return null
    return structuredClone(r)
  }

  async fetchBand(bandId: string): Promise<{ band: Band; members: Member[] }> {
    this.guard(bandId)
    return { band: { id: bandId, name: 'Test Band' }, members: this.b.members.filter((m) => m.band_id === bandId) }
  }
}
