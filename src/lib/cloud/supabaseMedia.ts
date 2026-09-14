import { MEDIA_BUCKET } from '../media/mediaTypes'
import type { MediaTransport } from '../media/mediaTransport'
import { getSupabaseClient } from './supabaseClient'

/**
 * Photograph bytes, through Supabase Storage — Milestone 5.
 *
 * The bucket is private. There is no public URL for a family's
 * photographs and this file never asks for one: reads go through the
 * authenticated client, which carries the caller's token, and the storage
 * policies in migration 0004 decide what comes back by joining the
 * object's own path to tree membership.
 *
 * `upsert` is on for uploads, and that is the point rather than a
 * convenience: the path is derived from the tree and media ids, so a
 * retry after a timeout writes the same bytes to the same object instead
 * of leaving a second copy nobody references.
 */
export class SupabaseMediaTransport implements MediaTransport {
  async upload(path: string, blob: Blob, contentType: string): Promise<void> {
    const client = await getSupabaseClient()
    const { error } = await client.storage.from(MEDIA_BUCKET).upload(path, blob, {
      contentType,
      upsert: true,
    })
    if (error) throw new Error(error.message)
  }

  async download(path: string): Promise<Blob | null> {
    const client = await getSupabaseClient()
    const { data, error } = await client.storage.from(MEDIA_BUCKET).download(path)
    if (error) {
      // Absent is an answer, not a failure — a record whose bytes have
      // not been uploaded yet is an ordinary state. Anything else is a
      // real problem and must stay one, so the queue does not record
      // progress it never made.
      if (/not found|does not exist/i.test(error.message)) return null
      throw new Error(error.message)
    }
    return data ?? null
  }

  async remove(path: string): Promise<void> {
    const client = await getSupabaseClient()
    const { error } = await client.storage.from(MEDIA_BUCKET).remove([path])
    // Removing something already gone is what a retried cleanup does.
    if (error && !/not found|does not exist/i.test(error.message)) {
      throw new Error(error.message)
    }
  }
}
