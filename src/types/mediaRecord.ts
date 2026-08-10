export type MediaKind = 'photo' | 'audio' | 'video' | 'story' | 'event'

/**
 * Binary/narrative content lives here, never inline on Person — a Person
 * only ever holds a profilePhotoId pointing at a record in this store.
 */
export interface MediaRecord {
  id: string
  familyTreeId: string
  kind: MediaKind
  blob?: Blob
  title?: string
  body?: string
  date?: string
  personIds: string[]
  createdAt: string
  updatedAt: string
}
