import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import 'fake-indexeddb/auto'
import { db } from '../storage/db'
import { createFamilyTree } from '../storage/familyTrees'
import { createPerson } from '../storage/people'
import { attachPersonPhoto, getLocalMedia, removePersonPhoto } from './mediaStore'
import { cleanUpDeletedMedia, getDueUploads, syncMedia } from './mediaSync'
import { NoMediaTransport } from './mediaTransport'
import type { MediaTransport } from './mediaTransport'
import { mediaObjectPath, mediaThumbnailPath } from './mediaTypes'

/**
 * Photographs on a device: adding one offline, getting it uploaded,
 * getting it back on another device, and removing it without leaving
 * anything behind or resurrecting anything.
 *
 * The storage policies that decide who may do any of this are tested
 * against real Postgres in cloud/media.sql.test.ts. This is about what
 * the device does with the answers.
 */

/** A store that records what it was asked to do, and can be told to fail. */
class FakeStorage implements MediaTransport {
  objects = new Map<string, Blob>()
  uploads: string[] = []
  removals: string[] = []
  failWith: string | null = null

  #check() {
    if (this.failWith) throw new Error(this.failWith)
  }

  async upload(path: string, blob: Blob, _contentType?: string): Promise<void> {
    this.#check()
    this.uploads.push(path)
    // Overwrites, exactly as the real one does with upsert.
    this.objects.set(path, blob)
  }

  async download(path: string): Promise<Blob | null> {
    this.#check()
    return this.objects.get(path) ?? null
  }

  async remove(path: string): Promise<void> {
    this.#check()
    this.removals.push(path)
    this.objects.delete(path)
  }
}

const bytes = (size = 8) => new Blob([new Uint8Array(size).fill(7)], { type: 'image/png' })

beforeEach(async () => {
  await db.delete()
  await db.open()
})

async function seed() {
  const tree = await createFamilyTree({ name: 'Okafor Family' })
  const grace = await createPerson({
    familyTreeId: tree.id,
    firstName: 'Grace',
    lastName: 'Okafor',
    gender: 'female',
  })
  return { tree, grace }
}

// ── adding a photo never waits for a network ────────────────────────

test('a photo is on the person immediately, with no cloud at all', async () => {
  const { tree, grace } = await seed()

  const record = await attachPersonPhoto({
    familyTreeId: tree.id,
    personId: grace.id,
    blob: bytes(),
  })

  assert.equal((await db.people.get(grace.id))?.profilePhotoId, record.id, 'it is their portrait')
  assert.ok(await getLocalMedia(record.id), 'and the bytes are here')
  assert.equal(record.storagePath, undefined, 'with no path, because nothing has been uploaded')

  const queued = await getDueUploads(tree.id)
  assert.equal(queued.length, 1, 'it is queued for whenever there is a cloud')
})

test('the metadata travels as ordinary change events', async () => {
  const { tree, grace } = await seed()
  await attachPersonPhoto({ familyTreeId: tree.id, personId: grace.id, blob: bytes() })

  const events = await db.changeEvents.where('familyTreeId').equals(tree.id).toArray()
  const media = events.filter((event) => event.entity === 'media')
  assert.equal(media.length, 1, 'one media event, through the log that already existed')
  assert.equal(media[0]?.op, 'create')

  // And no blob anywhere near an event.
  assert.ok(
    !JSON.stringify(media[0]?.after ?? {}).includes('blob'),
    'the snapshot is metadata, which is why media can be logged at all',
  )
  assert.ok(
    events.some((event) => event.entity === 'person' && event.op === 'update'),
    'and the portrait pointer is an ordinary person edit',
  )
})

test('with no cloud, uploading refuses rather than pretending', async () => {
  const transport = new NoMediaTransport()
  await assert.rejects(() => transport.upload('any', bytes(), 'image/png'), /no cloud configured/i)
  assert.equal(await transport.download('any'), null)
})

// ── uploading ───────────────────────────────────────────────────────

test('a queued photo is uploaded and its path recorded', async () => {
  const { tree, grace } = await seed()
  const record = await attachPersonPhoto({ familyTreeId: tree.id, personId: grace.id, blob: bytes() })
  const storage = new FakeStorage()

  const outcome = await syncMedia(tree.id, storage)

  assert.equal(outcome.uploaded, 1)
  assert.ok(storage.objects.has(mediaObjectPath(tree.id, record.id)), 'the bytes are in storage')
  assert.equal(
    (await db.media.get(record.id))?.storagePath,
    mediaObjectPath(tree.id, record.id),
    'and the record now names where they are',
  )
  assert.deepEqual(await getDueUploads(tree.id), [], 'the queue drained')
})

test('a failed upload keeps the photo, the record and the queue entry', async () => {
  const { tree, grace } = await seed()
  const record = await attachPersonPhoto({ familyTreeId: tree.id, personId: grace.id, blob: bytes() })
  const storage = new FakeStorage()
  storage.failWith = 'Failed to fetch'

  const outcome = await syncMedia(tree.id, storage)

  assert.equal(outcome.uploaded, 0)
  assert.equal(outcome.failure?.kind, 'network')
  assert.ok(await getLocalMedia(record.id), 'the photo is still on the device')
  assert.equal((await db.media.get(record.id))?.storagePath, undefined, 'and claims no path it does not have')

  const queued = await db.mediaUploads.get(record.id)
  assert.equal(queued?.state, 'pending', 'still to be tried')
  assert.equal(queued?.attempts, 1)
  assert.ok(queued?.nextAttemptAt, 'and backed off rather than hammered')
})

test('a refusal is not retried forever, and keeps its reason', async () => {
  const { tree, grace } = await seed()
  const record = await attachPersonPhoto({ familyTreeId: tree.id, personId: grace.id, blob: bytes() })
  const storage = new FakeStorage()
  storage.failWith = 'new row violates row-level security policy'

  await syncMedia(tree.id, storage)

  const queued = await db.mediaUploads.get(record.id)
  assert.equal(queued?.state, 'rejected')
  assert.match(queued?.failedReason ?? '', /permission/i)
  assert.deepEqual(await getDueUploads(tree.id), [], 'it is not offered again')
  assert.ok(await getLocalMedia(record.id), 'but the photo is still theirs')
})

test('retrying an upload writes the same object rather than a second one', async () => {
  const { tree, grace } = await seed()
  const record = await attachPersonPhoto({ familyTreeId: tree.id, personId: grace.id, blob: bytes() })
  const storage = new FakeStorage()

  // Uploaded, and the answer lost on the way back, so it is queued still.
  await storage.upload(mediaObjectPath(tree.id, record.id), bytes(), 'image/png')
  await syncMedia(tree.id, storage)

  assert.equal(storage.objects.size, 2, 'the original and its thumbnail, and no duplicates')
  assert.equal(
    storage.uploads.filter((path) => path === mediaObjectPath(tree.id, record.id)).length,
    2,
    'the same path twice is harmless, which is what a derived path buys',
  )
})

test('a pending upload survives a restart', async () => {
  const { tree, grace } = await seed()
  const record = await attachPersonPhoto({ familyTreeId: tree.id, personId: grace.id, blob: bytes() })

  // Close and reopen, as a browser restart would.
  db.close()
  await db.open()

  const queued = await getDueUploads(tree.id)
  assert.equal(queued.length, 1, 'the queue is in the database, not in memory')
  assert.equal(queued[0]?.mediaId, record.id)
  assert.ok(await getLocalMedia(record.id), 'and so are the bytes')
})

// ── another device ──────────────────────────────────────────────────

test('a device without the bytes downloads only what it is asked for', async () => {
  const { tree, grace } = await seed()
  const record = await attachPersonPhoto({ familyTreeId: tree.id, personId: grace.id, blob: bytes() })
  const storage = new FakeStorage()
  await syncMedia(tree.id, storage)

  // A second device: same metadata, no bytes.
  await db.mediaBlobs.clear()
  assert.equal(await getLocalMedia(record.id), undefined)

  // Nothing asked for, nothing fetched.
  const idle = await syncMedia(tree.id, storage)
  assert.equal(idle.downloaded, 0, 'the whole library is not pulled down on sight')

  const asked = await syncMedia(tree.id, storage, { downloadFor: [record.id] })
  assert.equal(asked.downloaded, 1)
  assert.ok(await getLocalMedia(record.id), 'and it is cached for next time')
})

test('a photo already cached is not downloaded again', async () => {
  const { tree, grace } = await seed()
  const record = await attachPersonPhoto({ familyTreeId: tree.id, personId: grace.id, blob: bytes() })
  const storage = new FakeStorage()
  await syncMedia(tree.id, storage)

  const outcome = await syncMedia(tree.id, storage, { downloadFor: [record.id] })
  assert.equal(outcome.downloaded, 0, 'the local copy is used')
})

test('a record whose bytes were never uploaded is simply skipped', async () => {
  const { tree, grace } = await seed()
  const record = await attachPersonPhoto({ familyTreeId: tree.id, personId: grace.id, blob: bytes() })
  await db.mediaBlobs.clear()

  const outcome = await syncMedia(tree.id, new FakeStorage(), { downloadFor: [record.id] })
  assert.equal(outcome.downloaded, 0, 'there is nothing to fetch, and that is not an error')
  assert.equal(outcome.failures.length, 0)
})

// ── removing ────────────────────────────────────────────────────────

test('removing a photo tombstones it and clears the portrait', async () => {
  const { tree, grace } = await seed()
  const record = await attachPersonPhoto({ familyTreeId: tree.id, personId: grace.id, blob: bytes() })

  await removePersonPhoto(tree.id, grace.id)

  assert.equal((await db.people.get(grace.id))?.profilePhotoId, undefined)
  assert.ok((await db.media.get(record.id))?.deletedAt, 'tombstoned, not erased')
  const events = await db.changeEvents.where('familyTreeId').equals(tree.id).toArray()
  assert.ok(events.some((event) => event.entity === 'media' && event.op === 'delete'))
})

test('a removed photo is never uploaded, even if it was queued', async () => {
  const { tree, grace } = await seed()
  const record = await attachPersonPhoto({ familyTreeId: tree.id, personId: grace.id, blob: bytes() })
  await removePersonPhoto(tree.id, grace.id)

  const storage = new FakeStorage()
  const outcome = await syncMedia(tree.id, storage)

  assert.equal(outcome.uploaded, 0)
  assert.equal(storage.objects.size, 0, 'a deleted photo must not reappear in storage')
  assert.equal(await db.mediaUploads.get(record.id), undefined, 'and the queue entry is finished')
})

test('the object is only cleaned up once the deletion has been sent', async () => {
  const { tree, grace } = await seed()
  const record = await attachPersonPhoto({ familyTreeId: tree.id, personId: grace.id, blob: bytes() })
  const storage = new FakeStorage()
  await syncMedia(tree.id, storage)

  await removePersonPhoto(tree.id, grace.id)

  // The deletion event is still in the outbox: other devices do not know.
  const tooEarly = await cleanUpDeletedMedia(tree.id, storage)
  assert.equal(tooEarly, 0, 'deleting the bytes now would strand everybody else')
  assert.ok(storage.objects.has(mediaObjectPath(tree.id, record.id)))

  // Once it has gone, the object may go too.
  await db.outbox.clear()
  const removed = await cleanUpDeletedMedia(tree.id, storage)
  assert.equal(removed, 1)
  assert.equal(storage.objects.size, 0)
  assert.equal(await getLocalMedia(record.id), undefined, 'and the local copy goes with it')
})

test('cleanup is safe to repeat and cannot resurrect anything', async () => {
  const { tree, grace } = await seed()
  await attachPersonPhoto({ familyTreeId: tree.id, personId: grace.id, blob: bytes() })
  const storage = new FakeStorage()
  await syncMedia(tree.id, storage)
  await removePersonPhoto(tree.id, grace.id)
  await db.outbox.clear()

  assert.equal(await cleanUpDeletedMedia(tree.id, storage), 1)
  assert.equal(await cleanUpDeletedMedia(tree.id, storage), 0, 'nothing left to do')

  // And a later sync does not put it back.
  const outcome = await syncMedia(tree.id, storage)
  assert.equal(outcome.uploaded, 0)
  assert.equal(storage.objects.size, 0)
})

test('an interrupted cleanup leaves the record for next time', async () => {
  const { tree, grace } = await seed()
  const record = await attachPersonPhoto({ familyTreeId: tree.id, personId: grace.id, blob: bytes() })
  const storage = new FakeStorage()
  await syncMedia(tree.id, storage)
  await removePersonPhoto(tree.id, grace.id)
  await db.outbox.clear()

  storage.failWith = 'Failed to fetch'
  assert.equal(await cleanUpDeletedMedia(tree.id, storage), 0)
  assert.ok(
    (await db.media.get(record.id))?.storagePath,
    'the path is kept, so the next pass knows there is still an object',
  )

  storage.failWith = null
  assert.equal(await cleanUpDeletedMedia(tree.id, storage), 1, 'and it finishes later')
})

// ── replacing ───────────────────────────────────────────────────────

test('replacing a portrait keeps the old photo until the new one is safe', async () => {
  const { tree, grace } = await seed()
  const first = await attachPersonPhoto({ familyTreeId: tree.id, personId: grace.id, blob: bytes(8) })
  const storage = new FakeStorage()
  await syncMedia(tree.id, storage)

  const second = await attachPersonPhoto({ familyTreeId: tree.id, personId: grace.id, blob: bytes(16) })

  assert.equal((await db.people.get(grace.id))?.profilePhotoId, second.id, 'the new one is the portrait')
  assert.ok(await getLocalMedia(first.id), 'and the old one is not destroyed')
  assert.ok(
    storage.objects.has(mediaObjectPath(tree.id, first.id)),
    'nor is its object, which somebody may still be looking at',
  )
  assert.notEqual(first.id, second.id, 'a replacement is a new record, not an overwrite')

  await syncMedia(tree.id, storage)
  assert.ok(storage.objects.has(mediaObjectPath(tree.id, second.id)), 'and the new one uploads too')
  assert.ok(storage.objects.has(mediaThumbnailPath(tree.id, second.id)))
})

test('a replaced portrait is retired, not left behind forever', async () => {
  /*
    The test above only asked that the old photo survive the moment of
    replacement, and it does. It never asked what becomes of it — and the
    answer was nothing at all: no tombstone, so the cleanup pass never
    saw it, so its bytes and its object outlived every reference to them.
    Someone correcting a bad photo would have paid for the bad one for
    the life of the tree.
  */
  const { tree, grace } = await seed()
  const first = await attachPersonPhoto({ familyTreeId: tree.id, personId: grace.id, blob: bytes(8) })
  const storage = new FakeStorage()
  await syncMedia(tree.id, storage)
  assert.ok(storage.objects.has(mediaObjectPath(tree.id, first.id)))

  const replacement = await attachPersonPhoto({
    familyTreeId: tree.id,
    personId: grace.id,
    blob: bytes(16),
  })

  assert.ok((await db.media.get(first.id))?.deletedAt, 'the displaced record is tombstoned')
  assert.ok(await getLocalMedia(first.id), 'but its bytes stay until the deletion has been sent')

  const deletion = (await db.changeEvents.where('familyTreeId').equals(tree.id).toArray()).find(
    (event) => event.entity === 'media' && event.entityId === first.id && event.op === 'delete',
  )
  assert.ok(deletion, 'and the removal travels, so other devices retire it too')

  // Once the tombstone has been accepted, the cleanup pass reclaims it.
  await db.outbox.clear()
  await syncMedia(tree.id, storage)
  assert.equal(storage.objects.has(mediaObjectPath(tree.id, first.id)), false, 'the object is reclaimed')
  assert.equal(await getLocalMedia(first.id), undefined, 'and so is the space on this device')

  assert.ok(
    storage.objects.has(mediaObjectPath(tree.id, replacement.id)),
    'while the photo they actually chose is untouched',
  )
  assert.ok(await getLocalMedia(replacement.id), 'and still on the device that chose it')
})

// ── two devices ─────────────────────────────────────────────────────

test('a photo added on one device reaches another and renders from cache', async () => {
  const { tree, grace } = await seed()
  const record = await attachPersonPhoto({ familyTreeId: tree.id, personId: grace.id, blob: bytes(32) })
  const storage = new FakeStorage()
  await syncMedia(tree.id, storage)

  // Device B: it has the metadata, through ordinary sync, and no bytes.
  const metadata = await db.media.get(record.id)
  const person = await db.people.get(grace.id)
  assert.ok(metadata && person)
  await db.delete()
  await db.open()
  await createFamilyTree({ name: 'Okafor Family' })
  await db.media.put(metadata)
  await db.people.put(person)

  assert.equal(await getLocalMedia(record.id), undefined, 'no bytes yet')

  await syncMedia(tree.id, storage, { downloadFor: [record.id] })
  const cached = await getLocalMedia(record.id)
  assert.ok(cached, 'the photograph arrived')
  assert.equal((await db.people.get(grace.id))?.profilePhotoId, record.id, 'and is their portrait here too')
})
