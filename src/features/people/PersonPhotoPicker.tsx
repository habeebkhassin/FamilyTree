import { useRef, useState } from 'react'
import type { Person } from '../../types'
import { attachPersonPhoto, removePersonPhoto } from '../../lib/media/mediaStore'
import { notifyMediaCacheChanged } from '../../components/mediaCache'
import './PersonPhotoPicker.css'

/**
 * Choosing somebody's photograph — Milestone 5.
 *
 * Two words under the portrait and nothing else. This is a family tree,
 * not a photo manager: there is no gallery, no cropper and no album, and
 * adding one would be answering a question nobody looking at their
 * grandmother's record is asking.
 *
 * The picture appears as soon as the file is read. Nothing here waits for
 * a network, checks whether there is one, or fails because there is not —
 * uploading happens later, through the ordinary sync cycle, and the photo
 * is on the card either way.
 */
export function PersonPhotoPicker({
  person,
  onChanged,
}: {
  person: Person
  onChanged?: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choose = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      await attachPersonPhoto({
        familyTreeId: person.familyTreeId,
        personId: person.id,
        blob: file,
        title: file.name,
      })
      // Every card showing this person re-reads its portrait.
      notifyMediaCacheChanged()
      onChanged?.()
    } catch {
      setError('That photo could not be added. Please try another one.')
    } finally {
      setBusy(false)
      // Clearing it means picking the same file twice still counts.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const remove = async () => {
    setError(null)
    setBusy(true)
    try {
      await removePersonPhoto(person.familyTreeId, person.id)
      notifyMediaCacheChanged()
      onChanged?.()
    } catch {
      setError('That photo could not be removed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="photo-picker">
      <input
        ref={inputRef}
        id={`photo-${person.id}`}
        type="file"
        accept="image/*"
        className="photo-picker__input"
        onChange={(event) => void choose(event.target.files?.[0])}
      />
      <div className="photo-picker__actions">
        <button
          type="button"
          className="photo-picker__action"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? 'Adding…' : person.profilePhotoId ? 'Change photo' : 'Add a photo'}
        </button>
        {person.profilePhotoId && (
          <button
            type="button"
            className="photo-picker__action photo-picker__action--remove"
            disabled={busy}
            onClick={() => void remove()}
          >
            Remove
          </button>
        )}
      </div>
      {error && (
        <p className="photo-picker__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
