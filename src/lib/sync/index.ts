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
 * Phase 5B-1 adds attribution: events now carry the id of a device-local
 * actor (lib/identity/localActor) instead of a permanent null. That is a
 * name on this device, not an account — still no authentication, and
 * nothing here may be used to decide what anyone is allowed to do.
 *
 * Deliberately absent: any transport, adapter, authentication,
 * authorization, server sequence, or conflict resolution.
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
/**
 * Phase 5B-3. Pure and transport-free: it merges event streams and has no
 * idea where they came from. Nothing persists its output yet.
 */
export type {
  ConflictResolution,
  FieldConflict,
  ReconciledRecord,
  ReconciliationAnomaly,
  ReconciliationAnomalyKind,
  ReconciliationResult,
} from './reconciler'
export { changeSetsFrom, reconcileEvents } from './reconciler'
export { getOutboxEntries, getOutboxSize, getPendingChangeEvents } from './outbox'
export { ensureSyncState, getSyncState } from './syncState'
