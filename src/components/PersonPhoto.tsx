import { useEffect, useState } from 'react'
import type { Person } from '../types'
import { getMediaRecord } from '../lib/storage/media'
import { Avatar } from './Avatar'
import './PersonPhoto.css'

/**
 * A person's portrait, or their initials.
 *
 * The photo is real: a Person carries `profilePhotoId`, which points at a
 * MediaRecord holding the bytes, and this resolves that pointer through
 * the existing storage API. Nothing is invented — a person with no photo
 * gets the Avatar that has always stood in for one, and a pointer that no
 * longer resolves falls back to exactly the same thing rather than
 * showing a broken frame.
 *
 * There is no way to ADD a photo in the application yet, so in practice
 * most families will see initials everywhere. That is the honest state of
 * it: this is the read path, built so that the day photos can be added
 * they appear here without anything else changing.
 */

/**
 * Object URLs live as long as the document unless revoked, and a fifty
 * person tree would otherwise mint fifty of them on every re-render. One
 * URL per media record, shared by every card showing it.
 */
const urlByMediaId = new Map<string, string>()

/** Ids that resolved to no record, or to a record with no bytes. */
const missingMediaIds = new Set<string>()

async function loadPhotoUrl(mediaId: string): Promise<string | null> {
  const cached = urlByMediaId.get(mediaId)
  if (cached) return cached
  if (missingMediaIds.has(mediaId)) return null

  const record = await getMediaRecord(mediaId)
  if (!record?.blob) {
    missingMediaIds.add(mediaId)
    return null
  }

  // Re-check: two cards mounting together can both miss the cache.
  const raced = urlByMediaId.get(mediaId)
  if (raced) return raced

  const url = URL.createObjectURL(record.blob)
  urlByMediaId.set(mediaId, url)
  return url
}

export function PersonPhoto({
  person,
  size = 48,
  className,
}: {
  person: Pick<Person, 'firstName' | 'lastName' | 'profilePhotoId'>
  size?: number
  className?: string
}) {
  const fullName = [person.firstName, person.lastName].filter(Boolean).join(' ')
  const mediaId = person.profilePhotoId
  const [url, setUrl] = useState<string | null>(() => (mediaId ? (urlByMediaId.get(mediaId) ?? null) : null))

  useEffect(() => {
    if (!mediaId) {
      setUrl(null)
      return
    }
    let cancelled = false
    void loadPhotoUrl(mediaId).then((resolved) => {
      if (!cancelled) setUrl(resolved)
    })
    return () => {
      cancelled = true
    }
  }, [mediaId])

  if (!url) return <Avatar name={fullName} size={size} />

  return (
    <img
      className={['person-photo', className].filter(Boolean).join(' ')}
      src={url}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
      /* A file that decodes to nothing should look like no photo, not
         like a failure. */
      onError={() => setUrl(null)}
    />
  )
}
