import type {
  FamilyGroup,
  FamilyGroupMember,
  FamilyTree,
  MediaRecord,
  ParentLink,
  Person,
  Union,
} from '../../types'
import type { ChangeEvent, OutboxEntry, SyncState } from '../sync'
import type {
  FamilyTreeMember,
  GovernanceConfig,
  Invitation,
  PersonClaim,
} from '../policy/membershipTypes'

/**
 * The backup file format — Phase A.
 *
 * One file holds exactly ONE family tree, and everything in the database
 * that belongs to it. It exists for two jobs that turn out to be the same
 * job: a backup somebody can keep, and the input to cloud adoption later.
 * Both need the same thing — a complete, faithful, self-describing copy
 * that can be checked before anything is written.
 *
 * Nothing here changes the Dexie schema. This is a projection of it.
 */

/** Distinguishes our file from any other JSON somebody might open. */
export const BACKUP_FORMAT = 'familytree.backup' as const

/**
 * Bumped when the SHAPE of this file changes incompatibly.
 *
 * Separate from `schemaVersion` on purpose: the database schema can move
 * without the file format moving, and a file written today has to stay
 * readable after it does.
 */
export const BACKUP_VERSION = 1 as const

/**
 * A media record as it travels in a backup.
 *
 * Since Milestone 5 a MediaRecord IS metadata — the bytes live in a
 * local-only table and in object storage — so there is nothing left to
 * strip and this is the record itself. The backup contract is unchanged:
 * descriptions travel, bytes do not, and `mediaBlobsExcluded` still says
 * plainly how many were left behind.
 *
 * The alias is kept rather than replaced by MediaRecord everywhere,
 * because a file written under the old shape must still read, and this is
 * where a future difference between the two would be expressed.
 */
export type BackupMediaRecord = MediaRecord

/**
 * Every store row that belongs to one tree.
 *
 * Named per store rather than lumped into a generic bag so that adding a
 * table to the database is a type error here until somebody decides
 * whether it belongs in a backup.
 */
export interface BackupData {
  familyTree: FamilyTree
  people: Person[]
  parentLinks: ParentLink[]
  unions: Union[]
  media: BackupMediaRecord[]
  familyGroups: FamilyGroup[]
  familyGroupMembers: FamilyGroupMember[]
  /**
   * The full history. This is what makes a backup usable for cloud
   * adoption rather than only for restore — the events are the tree's
   * audit trail and, later, its sync feed.
   */
  changeEvents: ChangeEvent[]
  /** Device-local: which events had not been uploaded yet. */
  outbox: OutboxEntry[]
  /** Device-local: how far this tree had synced. Null if it never had. */
  syncState: SyncState | null
  /**
   * Governance travels with the tree so a restore is a restore, not a
   * tree with its roles missing. It stays what it already is — a record
   * of local decisions, never a security boundary. A server, when one
   * exists, must re-establish all of this itself and must not trust a
   * file for it.
   */
  familyTreeMembers: FamilyTreeMember[]
  personClaims: PersonClaim[]
  invitations: Invitation[]
  governance: GovernanceConfig | null
}

/** The store names carried in a backup, in a stable order. */
export const BACKUP_COLLECTIONS = [
  'people',
  'parentLinks',
  'unions',
  'media',
  'familyGroups',
  'familyGroupMembers',
  'changeEvents',
  'outbox',
  'familyTreeMembers',
  'personClaims',
  'invitations',
] as const

export type BackupCollection = (typeof BACKUP_COLLECTIONS)[number]

export interface TreeBackup {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  /** Client clock, for the reader's benefit. Never used for ordering. */
  exportedAt: string
  /**
   * The Dexie version the data was read from. Recorded so a future import
   * can tell whether it is reading something older than itself, without
   * having to infer it from the shape.
   */
  schemaVersion: number
  /** Denormalised so a reader can identify the tree without parsing `data`. */
  familyTreeId: string
  familyTreeName: string
  /**
   * Row counts per collection, written at export time.
   *
   * A manifest, not decoration: import verifies the arrays against it
   * before touching the database, so a file truncated in transit is caught
   * rather than silently restored as a smaller tree.
   */
  counts: Record<BackupCollection, number>
  /** How many media blobs this file does NOT contain. See BackupMediaRecord. */
  mediaBlobsExcluded: number
  data: BackupData
}
