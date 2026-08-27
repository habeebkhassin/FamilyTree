import { useRef, useState } from 'react'
import { Button } from '../../components/Button'
import {
  backupFilename,
  BackupError,
  exportFamilyTree,
  importFamilyTree,
  parseBackup,
  serialiseBackup,
} from '../../lib/backup'
import type { FamilyTree } from '../../types'
import './BackupActions.css'

/**
 * Saving a family tree to a file, and reading one back — Phase A.
 *
 * Kept deliberately small: two buttons and a line of feedback. This is
 * currently the only way a family's history can leave this browser, so it
 * belongs somewhere ordinary rather than behind a settings screen nobody
 * opens.
 *
 * Importing never touches the tree on screen. It adds a new one, and
 * refuses outright if a tree with the same id is already here — restoring
 * over live data is a decision that needs its own deliberate flow, not a
 * side effect of choosing a file.
 */
export function BackupActions({
  tree,
  onImported,
}: {
  tree: FamilyTree
  onImported: (familyTreeId: string) => void
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  async function handleExport() {
    setBusy(true)
    setMessage(null)
    try {
      const backup = await exportFamilyTree(tree.id)
      const blob = new Blob([serialiseBackup(backup)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = backupFilename(backup)
      link.click()
      // Revoked on the next tick rather than immediately: the click is
      // handled asynchronously, and freeing the url first cancels it.
      setTimeout(() => URL.revokeObjectURL(url), 0)

      const people = backup.counts.people
      setMessage({
        tone: 'ok',
        text:
          `Saved ${people} ${people === 1 ? 'person' : 'people'} and ${backup.counts.changeEvents} recorded changes.` +
          (backup.mediaBlobsExcluded > 0
            ? ` ${backup.mediaBlobsExcluded} photo files were not included.`
            : ''),
      })
    } catch (error) {
      setMessage({ tone: 'error', text: describe(error) })
    } finally {
      setBusy(false)
    }
  }

  async function handleFile(file: File) {
    setBusy(true)
    setMessage(null)
    try {
      // Parsed and checked completely before anything is written; a file
      // that is not a backup never reaches the database.
      const backup = parseBackup(await file.text())
      const result = await importFamilyTree(backup)
      setMessage({
        tone: 'ok',
        text: `Restored "${result.familyTreeName}" with ${result.counts.people} people.`,
      })
      onImported(result.familyTreeId)
    } catch (error) {
      setMessage({ tone: 'error', text: describe(error) })
    } finally {
      setBusy(false)
      // Cleared so choosing the same file again still fires a change.
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <div className="backup">
      <div className="backup__actions">
        <Button variant="secondary" onClick={() => void handleExport()} disabled={busy}>
          Save a backup
        </Button>
        <Button
          variant="secondary"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
        >
          Restore from a backup
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="backup__file"
          onChange={(changeEvent) => {
            const file = changeEvent.target.files?.[0]
            if (file) void handleFile(file)
          }}
        />
      </div>
      {message && (
        <p
          className={message.tone === 'error' ? 'backup__message backup__message--error' : 'backup__message'}
          role="status"
        >
          {message.text}
        </p>
      )}
    </div>
  )
}

/** A BackupError already reads as a sentence; anything else gets a plain one. */
function describe(error: unknown): string {
  if (error instanceof BackupError) return error.message
  return 'Something went wrong, and nothing was changed.'
}
