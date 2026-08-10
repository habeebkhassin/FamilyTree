import { db } from './db'
import type { MediaRecord } from '../../types'

export type CreateMediaRecordInput = Omit<MediaRecord, 'id' | 'createdAt' | 'updatedAt'>

export async function createMediaRecord(input: CreateMediaRecordInput): Promise<MediaRecord> {
  const now = new Date().toISOString()
  const media: MediaRecord = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
  await db.media.add(media)
  return media
}

export function getMediaRecord(id: string): Promise<MediaRecord | undefined> {
  return db.media.get(id)
}

export function getMediaByTree(familyTreeId: string): Promise<MediaRecord[]> {
  return db.media.where('familyTreeId').equals(familyTreeId).toArray()
}

export function getMediaForPerson(personId: string): Promise<MediaRecord[]> {
  return db.media.where('personIds').equals(personId).toArray()
}

export async function updateMediaRecord(
  id: string,
  changes: Partial<Omit<MediaRecord, 'id' | 'familyTreeId' | 'createdAt' | 'updatedAt'>>,
): Promise<void> {
  await db.media.update(id, { ...changes, updatedAt: new Date().toISOString() })
}

export function deleteMediaRecord(id: string): Promise<void> {
  return db.media.delete(id)
}
