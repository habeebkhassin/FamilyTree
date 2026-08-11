/**
 * The local change-log foundation — Phase 5A.
 *
 * Sits BENEATH the storage API, not beside it. Features call
 * `createPerson`/`updatePerson`/... exactly as before; those functions
 * write the record and append the event in one transaction. No React
 * component, hook, or derived-genealogy module imports anything from here,
 * and none of them should: relationshipResolver, groupProjection, rank,
 * layout and graphAdapter keep working from plain record snapshots, which
 * is what will let them run unchanged against synced data later.
 *
 * Deliberately absent in 5A: any transport, adapter, authentication,
 * server sequence, or conflict resolution.
 */
export type {
  ChangeEvent,
  ChangeOperation,
  NewChangeEvent,
  OutboxEntry,
  SyncEntity,
  SyncRecord,
  SyncState,
} from './changeTypes'
export {
  getChangeEvent,
  getChangeEvents,
  getChangeEventsForEntity,
  getChangeSet,
  getRecentChangeEvents,
  recordChange,
} from './changeLog'
export { currentChangeSetId } from './changeSet'
export { getOutboxEntries, getOutboxSize, getPendingChangeEvents } from './outbox'
export { ensureSyncState, getSyncState } from './syncState'
