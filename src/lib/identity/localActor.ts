/**
 * Device-local identity — Phase 5B-1.
 *
 * A LocalActor is a name someone typed on this device. There is no
 * password, no email, no verification and no server: it exists so the
 * change log can say WHO made an edit instead of recording `null` forever,
 * and so a shared family tablet can distinguish two people using it.
 *
 * ATTRIBUTION, NOT AUTHENTICATION. A self-asserted name proves nothing.
 * Nothing in this module may ever be used to decide what someone is
 * ALLOWED to do — that requires a server, and a client that decides its own
 * permissions is a client that grants itself permissions. Authorization is
 * Phase 5B-2 onward and is enforced by the backend when one exists.
 *
 * A LocalActor is also NOT a user account. When accounts arrive, an actor
 * is LINKED to one rather than replaced, so past events keep their
 * attribution and no history is rewritten.
 */

export interface LocalActor {
  /** Stable client-generated uuid. Written into ChangeEvent.actorId. */
  id: string
  /** Whatever the person typed. Free text, no uniqueness guarantee. */
  displayName: string
  createdAt: string
}

/**
 * One key holding one document.
 *
 * The roster and the current selection are stored together so they are
 * written atomically — two keys could desync into "current actor points at
 * an actor that isn't in the list", which would silently break attribution.
 */
const STORAGE_KEY = 'familytree.localIdentity'

/** Name used when an actor has to be created without anyone to ask. */
const DEFAULT_DISPLAY_NAME = 'This device'

interface LocalIdentityStore {
  actors: LocalActor[]
  currentActorId: string | null
}

const EMPTY: LocalIdentityStore = { actors: [], currentActorId: null }

/**
 * There is deliberately NO module-level cache.
 *
 * All state lives in localStorage, which makes "survives a reload" a
 * property of the design rather than something that has to be maintained,
 * and removes any chance of an in-memory copy drifting from the stored one
 * after an actor switch.
 */
function storage(): Storage | null {
  try {
    // Absent in Node (tests shim it) and can throw on access in some
    // privacy modes, which is why this is guarded rather than assumed.
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function isActor(value: unknown): value is LocalActor {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.displayName === 'string' &&
    typeof candidate.createdAt === 'string'
  )
}

/**
 * Never throws. Corrupt or foreign data reads as "no identity yet", which
 * degrades to unattributed events rather than to a broken application.
 */
function read(): LocalIdentityStore {
  const store = storage()
  if (!store) return EMPTY

  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return EMPTY

    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return EMPTY

    const { actors, currentActorId } = parsed as Record<string, unknown>
    const validActors = Array.isArray(actors) ? actors.filter(isActor) : []

    // A dangling selection is downgraded to "none" rather than trusted;
    // ensureCurrentLocalActor will then pick or create a real one.
    const selected =
      typeof currentActorId === 'string' && validActors.some((actor) => actor.id === currentActorId)
        ? currentActorId
        : null

    return { actors: validActors, currentActorId: selected }
  } catch {
    return EMPTY
  }
}

/** Returns false if the write did not land, so callers never assume it did. */
function write(next: LocalIdentityStore): boolean {
  const store = storage()
  if (!store) return false

  try {
    store.setItem(STORAGE_KEY, JSON.stringify(next))
    return true
  } catch {
    // Quota exhausted or storage disabled. Attribution is best-effort.
    return false
  }
}

/** Every actor known to this device, oldest first. */
export function listLocalActors(): LocalActor[] {
  return read().actors
}

/**
 * The actor edits are currently attributed to, or null if this device has
 * no identity yet. Pure read — creates nothing.
 */
export function getCurrentLocalActor(): LocalActor | null {
  const { actors, currentActorId } = read()
  return actors.find((actor) => actor.id === currentActorId) ?? null
}

/**
 * Creates a new actor and makes it current.
 *
 * Existing actors are kept: switching between them on a shared device is
 * the point, and removing one would orphan the attribution on every event
 * it already produced.
 */
export function createLocalActor(displayName: string): LocalActor {
  const name = displayName.trim()
  if (!name) throw new Error('A local actor needs a display name.')

  const { actors } = read()
  const actor: LocalActor = {
    id: crypto.randomUUID(),
    displayName: name,
    createdAt: new Date().toISOString(),
  }

  write({ actors: [...actors, actor], currentActorId: actor.id })
  return actor
}

/**
 * Switches which actor subsequent edits are attributed to.
 *
 * Affects nothing already written. Events are immutable and keep the
 * actorId recorded at the time they happened — switching identity does not
 * rewrite history, and must not.
 */
export function setCurrentLocalActor(actorId: string): void {
  const { actors } = read()
  if (!actors.some((actor) => actor.id === actorId)) {
    throw new Error(`Unknown local actor: ${actorId}`)
  }
  write({ actors, currentActorId: actorId })
}

/**
 * The current actor, creating a default one on first use.
 *
 * SYNCHRONOUS ON PURPOSE. This is called by `recordChange` from inside a
 * Dexie transaction, and awaiting a non-Dexie promise there would leave the
 * transaction's zone and break the atomicity guarantee that the record, its
 * event and its outbox entry commit together. Any storage that backs local
 * identity must stay synchronous for that reason.
 *
 * Returns null if identity could not be read or persisted — an
 * unattributed event is honest, whereas a fabricated actor is a lie in an
 * audit trail. Attribution never blocks a genealogy edit.
 */
export function ensureCurrentLocalActor(): LocalActor | null {
  const existing = getCurrentLocalActor()
  if (existing) return existing

  const { actors } = read()

  // Actors exist but none is selected (a cleared or corrupt selection).
  // Adopting the first is better than inventing a duplicate identity.
  const adopted = actors[0]
  if (adopted) {
    return write({ actors, currentActorId: adopted.id }) ? adopted : null
  }

  try {
    const created = createLocalActor(DEFAULT_DISPLAY_NAME)
    // Confirm it actually persisted. If storage is unavailable the event
    // would otherwise be attributed to an identity that vanishes on
    // reload, leaving an actorId no one can ever resolve.
    return getCurrentLocalActor() ? created : null
  } catch {
    return null
  }
}
