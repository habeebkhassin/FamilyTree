import { db } from '../storage/db'
import { SYNC_TABLES } from '../storage/internal'
import { recordChange } from '../sync/changeLog'
import { classifyFailure } from '../sync/syncEngine'
import type { SyncFailure } from '../sync/syncEngine'
import type { MediaRecord } from '../../types'
import { mediaObjectPath, mediaThumbnailPath } from './mediaTypes'
import type { MediaTransport } from './mediaTransport'

/**
 * Moving photographs between this device and object storage — Milestone 5.
 *
 * NOT A SECOND SYNC ENGINE, and the distinction is worth being precise
 * about. Every fact about a photograph — that it exists, who it is of,
 * that it was deleted, where its bytes live — travels as an ordinary
 * ChangeEvent through the outbox, the push, the pull and the reconciler
 * built in Milestone 3. What this file moves is the bytes, which cannot
 * go in an event, and it moves them along a path derived from ids that
 * are already agreed.
 *
 *
 * POSTGRES AND STORAGE ARE NOT ONE TRANSACTION
 * ────────────────────────────────────────────
 * They are two systems and no amount of care makes them atomic, so the
 * order is chosen for what each failure leaves behind:
 *
 *   bytes first, then the metadata that names them.
 *
 * Upload succeeds and the app dies before the record is updated: the
 * object is there, unreferenced, and the next attempt uploads the same
 * bytes to the same path and records it. Nothing is lost and nothing is
 * duplicated.
 *
 * The other order would publish a path to other devices before anything
 * was behind it, and they would fetch a photograph that is not there.
 */

export interface MediaSyncOutcome {
  uploaded: number
  downloaded: number
  removed: number
  failures: { mediaId: string; reason: string }[]
  failure?: SyncFailure
}

/** How long to wait before trying a failed upload again. */
function backoffMinutes(attempts: number): number {
  return Math.min(60, 2 ** Math.min(attempts, 5))
}

/** Photos queued on this device that are due to be tried. */
export async function getDueUploads(familyTreeId: string, now = new Date()) {
  const queued = await db.mediaUploads.where('familyTreeId').equals(familyTreeId).toArray()
  return queued.filter(
    (entry) =>
      entry.state === 'pending' &&
      (!entry.nextAttemptAt || new Date(entry.nextAttemptAt) <= now),
  )
}

/**
 * Send everything waiting, then fetch anything visible that is missing.
 *
 * Called by the ordinary sync cycle rather than on a timer of its own —
 * one thing decides when this application talks to the network.
 */
export async function syncMedia(
  familyTreeId: string,
  transport: MediaTransport,
  options: { downloadFor?: string[] } = {},
): Promise<MediaSyncOutcome> {
  const outcome: MediaSyncOutcome = { uploaded: 0, downloaded: 0, removed: 0, failures: [] }

  // ── upload ────────────────────────────────────────────────────────
  for (const entry of await getDueUploads(familyTreeId)) {
    const record = await db.media.get(entry.mediaId)
    const bytes = await db.mediaBlobs.get(entry.mediaId)

    // Deleted before it ever went up, or the bytes are gone: there is
    // nothing to send and the queue entry is simply finished. Uploading
    // a tombstoned photo would resurrect it in storage.
    if (!record || record.deletedAt || !bytes) {
      await db.mediaUploads.delete(entry.mediaId)
      continue
    }

    const original = mediaObjectPath(familyTreeId, record.id)
    const thumbnail = mediaThumbnailPath(familyTreeId, record.id)

    try {
      await transport.upload(original, bytes.blob, record.contentType ?? 'application/octet-stream')
      if (bytes.thumbnail) {
        await transport.upload(thumbnail, bytes.thumbnail, 'image/jpeg')
      }

      // Only now is the path true, so only now is it written down and
      // told to anybody else.
      await db.transaction('rw', [db.media, db.mediaUploads, ...SYNC_TABLES], async () => {
        const current = await db.media.get(record.id)
        // Removed while the upload was in flight: leave the tombstone
        // alone and let the cleanup pass deal with the object.
        if (!current || current.deletedAt) {
          await db.mediaUploads.delete(record.id)
          return
        }
        const updated: MediaRecord = {
          ...current,
          storagePath: original,
          ...(bytes.thumbnail ? { thumbnailPath: thumbnail } : {}),
          updatedAt: new Date().toISOString(),
        }
        await db.media.put(updated)
        await recordChange({
          familyTreeId,
          entity: 'media',
          entityId: record.id,
          op: 'update',
          before: current,
          after: updated,
        })
        await db.mediaUploads.delete(record.id)
      })
      outcome.uploaded += 1
    } catch (error) {
      const failure = classifyFailure(error)
      const attempts = entry.attempts + 1
      const now = new Date()

      await db.mediaUploads.put({
        ...entry,
        // A refusal will not become an acceptance by being repeated. A
        // network problem will. Only the first is given up on, and even
        // then the photo stays on the device and the entry keeps its
        // reason.
        state: failure.kind === 'authorization' || failure.kind === 'authentication' ? 'rejected' : 'pending',
        attempts,
        nextAttemptAt: new Date(now.getTime() + backoffMinutes(attempts) * 60_000).toISOString(),
        failedReason: failure.message,
        updatedAt: now.toISOString(),
      })
      outcome.failures.push({ mediaId: entry.mediaId, reason: failure.message })
      if (failure.kind === 'network') {
        // No point trying the rest down the same broken connection.
        return { ...outcome, failure }
      }
    }
  }

  // ── download what is needed and missing ───────────────────────────
  //
  // Only the photos the caller asked for, which is the visible tree's
  // portraits rather than every photograph the family has ever had.
  const wanted = options.downloadFor ?? []
  for (const mediaId of wanted) {
    if (await db.mediaBlobs.get(mediaId)) continue
    const record = await db.media.get(mediaId)
    if (!record || record.deletedAt || !record.storagePath) continue

    try {
      // The thumbnail first: it is what a card draws, and it is a
      // fraction of the size. The original is fetched when somebody
      // actually looks at the photograph.
      const path = record.thumbnailPath ?? record.storagePath
      const blob = await transport.download(path)
      if (!blob) continue
      await db.mediaBlobs.put({
        mediaId,
        familyTreeId,
        blob,
        ...(record.thumbnailPath ? { thumbnail: blob } : {}),
        updatedAt: new Date().toISOString(),
      })
      outcome.downloaded += 1
    } catch (error) {
      const failure = classifyFailure(error)
      outcome.failures.push({ mediaId, reason: failure.message })
      if (failure.kind === 'network') return { ...outcome, failure }
    }
  }

  // ── clean up objects whose record is gone ─────────────────────────
  outcome.removed += await cleanUpDeletedMedia(familyTreeId, transport)
  return outcome
}

/**
 * Remove the objects behind tombstoned records.
 *
 * Runs only after the tombstone has been ACCEPTED by the server — an
 * event still sitting in the outbox means other devices have not been
 * told, and deleting the bytes first would leave them fetching a
 * photograph that no longer exists while still believing in it.
 *
 * The record itself stays tombstoned forever, as every deleted record in
 * this application does. What goes is the object and the local copy.
 */
export async function cleanUpDeletedMedia(
  familyTreeId: string,
  transport: MediaTransport,
): Promise<number> {
  const tombstoned = (await db.media.where('familyTreeId').equals(familyTreeId).toArray()).filter(
    (record) => record.deletedAt && record.storagePath,
  )
  if (tombstoned.length === 0) return 0

  const stillQueued = new Set(
    (await db.outbox.where('familyTreeId').equals(familyTreeId).toArray())
      .filter((entry) => !entry.rejectedAt)
      .map((entry) => entry.eventId),
  )
  const unsentDeletions = new Set(
    (await db.changeEvents.where('familyTreeId').equals(familyTreeId).toArray())
      .filter((event) => event.entity === 'media' && stillQueued.has(event.id))
      .map((event) => event.entityId),
  )

  let removed = 0
  for (const record of tombstoned) {
    if (unsentDeletions.has(record.id)) continue
    try {
      await transport.remove(record.storagePath as string)
      if (record.thumbnailPath) await transport.remove(record.thumbnailPath)
      // The paths go with the object, so a later pass does not try again
      // and a retry cannot resurrect anything.
      await db.transaction('rw', [db.media, db.mediaBlobs], async () => {
        const current = await db.media.get(record.id)
        if (current) {
          const { storagePath: _a, thumbnailPath: _b, ...rest } = current
          await db.media.put(rest)
        }
        await db.mediaBlobs.delete(record.id)
      })
      removed += 1
    } catch {
      // Left for next time. An object that outlives its record costs
      // storage; one deleted too early costs somebody their photograph.
    }
  }
  return removed
}
