import type { SupabaseClient } from '@supabase/supabase-js'
import type { Band, ChangeRow, Member, MutationResult, OutboxEntry } from '../types'
import { SyncError, type SyncServer } from './server'

export const BUCKET = 'song-files'

interface PgError {
  message: string
  code?: string
  status?: number
}

/** PostgREST errors carry a SQLSTATE code; fetch failures don't. */
export function classify(err: PgError, status?: number): SyncError {
  if (status === 401 || err.code === 'PGRST301' || err.code === 'PGRST303' || /JWT/i.test(err.message)) {
    return new SyncError('auth', 'Session expired — sign in again to sync.')
  }
  if (!err.code || /fetch|network|timeout/i.test(err.message)) return new SyncError('network', err.message || 'Network error')
  if (err.code.startsWith('5') || err.code === '40001' || err.code === '40P01') return new SyncError('network', err.message)
  return new SyncError('rejected', err.message)
}

export class SupabaseServer implements SyncServer {
  private sb: SupabaseClient
  constructor(sb: SupabaseClient) {
    this.sb = sb
  }

  async applyMutation(m: OutboxEntry): Promise<MutationResult> {
    const { data, error, status } = await this.sb.rpc('apply_mutation', {
      p_mutation_id: m.mutation_id, p_table: m.table, p_band: m.band_id,
      p_record: m.record_id, p_fields: m.fields, p_base: m.base,
    })
    if (error) throw classify(error, status)
    return data as MutationResult
  }

  async pullChanges(bandId: string, afterSeq: number, limit: number): Promise<ChangeRow[]> {
    const { data, error, status } = await this.sb.rpc('pull_changes', { p_band: bandId, p_after: afterSeq, p_limit: limit })
    if (error) throw classify(error, status)
    return (data ?? []) as ChangeRow[]
  }

  async uploadBlob(path: string, blob: Blob) {
    const { error } = await this.sb.storage.from(BUCKET).upload(path, blob, { upsert: true })
    if (error) throw classify({ message: error.message, code: 'statusCode' in error ? String(error.statusCode) : undefined })
  }

  async downloadBlob(path: string) {
    const { data, error } = await this.sb.storage.from(BUCKET).download(path)
    if (error || !data) throw classify({ message: error?.message ?? 'download failed' })
    return data
  }

  async fetchBand(bandId: string): Promise<{ band: Band; members: Member[] }> {
    const [b, m] = await Promise.all([
      this.sb.from('bands').select('id, name').eq('id', bandId).single(),
      this.sb.from('band_members').select('band_id, user_id, display_name, instrument, role').eq('band_id', bandId),
    ])
    if (b.error) throw classify(b.error, b.status)
    if (m.error) throw classify(m.error, m.status)
    return { band: b.data as Band, members: (m.data ?? []) as Member[] }
  }

  subscribe(bandId: string, onChange: () => void) {
    let t: ReturnType<typeof setTimeout> | null = null
    const channel = this.sb
      .channel(`band:${bandId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'change_log', filter: `band_id=eq.${bandId}` }, () => {
        if (t) clearTimeout(t)
        t = setTimeout(onChange, 300)
      })
      .subscribe()
    return () => {
      if (t) clearTimeout(t)
      void this.sb.removeChannel(channel)
    }
  }
}
