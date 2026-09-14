import { useEffect, useState } from 'react'
import type { Person } from '../types'
import { getLocalMedia } from '../lib/media/mediaStore'
import { mediaCacheGeneration, onMediaCacheChanged } from './mediaCache'
import { Avatar } from './Avatar'
import './PersonPhoto.css'

/**
 * A person's portrait, or their initials.
 *
 * The photo is real: a Person carries `profilePhotoId`, which names a
 * MediaRecord, whose bytes are in this device's media cache. A person
 * with no photo gets the Avatar that has always stood in for one, and a
 * pointer whose bytes are not here yet gets the same thing rather than a
 * broken frame — so a card is never empty while a download is in flight.
 *
 * DELIBERATELY DOES NOT FETCH. A component that downloaded on mount would
 * make drawing a fifty-person tree fifty requests, and would do it again
 * on every pan. Fetching is the sync cycle's job, which asks for the
 * portraits the visible tree actually needs and caches them here; this
 * reads what is already local and re-reads when that changes.
 */

/**
 * Object URLs live as long as the document unless revoked, and a
 * fifty-person tree would otherwise mint fifty on every re-render. One
 * per media record, shared by every card showing it.
 */
const urlByMediaId = new Map<string, string>()

/** Ids with no bytes on this device. Re-checked when the cache changes. */
const missingMediaIds = new Set<string>()

async function loadPhotoUrl(mediaId: string): Promise<string | null> {
  const cached = urlByMediaId.get(mediaId)
  if (cached) return cached
  if (missingMediaIds.has(mediaId)) return null

  const stored = await getLocalMedia(mediaId)
  // The small copy is what a card wants; the original is only worth
  // decoding when somebody is actually looking at the photograph.
  const bytes = stored?.thumbnail ?? stored?.blob
  if (!bytes) {
    missingMediaIds.add(mediaId)
    return null
  }

  // Re-check: two cards mounting together can both miss the cache.
  const raced = urlByMediaId.get(mediaId)
  if (raced) return raced

  const url = URL.createObjectURL(bytes)
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
  const [url, setUrl] = useState<string | null>(() =>
    mediaId ? (urlByMediaId.get(mediaId) ?? null) : null,
  )
  const [generation, setGeneration] = useState(mediaCacheGeneration)

  useEffect(
    () =>
      onMediaCacheChanged(() => {
        // Something arrived, so a portrait that had nothing to show may
        // now have something.
        missingMediaIds.clear()
        setGeneration(mediaCacheGeneration())
      }),
    [],
  )

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
  }, [mediaId, generation])

  if (!url) return <Avatar name={fullName} size={size} />

  return (
    <img
      className={['person-photo', className].filter(Boolean).join(' ')}
      src={url}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
      // A file that decodes to nothing should look like no photo, not
      // like a failure.
      onError={() => setUrl(null)}
      loading="lazy"
    />
  )
}
