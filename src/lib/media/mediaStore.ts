import { db } from '../storage/db'
import { SYNC_TABLES } from '../storage/internal'
import { recordChange } from '../sync/changeLog'
import type { MediaBlob, MediaRecord } from '../../types'
import { mediaObjectPath, mediaThumbnailPath } from './mediaTypes'

/**
 * Adding, replacing and removing a photograph — Milestone 5.
 *
 * LOCAL FIRST, AND VISIBLY SO. Choosing a photo writes the bytes and the
 * record to this device and returns. Nothing waits for a network, nothing
 * fails because there isn't one, and the picture is on the person's card
 * before any upload has been attempted. The upload is queued and happens
 * later, or tomorrow, or never — and the photo is there either way.
 *
 * The metadata goes through `recordChange` like every other edit, in the
 * same transaction as the record, so a photograph's description reaches
 * other devices through the machinery that already exists. The bytes go
 * into a queue of their own because they cannot travel in an event.
 */

/**
 * How wide the small copy is.
 *
 * A tree card draws a 56px portrait and a profile a 104px one, so 256
 * covers both at twice the density without anybody downloading a four
 * megabyte original to fill a thumbnail. Generated once, on the device
 * that added the photo, so nothing on the server has to process images.
 */
export const THUMBNAIL_SIZE = 256

/** Only what the resize below touches, so no DOM lib is needed to describe it. */
interface ImageBitmapLike {
  width: number
  height: number
  close(): void
}

interface OffscreenCanvasLike {
  getContext(kind: '2d'): {
    drawImage(image: ImageBitmapLike, x: number, y: number, w: number, h: number): void
  } | null
  convertToBlob(options?: { type?: string; quality?: number }): Promise<Blob>
}

/**
 * Shrink an image, off the main thread where the browser allows it.
 *
 * `createImageBitmap` and an OffscreenCanvas keep the decode and the draw
 * off the UI thread, which matters because somebody adding a photo of
 * their grandmother should not watch the tree freeze. Where either is
 * missing the original is used as its own thumbnail — worse for
 * bandwidth, fine for correctness, and better than refusing the photo.
 */
export async function makeThumbnail(blob: Blob): Promise<Blob> {
  try {
    /*
      Reached through globalThis because these are browser APIs and the
      test configuration deliberately has no DOM lib — the same reason
      cloudConfig reads process.env this way. Under Node both are absent,
      the guard below returns the original, and the tests exercise every
      other path honestly.
    */
    const browser = globalThis as {
      createImageBitmap?: (blob: Blob) => Promise<ImageBitmapLike>
      OffscreenCanvas?: new (width: number, height: number) => OffscreenCanvasLike
    }
    if (!browser.createImageBitmap || !browser.OffscreenCanvas) return blob

    const bitmap = await browser.createImageBitmap(blob)
    const scale = Math.min(1, THUMBNAIL_SIZE / Math.max(bitmap.width, bitmap.height))
    // Already small enough: re-encoding would only lose quality.
    if (scale >= 1) {
      bitmap.close()
      return blob
    }

    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new browser.OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) {
      bitmap.close()
      return blob
    }
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 })
  } catch {
    // A format the browser cannot decode is still a file worth keeping.
    return blob
  }
}

export interface AttachPhotoInput {
  familyTreeId: string
  personId: string
  blob: Blob
  title?: string
}

/**
 * Put a photograph on a person, and make it their portrait.
 *
 * Returns as soon as it is on this device. The upload is queued, and the
 * queue is drained by the ordinary sync cycle.
 */
export async function attachPersonPhoto(input: AttachPhotoInput): Promise<MediaRecord> {
  const mediaId = crypto.randomUUID()
  const now = new Date().toISOString()

  // Outside the transaction on purpose: shrinking an image is slow and a
  // Dexie transaction that awaits a non-Dexie promise leaves its zone.
  const thumbnail = await makeThumbnail(input.blob)

  const record: MediaRecord = {
    id: mediaId,
    familyTreeId: input.familyTreeId,
    kind: 'photo',
    personIds: [input.personId],
    contentType: input.blob.type || 'application/octet-stream',
    byteSize: input.blob.size,
    createdAt: now,
    updatedAt: now,
    ...(input.title ? { title: input.title } : {}),
  }

  const bytes: MediaBlob = {
    mediaId,
    familyTreeId: input.familyTreeId,
    blob: input.blob,
    thumbnail,
    updatedAt: now,
  }

  await db.transaction(
    'rw',
    [db.media, db.mediaBlobs, db.mediaUploads, db.people, ...SYNC_TABLES],
    async () => {
      const person = await db.people.get(input.personId)
      if (!person) throw new Error('That person no longer exists.')

      await db.media.add(record)
      await db.mediaBlobs.put(bytes)
      await recordChange({
        familyTreeId: input.familyTreeId,
        entity: 'media',
        entityId: mediaId,
        op: 'create',
        before: null,
        after: record,
      })

      /*
        A REPLACED PHOTO IS RETIRED, NOT ABANDONED.

        Without this, choosing a second portrait leaves the first record
        alive with nothing pointing at it: its bytes sit on every device
        that has them and its object sits in the bucket, referenced by
        nobody and cleaned up by nothing, because the cleanup pass only
        looks at tombstones. A family that fixes a bad photo of their
        grandmother would pay for the bad one forever.

        Tombstoning is the same thing removing a photo does, so the
        replacement travels to other devices as an ordinary deletion, and
        the bytes survive locally until that deletion has been accepted.
      */
      const displaced = person.profilePhotoId
        ? await db.media.get(person.profilePhotoId)
        : undefined
      if (displaced && !displaced.deletedAt) {
        const tombstoned = { ...displaced, deletedAt: now, updatedAt: now }
        await db.media.put(tombstoned)
        await recordChange({
          familyTreeId: input.familyTreeId,
          entity: 'media',
          entityId: displaced.id,
          op: 'delete',
          before: displaced,
          after: tombstoned,
        })
        // Never uploaded, so there is nothing in the bucket to tidy and
        // nothing to send.
        if (!displaced.storagePath) await db.mediaUploads.delete(displaced.id)
      }

      // The portrait pointer is an ordinary person edit, so it logs like
      // one and reaches other devices the same way.
      const updated = { ...person, profilePhotoId: mediaId, updatedAt: now }
      await db.people.put(updated)
      await recordChange({
        familyTreeId: input.familyTreeId,
        entity: 'person',
        entityId: person.id,
        op: 'update',
        before: person,
        after: updated,
      })

      await db.mediaUploads.put({
        mediaId,
        familyTreeId: input.familyTreeId,
        state: 'pending',
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      })
    },
  )

  return record
}

/**
 * Take a person's portrait off them.
 *
 * The media record is tombstoned rather than erased, like everything else
 * here, so the removal travels. The old bytes stay on this device until
 * the deletion has been accepted — see the cleanup in mediaSync.
 */
export async function removePersonPhoto(familyTreeId: string, personId: string): Promise<void> {
  const now = new Date().toISOString()

  await db.transaction(
    'rw',
    [db.media, db.mediaUploads, db.people, ...SYNC_TABLES],
    async () => {
      const person = await db.people.get(personId)
      if (!person?.profilePhotoId) return
      const mediaId = person.profilePhotoId

      const { profilePhotoId: _removed, ...withoutPhoto } = person
      const updated = { ...withoutPhoto, updatedAt: now }
      await db.people.put(updated as typeof person)
      await recordChange({
        familyTreeId,
        entity: 'person',
        entityId: personId,
        op: 'update',
        before: person,
        after: updated as typeof person,
      })

      const record = await db.media.get(mediaId)
      if (record && !record.deletedAt) {
        const tombstoned = { ...record, deletedAt: now, updatedAt: now }
        await db.media.put(tombstoned)
        await recordChange({
          familyTreeId,
          entity: 'media',
          entityId: mediaId,
          op: 'delete',
          before: record,
          after: tombstoned,
        })
      }

      // A photo that never reached the cloud has nothing to upload and
      // nothing to clean up. One that did is left for the cleanup pass,
      // which only runs once the tombstone has been accepted.
      const queued = await db.mediaUploads.get(mediaId)
      if (queued && !record?.storagePath) await db.mediaUploads.delete(mediaId)
    },
  )
}

/** The bytes for one photo, if this device has them. */
export function getLocalMedia(mediaId: string): Promise<MediaBlob | undefined> {
  return db.mediaBlobs.get(mediaId)
}

/** Where this photo's bytes belong in storage. Derived, never chosen. */
export function pathsFor(record: MediaRecord): { original: string; thumbnail: string } {
  return {
    original: mediaObjectPath(record.familyTreeId, record.id),
    thumbnail: mediaThumbnailPath(record.familyTreeId, record.id),
  }
}

/**
 * The portraits this tree needs on this device.
 *
 * What the sync cycle passes as `downloadFor`. A family's photographs can
 * run to hundreds; the ones a device has to have are the faces on the
 * cards it is about to draw, and everything else waits until somebody
 * asks for it. Ids already held locally are still returned — the sync
 * skips those itself, and filtering twice would mean two passes over the
 * same table.
 */
export async function portraitMediaIds(familyTreeId: string): Promise<string[]> {
  const people = await db.people.where('familyTreeId').equals(familyTreeId).toArray()
  const ids = new Set<string>()
  for (const person of people) {
    if (person.profilePhotoId && !person.deletedAt) ids.add(person.profilePhotoId)
  }
  return [...ids]
}
