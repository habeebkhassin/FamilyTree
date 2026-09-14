import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import 'fake-indexeddb/auto'
import { startupView } from './startupGate'
import type { AuthAccount, AuthClient, AuthState } from '../../lib/cloud/authClient'
import { NoAuthClient } from '../../lib/cloud/authClient'
import {
  getCurrentLocalActor,
  linkCurrentActorToAccount,
  unlinkCurrentActorFromAccount,
} from '../../lib/identity/localActor'
import { db } from '../../lib/storage/db'
import { createFamilyTree } from '../../lib/storage/familyTrees'
import { createPerson } from '../../lib/storage/people'

/**
 * The gate in front of the application.
 *
 * What is being protected here is not a feature, it is a family's
 * records, so the decision is tested as a decision rather than inferred
 * from the markup around it. Every session state has exactly one right
 * answer and all of them are named below.
 *
 * The last test is the one that matters most. Signing out has to return
 * somebody to the sign-in screen WITHOUT touching what is on their
 * device — a sign-out that quietly took a family's records with it would
 * be the worst bug this application could have, and it would look exactly
 * like a working sign-out.
 */

/** A stand-in provider, driven by the test rather than by Google. */
class StubAuthClient implements AuthClient {
  account: AuthAccount | null = null
  #listeners = new Set<(account: AuthAccount | null) => void>()
  signOutCalls = 0

  async getAccount(): Promise<AuthAccount | null> {
    return this.account
  }

  onChange(listener: (account: AuthAccount | null) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async signInWithGoogle(): Promise<void> {
    this.account = { id: 'acct-1', email: 'grace@example.com', displayName: 'Grace' }
    this.#listeners.forEach((listener) => listener(this.account))
  }

  async signOut(): Promise<void> {
    this.signOutCalls += 1
    this.account = null
    this.#listeners.forEach((listener) => listener(null))
  }
}

/** The smallest localStorage the identity module needs. */
function installStorage(): void {
  const entries = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
    clear: () => entries.clear(),
    key: () => null,
    length: 0,
  }
}

/**
 * What AuthProvider does with an account, reduced to the state it
 * produces. The provider itself is a component; this is the rule it
 * applies, which is what the gate then reads.
 */
const stateFor = (account: AuthAccount | null): AuthState =>
  account ? { status: 'signedIn', account } : { status: 'signedOut' }

beforeEach(async () => {
  installStorage()
  await db.delete()
  await db.open()
})

// ── every session state has one answer ──────────────────────────────

test('nobody signed in: the sign-in screen, and nothing else', () => {
  assert.equal(startupView({ status: 'signedOut' }), 'signIn')
})

test('signed in: straight into the application, as before', () => {
  assert.equal(
    startupView({
      status: 'signedIn',
      account: { id: 'acct-1', email: 'grace@example.com', displayName: 'Grace' },
    }),
    'app',
  )
})

test('still resolving: neither screen, so neither can flash', () => {
  /*
    The bug this prevents: the session takes a moment to resolve, the app
    renders "nobody is signed in" in the meantime, and somebody who IS
    signed in watches a sign-in screen — or worse, an empty Create Family
    form — appear and vanish before their tree loads.

    `loading` is its own answer precisely so that neither of the other two
    can be shown on a guess.
  */
  const view = startupView({ status: 'loading' })
  assert.equal(view, 'loading')
  assert.notEqual(view, 'app', 'the Create Family screen must not appear on an unresolved session')
  assert.notEqual(view, 'signIn', 'nor may a signed-in person be shown a sign-in screen')
})

test('no cloud configured: the application opens, because there is nothing to sign in to', async () => {
  /*
    A build with no keys has no provider, and NoAuthClient refuses to
    pretend otherwise. Demanding a sign-in here would lock a family out of
    records held entirely on their own device, behind a button that throws.
  */
  assert.equal(startupView({ status: 'unavailable' }), 'app')

  const offline = new NoAuthClient()
  assert.equal(await offline.getAccount(), null)
  await assert.rejects(() => offline.signInWithGoogle(), /no cloud configured/i)
})

// ── the round trip ──────────────────────────────────────────────────

test('signing in opens the application, signing out returns to the sign-in screen', async () => {
  const auth = new StubAuthClient()

  assert.equal(startupView(stateFor(await auth.getAccount())), 'signIn')

  await auth.signInWithGoogle()
  assert.equal(startupView(stateFor(await auth.getAccount())), 'app')

  await auth.signOut()
  assert.equal(startupView(stateFor(await auth.getAccount())), 'signIn')
  assert.equal(auth.signOutCalls, 1)
})

test('a session that resolves to nobody never reports loading again', async () => {
  // Guards the other half of the flash: once resolved, the gate must
  // settle, not oscillate back through loading on the next render.
  const auth = new StubAuthClient()
  const first = startupView(stateFor(await auth.getAccount()))
  const second = startupView(stateFor(await auth.getAccount()))
  assert.equal(first, 'signIn')
  assert.equal(second, 'signIn')
})

// ── and the family stays where it is ────────────────────────────────

test('signing out leaves every record on this device untouched', async () => {
  const auth = new StubAuthClient()
  await auth.signInWithGoogle()
  const account = await auth.getAccount()
  assert.ok(account)
  linkCurrentActorToAccount(account.id, account.displayName ?? account.email)

  const tree = await createFamilyTree({ name: 'Okafor Family' })
  await createPerson({
    familyTreeId: tree.id,
    firstName: 'Grace',
    lastName: 'Okafor',
    gender: 'female',
  })
  await createPerson({
    familyTreeId: tree.id,
    firstName: 'Emeka',
    lastName: 'Okafor',
    gender: 'male',
  })

  const before = {
    trees: await db.familyTrees.count(),
    people: await db.people.count(),
    events: await db.changeEvents.count(),
  }

  await auth.signOut()
  unlinkCurrentActorFromAccount()

  assert.equal(startupView(stateFor(await auth.getAccount())), 'signIn', 'back at the door')

  assert.deepEqual(
    {
      trees: await db.familyTrees.count(),
      people: await db.people.count(),
      events: await db.changeEvents.count(),
    },
    before,
    'signing out is not a delete: every record is still on this device',
  )

  const stored = await db.familyTrees.get(tree.id)
  assert.equal(stored?.name, 'Okafor Family')

  // The actor survives too, minus the account link — so the edits this
  // person already made keep their attribution.
  const actor = getCurrentLocalActor()
  assert.ok(actor, 'the local identity is still here')
  assert.equal(actor.accountId, undefined, 'it is simply no longer linked to an account')
})
