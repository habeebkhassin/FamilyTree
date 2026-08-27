/**
 * Backup and restore — Phase A.
 *
 * A family tree, whole, in a file somebody can keep. It is the safety net
 * the cloud migration will need before it moves anything, and it is useful
 * on its own long before that: this is currently the only way a family's
 * history can leave one browser.
 *
 * Local-first and offline. No network, no account, no vendor.
 */
export {
  BACKUP_COLLECTIONS,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type BackupCollection,
  type BackupData,
  type BackupMediaRecord,
  type TreeBackup,
} from './backupTypes'
export { backupFilename, exportFamilyTree, serialiseBackup } from './exportTree'
export { BackupError, importFamilyTree, parseBackup, type ImportResult } from './importTree'
