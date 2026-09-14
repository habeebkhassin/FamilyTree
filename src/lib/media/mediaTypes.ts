/**
 * Photographs waiting to reach object storage — Milestone 5.
 *
 * A queue, not a synchronisation engine. The metadata travels through the
 * change log and the outbox exactly like a person's birth date; this is
 * only the bytes, which cannot go in an event and so need somewhere of
 * their own to wait.
 *
 * Keyed by media id, which is what makes a retry safe: the object path is
 * derived from that id, so uploading twice writes the same bytes to the
 * same place rather than making a second copy.
 */
export type MediaUploadState =
  /** Waiting to go, or waiting to be tried again. */
  | 'pending'
  /** The server refused it. Kept, with the reason, and not retried. */
  | 'rejected'

export interface MediaUpload {
  mediaId: string
  familyTreeId: string
  state: MediaUploadState
  /** How many times this has been attempted, to back off rather than hammer. */
  attempts: number
  /** When it may next be tried. Absent means now. */
  nextAttemptAt?: string
  failedReason?: string
  createdAt: string
  updatedAt: string
}

/**
 * Where a photograph's bytes live.
 *
 * Derived from ids the server can check, never chosen by the client. A
 * path built from a tree id the caller is not a member of is refused by
 * the storage policy, so this is a convenience rather than a control —
 * but it is also what makes retries idempotent, because the same photo
 * always resolves to the same object.
 */
export function mediaObjectPath(familyTreeId: string, mediaId: string): string {
  return `trees/${familyTreeId}/media/${mediaId}/original`
}

export function mediaThumbnailPath(familyTreeId: string, mediaId: string): string {
  return `trees/${familyTreeId}/media/${mediaId}/thumbnail`
}

/** The one bucket. Private — see the storage policies in migration 0004. */
export const MEDIA_BUCKET = 'family-media'
