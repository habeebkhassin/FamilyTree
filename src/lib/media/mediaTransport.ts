/**
 * The bytes, to and from object storage — Milestone 5.
 *
 * A seam beside the others, naming no vendor, so the upload queue and the
 * download cache are testable with no network and no bucket.
 *
 * Two operations and no more. Everything about WHEN to call them lives in
 * mediaSync; everything about who may is enforced by the storage policies
 * in migration 0004, which check membership through the same
 * `is_tree_member` the rest of the schema uses. A path pointing at
 * another family's folder is refused there, not here.
 */
export interface MediaTransport {
  /**
   * Put an object at a path. Overwriting is expected, not exceptional:
   * the path is derived from ids, so a retry after a timeout writes the
   * same bytes to the same place rather than making a second copy.
   */
  upload(path: string, blob: Blob, contentType: string): Promise<void>
  /** Fetch an object. Resolves null when it is simply not there. */
  download(path: string): Promise<Blob | null>
  /** Remove an object. Removing one that is already gone is not an error. */
  remove(path: string): Promise<void>
}

/**
 * The transport for having no cloud.
 *
 * A sibling of NullRemoteAdapter, NoAuthClient and the rest: it is what
 * the application genuinely runs on with nothing configured. Uploading
 * refuses rather than pretending, so a queue can never record a photo as
 * safely stored when it is only on this device.
 */
export class NoMediaTransport implements MediaTransport {
  async upload(_path: string, _blob: Blob, _contentType: string): Promise<void> {
    throw new Error('This copy of FamilyTree has no cloud configured, so photos stay on this device.')
  }

  async download(_path: string): Promise<Blob | null> {
    return null
  }

  async remove(_path: string): Promise<void> {
    // Nothing stored, nothing to remove. Not a failure.
  }
}
