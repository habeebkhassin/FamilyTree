import { test } from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'

import { db } from '../storage/db'
import {
  createFamilyTree,
  createPerson,
  createParentLink,
  createUnion,
  createFamilyGroup,
  addFamilyGroupMember,
  deletePerson,
} from '../storage'
import { getChangeEvents } from '../sync'
import {
  BACKUP_COLLECTIONS,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BackupError,
  backupFilename,
  exportFamilyTree,
  importFamilyTree,
  parseBackup,
  serialiseBackup,
} from './index'

/**
 * Round-tripping a family — Phase A.
 *
 * The test that matters is the third one: export a tree, remove every
 * trace of it, read the file back, and find the same records with the same
 * ids. Everything else here exists to make sure that test cannot pass by
 * accident, or pass while quietly damaging something else.
 */

/**
 * Compares the way the backup format can actually represent things.
 *
 * `undefined` is not a JSON value, so an optional field left unset — a
 * tree with no description, say — is stored by Dexie as a present key
 * holding undefined and comes back from a file as an absent key. Reads are
 * identical either way, and asserting that JSON preserves `undefined`
 * would be asserting something impossible. Everything else still has to
 * match exactly, which is what this keeps.
 */
function sameThroughJson(actual: unknown, expected: unknown, message: string): void {
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), message)
}

/** Deletes everything, so each test starts from a genuinely empty database. */
async function resetDatabase(): Promise<void> {
  await Promise.all(db.tables.map((table) => table.clear()))
}

/**
 * A tree with something of everything a backup has to carry: people,
 * both kinds of relationship, a family group with members, and a
 * tombstoned person so deleted records and their events are covered.
 */
async function seedTree(name: string) {
  const tree = await createFamilyTree({ name })
  const gran = await createPerson({ familyTreeId: tree.id, firstName: 'Rose', lastName: 'Hale', gender: 'female' })
  const grandad = await createPerson({ familyTreeId: tree.id, firstName: 'Albert', lastName: 'Hale', gender: 'male' })
  const child = await createPerson({ familyTreeId: tree.id, firstName: 'Martha', lastName: 'Hale', gender: 'female' })
  const removed = await createPerson({ familyTreeId: tree.id, firstName: 'Gone', lastName: 'Hale', gender: 'unknown' })

  await createUnion({ familyTreeId: tree.id, partnerAId: gran.id, partnerBId: grandad.id, status: 'married' })
  await createParentLink({ familyTreeId: tree.id, parentId: gran.id, childId: child.id, relationship: 'biological' })
  await createParentLink({ familyTreeId: tree.id, parentId: grandad.id, childId: child.id, relationship: 'biological' })

  const group = await createFamilyGroup({ familyTreeId: tree.id, name: 'The Hales', establishedPrecision: 'unknown' })
  await addFamilyGroupMember({ familyTreeId: tree.id, familyGroupId: group.id, personId: gran.id })
  await addFamilyGroupMember({ familyTreeId: tree.id, familyGroupId: group.id, personId: grandad.id })

  // A tombstone, so the backup has to carry a deleted record and the
  // events that describe its deletion.
  await deletePerson(removed.id)

  return { tree, gran, grandad, child, removed, group }
}

// ── the shape of a backup ────────────────────────────────────────────

test('1. a backup names itself, its version and its tree', async () => {
  await resetDatabase()
  const { tree } = await seedTree('Hale Family')
  const backup = await exportFamilyTree(tree.id)

  assert.equal(backup.format, BACKUP_FORMAT)
  assert.equal(backup.version, BACKUP_VERSION)
  assert.equal(backup.familyTreeId, tree.id)
  assert.equal(backup.familyTreeName, 'Hale Family')
  assert.ok(backup.schemaVersion > 0, 'records which database version it came from')
  assert.ok(Date.parse(backup.exportedAt) > 0)
})

test('2. the manifest matches what the file actually contains', async () => {
  await resetDatabase()
  const { tree } = await seedTree('Hale Family')
  const backup = await exportFamilyTree(tree.id)

  for (const name of BACKUP_COLLECTIONS) {
    assert.equal(
      backup.data[name].length,
      backup.counts[name],
      name + ' count must match the manifest',
    )
  }
  assert.ok(backup.counts.people === 4, 'including the tombstoned person')
  assert.ok(backup.counts.changeEvents > 0, 'history travels with the tree')
})

// ── the one that matters ─────────────────────────────────────────────

test('3. export, wipe, import — same records, same ids, same events', async () => {
  await resetDatabase()
  const { tree } = await seedTree('Hale Family')

  const before = {
    tree: await db.familyTrees.get(tree.id),
    people: await db.people.where('familyTreeId').equals(tree.id).toArray(),
    parentLinks: await db.parentLinks.where('familyTreeId').equals(tree.id).toArray(),
    unions: await db.unions.where('familyTreeId').equals(tree.id).toArray(),
    groups: await db.familyGroups.where('familyTreeId').equals(tree.id).toArray(),
    groupMembers: await db.familyGroupMembers.where('familyTreeId').equals(tree.id).toArray(),
    events: await getChangeEvents(tree.id),
    outbox: await db.outbox.where('familyTreeId').equals(tree.id).toArray(),
  }

  // Through a real string, so anything JSON cannot represent is caught
  // here rather than surviving as an in-memory object reference.
  const text = serialiseBackup(await exportFamilyTree(tree.id))

  await resetDatabase()
  assert.equal(await db.familyTrees.get(tree.id), undefined, 'the tree is genuinely gone')

  const result = await importFamilyTree(parseBackup(text))
  assert.equal(result.familyTreeId, tree.id)

  const after = {
    tree: await db.familyTrees.get(tree.id),
    people: await db.people.where('familyTreeId').equals(tree.id).toArray(),
    parentLinks: await db.parentLinks.where('familyTreeId').equals(tree.id).toArray(),
    unions: await db.unions.where('familyTreeId').equals(tree.id).toArray(),
    groups: await db.familyGroups.where('familyTreeId').equals(tree.id).toArray(),
    groupMembers: await db.familyGroupMembers.where('familyTreeId').equals(tree.id).toArray(),
    events: await getChangeEvents(tree.id),
    outbox: await db.outbox.where('familyTreeId').equals(tree.id).toArray(),
  }

  sameThroughJson(after.tree, before.tree, 'the family tree record itself')

  const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort()
  for (const key of ['people', 'parentLinks', 'unions', 'groups', 'groupMembers'] as const) {
    assert.equal(after[key].length, before[key].length, key + ' count')
    assert.deepEqual(ids(after[key]), ids(before[key]), key + ' ids are preserved exactly')
    sameThroughJson(
      [...after[key]].sort((a, b) => a.id.localeCompare(b.id)),
      [...before[key]].sort((a, b) => a.id.localeCompare(b.id)),
      key + ' contents are identical',
    )
  }

  assert.equal(after.events.length, before.events.length, 'event count')
  assert.deepEqual(
    after.events.map((e) => e.id),
    before.events.map((e) => e.id),
    'event ids are preserved, in the same order',
  )
  assert.deepEqual(
    after.outbox.map((o) => o.eventId).sort(),
    before.outbox.map((o) => o.eventId).sort(),
    'the pending-upload queue survives',
  )

  // The tombstone came back as a tombstone, not as a living person.
  assert.equal(after.people.filter((p) => p.deletedAt).length, 1)
})

test('4. a restored event keeps its identity even though clientSeq is reassigned', async () => {
  await resetDatabase()
  const { tree } = await seedTree('Hale Family')
  const before = await getChangeEvents(tree.id)
  const text = serialiseBackup(await exportFamilyTree(tree.id))

  await resetDatabase()
  await importFamilyTree(parseBackup(text))
  const after = await getChangeEvents(tree.id)

  for (let i = 0; i < before.length; i += 1) {
    const b = before[i] as (typeof before)[number]
    const a = after[i] as (typeof after)[number]
    assert.equal(a.id, b.id, 'id is the identity and is preserved')
    assert.equal(a.entity, b.entity)
    assert.equal(a.entityId, b.entityId)
    assert.equal(a.op, b.op)
    assert.equal(a.changeSetId, b.changeSetId, 'change sets stay grouped')
    assert.equal(a.actorId, b.actorId, 'attribution is not rewritten')
    assert.equal(a.createdAt, b.createdAt)
    assert.equal(a.serverSeq, null, 'nothing invents a server sequence')
    assert.equal(a.recordedAt, null)
    sameThroughJson(a.before, b.before, 'complete snapshots survive JSON')
    sameThroughJson(a.after, b.after, 'complete snapshots survive JSON')
  }
  // clientSeq orders events from one device; on a different database it is
  // reassigned, and the relative order is what has to hold.
  const seqs = after.map((e) => e.clientSeq)
  assert.deepEqual(seqs, [...seqs].sort((x, y) => x - y), 'still ascending')
})

// ── one tree, and only one tree ──────────────────────────────────────

test('5. exporting one tree never picks up another tree’s records', async () => {
  await resetDatabase()
  const mine = await seedTree('Mine')
  const theirs = await seedTree('Theirs')

  const backup = await exportFamilyTree(mine.tree.id)
  const otherIds = new Set([
    theirs.tree.id, theirs.gran.id, theirs.grandad.id, theirs.child.id, theirs.group.id,
  ])

  for (const name of BACKUP_COLLECTIONS) {
    for (const row of backup.data[name] as { id?: string; familyTreeId?: string }[]) {
      assert.equal(row.familyTreeId, mine.tree.id, name + ' belongs to the exported tree')
      if (row.id) assert.ok(!otherIds.has(row.id), name + ' must not contain the other tree')
    }
  }
  assert.equal(backup.data.familyTree.id, mine.tree.id)
})

test('6. importing one tree leaves an unrelated tree untouched', async () => {
  await resetDatabase()
  const mine = await seedTree('Mine')
  const text = serialiseBackup(await exportFamilyTree(mine.tree.id))

  await resetDatabase()
  const theirs = await seedTree('Theirs')
  const theirPeopleBefore = await db.people.where('familyTreeId').equals(theirs.tree.id).toArray()
  const theirEventsBefore = await getChangeEvents(theirs.tree.id)

  await importFamilyTree(parseBackup(text))

  assert.deepEqual(
    await db.people.where('familyTreeId').equals(theirs.tree.id).toArray(),
    theirPeopleBefore,
    'the other tree’s people are exactly as they were — untouched, so not via JSON',
  )
  assert.deepEqual(
    (await getChangeEvents(theirs.tree.id)).map((e) => e.id),
    theirEventsBefore.map((e) => e.id),
    'and so is its history',
  )
  assert.ok(await db.familyTrees.get(mine.tree.id), 'while the imported tree is present')
})

// ── refusing to do damage ────────────────────────────────────────────

test('7. importing a tree that already exists is refused, and changes nothing', async () => {
  await resetDatabase()
  const { tree } = await seedTree('Hale Family')
  const text = serialiseBackup(await exportFamilyTree(tree.id))

  const peopleBefore = await db.people.where('familyTreeId').equals(tree.id).toArray()
  const eventsBefore = await getChangeEvents(tree.id)

  await assert.rejects(
    () => importFamilyTree(parseBackup(text)),
    (error: unknown) => error instanceof BackupError && /already on this device/.test((error as Error).message),
    'refuses rather than overwriting',
  )

  assert.deepEqual(await db.people.where('familyTreeId').equals(tree.id).toArray(), peopleBefore)
  assert.deepEqual((await getChangeEvents(tree.id)).map((e) => e.id), eventsBefore.map((e) => e.id))
})

test('8. a file that is not a backup is rejected before anything is written', async () => {
  await resetDatabase()
  for (const junk of ['not json at all', '{}', '[]', '{"format":"something.else","version":1}']) {
    assert.throws(() => parseBackup(junk), BackupError, 'rejected: ' + junk)
  }
  assert.equal((await db.familyTrees.toArray()).length, 0, 'the database was never touched')
})

test('9. a backup from a future format version is refused', async () => {
  await resetDatabase()
  const { tree } = await seedTree('Hale Family')
  const backup = await exportFamilyTree(tree.id)
  const future = { ...backup, version: BACKUP_VERSION + 1 }

  assert.throws(
    () => parseBackup(JSON.stringify(future)),
    (error: unknown) => error instanceof BackupError && /version/.test((error as Error).message),
  )
})

test('10. a truncated backup is caught by its own manifest', async () => {
  await resetDatabase()
  const { tree } = await seedTree('Hale Family')
  const backup = await exportFamilyTree(tree.id)

  // The manifest still claims the original count; the rows do not.
  const truncated = {
    ...backup,
    data: { ...backup.data, people: backup.data.people.slice(0, 2) },
  }

  assert.throws(
    () => parseBackup(JSON.stringify(truncated)),
    (error: unknown) => error instanceof BackupError && /incomplete/.test((error as Error).message),
  )
})

test('11. a backup carrying another tree’s rows is refused', async () => {
  await resetDatabase()
  const mine = await seedTree('Mine')
  const theirs = await seedTree('Theirs')

  const backup = await exportFamilyTree(mine.tree.id)
  const theirPeople = await db.people.where('familyTreeId').equals(theirs.tree.id).toArray()
  const contaminated = {
    ...backup,
    counts: { ...backup.counts, people: backup.counts.people + 1 },
    data: { ...backup.data, people: [...backup.data.people, theirPeople[0]!] },
  }

  assert.throws(
    () => parseBackup(JSON.stringify(contaminated)),
    (error: unknown) => error instanceof BackupError && /different family tree/.test((error as Error).message),
  )
})

test('12. a failure part-way through an import leaves nothing behind', async () => {
  await resetDatabase()
  const { tree } = await seedTree('Hale Family')
  const backup = await exportFamilyTree(tree.id)
  await resetDatabase()

  // Two people sharing an id. The first insert succeeds, the second
  // violates the primary key, and the transaction must take the first one
  // back out with it.
  const duplicated = structuredClone(backup)
  duplicated.data.people = [...duplicated.data.people, duplicated.data.people[0]!]
  duplicated.counts.people += 1

  await assert.rejects(() => importFamilyTree(parseBackup(JSON.stringify(duplicated))))

  assert.equal(await db.familyTrees.get(tree.id), undefined, 'no family tree record')
  assert.equal((await db.people.toArray()).length, 0, 'no people')
  assert.equal((await db.changeEvents.toArray()).length, 0, 'no events')
  assert.equal((await db.familyGroups.toArray()).length, 0, 'no groups')
})

// ── the file a person keeps ──────────────────────────────────────────

test('13. the filename is readable and dated', async () => {
  await resetDatabase()
  const { tree } = await seedTree('The Hale Family!')
  const backup = await exportFamilyTree(tree.id)
  const name = backupFilename(backup)

  assert.match(name, /^the-hale-family-backup-\d{4}-\d{2}-\d{2}\.json$/)
})

test('14. exporting a tree that does not exist fails loudly', async () => {
  await resetDatabase()
  await assert.rejects(() => exportFamilyTree('no-such-tree'), /no family tree with id/)
})
