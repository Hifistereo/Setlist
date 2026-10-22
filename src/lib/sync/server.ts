import type { Band, ChangeRow, Member, MutationResult, OutboxEntry } from '../types'

export type SyncErrorKind = 'network' | 'auth' | 'rejected'

export class SyncError extends Error {
  kind: SyncErrorKind
  constructor(kind: SyncErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

/** What the sync engine needs from a backend. Implemented by Supabase and by the in-memory test server. */
export interface SyncServer {
  applyMutation(m: OutboxEntry): Promise<MutationResult>
  pullChanges(bandId: string, afterSeq: number, limit: number): Promise<ChangeRow[]>
  uploadBlob(path: string, blob: Blob): Promise<void>
  downloadBlob(path: string): Promise<Blob>
  fetchBand(bandId: string): Promise<{ band: Band; members: Member[] }>
  /** Realtime nudge; returns an unsubscribe function. */
  subscribe?(bandId: string, onChange: () => void): () => void
}
