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
  /**
   * The cloud account this actor has been recognised as — Milestone 1.
   *
   * Optional, and absent on every actor that existed before accounts did.
   * Signed-out use is the normal case and must never depend on this being
   * set.
   *
   * A LINK, NOT A REPLACEMENT. The actor keeps its own id, so every
   * ChangeEvent ever written keeps the `actorId` it was written with and
   * no history is rewritten. What this adds is the ability to say later
   * "those edits were made by the person who signs in as this account",
   * which is exactly what the eventual server needs and exactly what
   * rewriting the events would have destroyed.
   *
   * Still not authorisation. An account id stored on this device is as
   * self-asserted as the name beside it until a server vouches for it.
   */
  accountId?: string
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
    typeof candidate.createdAt === 'string' &&
    // Absent is the normal case. Present but not a string is corrupt, and
    // an actor carrying a corrupt account link is worse than no actor:
    // it would be offered as "already signed in as" somebody unknown.
    (candidate.accountId === undefined || typeof candidate.accountId === 'string')
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


/**
 * Attach the signed-in account to the identity edits are attributed to.
 *
 * Called when somebody signs in. Three cases, and the third is the reason
 * this is not a one-line assignment:
 *
 *   unlinked actor        link it, and keep its name and its id
 *   already this account  nothing to do
 *   a DIFFERENT account   do not take it over
 *
 * The third matters on a shared family device. If two people use one
 * tablet and the second signs in, quietly repointing the first person's
 * actor at the second person's account would attribute one person's past
 * edits to the other. So an actor already linked elsewhere is left exactly
 * as it is, and this account gets its own — reusing one previously linked
 * to it if there is one, otherwise creating one under the name the
 * provider gave.
 *
 * Returns the actor now in effect, or null if identity could not be
 * persisted at all. Never throws: failing to record an account link must
 * not stop somebody editing their family tree.
 */
export function linkCurrentActorToAccount(
  accountId: string,
  accountDisplayName?: string | null,
): LocalActor | null {
  const { actors, currentActorId } = read()
  const current = actors.find((actor) => actor.id === currentActorId) ?? null

  if (current && current.accountId === accountId) return current

  // Somebody else is signed in on this device under the current name.
  if (current && current.accountId !== undefined) {
    const theirs = actors.find((actor) => actor.accountId === accountId)
    if (theirs) {
      return write({ actors, currentActorId: theirs.id }) ? theirs : null
    }
    const created: LocalActor = {
      id: crypto.randomUUID(),
      displayName: (accountDisplayName ?? '').trim() || DEFAULT_DISPLAY_NAME,
      createdAt: new Date().toISOString(),
      accountId,
    }
    return write({ actors: [...actors, created], currentActorId: created.id }) ? created : null
  }

  // An actor already linked to this account takes precedence over
  // adopting an unlinked one, so signing back in returns you to yourself.
  const previouslyLinked = actors.find((actor) => actor.accountId === accountId)
  if (previouslyLinked) {
    return write({ actors, currentActorId: previouslyLinked.id }) ? previouslyLinked : null
  }

  const base = current ?? ensureCurrentLocalActor()
  if (!base) return null

  // Re-read: ensureCurrentLocalActor may have created and written one.
  const { actors: latest } = read()
  const linked: LocalActor = { ...base, accountId }
  const next = latest.map((actor) => (actor.id === base.id ? linked : actor))
  // The name is deliberately left alone. It is the label on every edit
  // this actor has already made, and a sign-in is not a reason to relabel
  // somebody's history.
  return write({ actors: next, currentActorId: linked.id }) ? linked : null
}

/**
 * Detach the account when somebody signs out.
 *
 * The actor itself stays, keeps its name, keeps its id, and remains the
 * identity edits are attributed to — signing out returns this device to
 * being a local-first device, which is a state it is fully designed for.
 * Nothing is deleted.
 */
export function unlinkCurrentActorFromAccount(): LocalActor | null {
  const { actors, currentActorId } = read()
  const current = actors.find((actor) => actor.id === currentActorId) ?? null
  if (!current || current.accountId === undefined) return current

  const { accountId: _removed, ...withoutAccount } = current
  const next = actors.map((actor) => (actor.id === current.id ? withoutAccount : actor))
  return write({ actors: next, currentActorId: current.id }) ? withoutAccount : current
}

/** Which actor, if any, this device has already linked to an account. */
export function findActorForAccount(accountId: string): LocalActor | null {
  return read().actors.find((actor) => actor.accountId === accountId) ?? null
}
