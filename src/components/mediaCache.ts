/**
 * "The photo cache changed" — Milestone 5.
 *
 * Split from PersonPhoto so that module exports only a component: mixing
 * a component with anything else breaks React fast refresh, the same
 * reason the icon set and the auth context live apart from theirs.
 *
 * One signal rather than fifty subscriptions. A tree of fifty cards each
 * watching the database for its own portrait would be fifty listeners
 * doing the same work; instead the media sync says "something arrived"
 * once, and every card waiting on bytes re-reads.
 */
const listeners = new Set<() => void>()

let generation = 0

export function mediaCacheGeneration(): number {
  return generation
}

export function onMediaCacheChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Called after newly downloaded or newly chosen photos have been stored. */
export function notifyMediaCacheChanged(): void {
  generation += 1
  listeners.forEach((listener) => listener())
}
