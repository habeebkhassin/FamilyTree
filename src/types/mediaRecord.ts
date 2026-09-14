export type MediaKind = 'photo' | 'audio' | 'video' | 'story' | 'event'

/**
 * Binary content lives here, never inline on Person — a Person only ever
 * holds a profilePhotoId pointing at a record in this store.
 *
 *
 * THE BYTES ARE NOT IN HERE ANY MORE — Milestone 5
 * ────────────────────────────────────────────────
 * This record used to carry the Blob itself, which is why changeTypes.ts
 * excluded media from the change log: an event carries complete
 * before/after snapshots, and a snapshot containing a Blob would copy
 * binary into every event and every sync payload.
 *
 * The objection was right, so the bytes moved rather than the rule
 * bending. A MediaRecord is now plain JSON — a description of a
 * photograph and where to find it — and the bytes live in a local-only
 * `mediaBlobs` table beside it and in object storage above it. Which
 * makes this record syncable exactly like a Person, through the machinery
 * that already exists, with no second engine for metadata.
 */
export interface MediaRecord {
  id: string
  familyTreeId: string
  kind: MediaKind
  title?: string
  body?: string
  date?: string
  personIds: string[]
  /**
   * Where the bytes live in object storage, derived from the tree and
   * media ids rather than chosen: `trees/{treeId}/media/{mediaId}/original`.
   *
   * Deterministic on purpose. A retry after a timeout writes to the same
   * place, so re-uploading is harmless, and a path cannot be pointed at
   * another family's folder because it is computed from ids the server
   * checks.
   *
   * Absent until the first successful upload. Its absence is what marks a
   * photo as still only on this device.
   */
  storagePath?: string
  /** The small copy the tree cards use. Same rules as storagePath. */
  thumbnailPath?: string
  /** Bytes, as the browser reported them. Useful before downloading. */
  contentType?: string
  byteSize?: number
  createdAt: string
  updatedAt: string
  /**
   * Set when the record is deleted. A tombstone rather than a physical
   * removal, exactly like every other syncable record — which is what
   * lets a deletion travel to another device, and what stops a queued
   * upload resurrecting a photo somebody removed.
   */
  deletedAt?: string
}

/**
 * The actual bytes, kept on this device only.
 *
 * DELIBERATELY NOT SYNCED AND DELIBERATELY NOT BACKED UP. It is a cache
 * of what object storage holds, plus the staging area for a photo that
 * has not been uploaded yet. Nothing here ever enters a ChangeEvent.
 */
export interface MediaBlob {
  mediaId: string
  familyTreeId: string
  /** The full-size image. */
  blob: Blob
  /** The small copy, generated on this device when the photo was added. */
  thumbnail?: Blob
  updatedAt: string
}
