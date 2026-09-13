import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import { NoAuthClient } from './authClient'
import type { AuthAccount, AuthClient } from './authClient'
import { isCloudConfigured, readCloudConfig } from './cloudConfig'
import {
  createLocalActor,
  findActorForAccount,
  getCurrentLocalActor,
  linkCurrentActorToAccount,
  listLocalActors,
  unlinkCurrentActorFromAccount,
} from '../identity/localActor'

/**
 * The account layer, exercised with no network, no browser and no Google
 * credentials. Everything here runs against the AuthClient interface or
 * against localStorage, which is exactly why both are interfaces.
 */

/** The smallest localStorage that satisfies the identity module. */
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

beforeEach(() => {
  installStorage()
  delete process.env.VITE_SUPABASE_URL
  delete process.env.VITE_SUPABASE_ANON_KEY
})

// ── configuration ───────────────────────────────────────────────────

test('with no keys set, there is no cloud', () => {
  assert.equal(readCloudConfig(), null)
  assert.equal(isCloudConfigured(), false)
})

test('half a configuration is no configuration', () => {
  process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
  assert.equal(isCloudConfigured(), false, 'a URL with no key cannot authenticate anybody')

  delete process.env.VITE_SUPABASE_URL
  process.env.VITE_SUPABASE_ANON_KEY = 'anon-key'
  assert.equal(isCloudConfigured(), false, 'a key with no URL has nowhere to go')
})

test('both keys together configure the cloud', () => {
  process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
  process.env.VITE_SUPABASE_ANON_KEY = 'anon-key'
  assert.deepEqual(readCloudConfig(), {
    url: 'https://example.supabase.co',
    anonKey: 'anon-key',
  })
})

// ── the no-cloud client ─────────────────────────────────────────────

test('with no cloud, nobody is signed in and signing in is refused', async () => {
  const client = new NoAuthClient()
  assert.equal(await client.getAccount(), null)
  await assert.rejects(
    () => client.signInWithGoogle(),
    /no cloud configured/i,
    'refusing beats resolving: a caller must not mistake this for a sign-in under way',
  )
  await client.signOut() // signing out of nothing is a no-op, not a failure
})

// ── linking an account to the local actor ───────────────────────────

test('signing in links the actor already in use, keeping its id and name', () => {
  const before = createLocalActor('Habeeb')
  const linked = linkCurrentActorToAccount('account-1', 'Habeeb K')

  assert.equal(linked?.id, before.id, 'the actor id is what every past event was written with')
  assert.equal(linked?.displayName, 'Habeeb', 'a sign-in does not relabel somebody history')
  assert.equal(linked?.accountId, 'account-1')
  assert.equal(listLocalActors().length, 1, 'no second identity was invented')
})

test('linking the same account twice changes nothing', () => {
  createLocalActor('Habeeb')
  const first = linkCurrentActorToAccount('account-1')
  const second = linkCurrentActorToAccount('account-1')
  assert.equal(second?.id, first?.id)
  assert.equal(listLocalActors().length, 1)
})

test('a second account on a shared device does not take over the first actor', () => {
  const habeeb = createLocalActor('Habeeb')
  linkCurrentActorToAccount('account-1', 'Habeeb K')

  const other = linkCurrentActorToAccount('account-2', 'Sana')

  assert.notEqual(other?.id, habeeb.id, 'the other account gets its own actor')
  assert.equal(other?.accountId, 'account-2')
  assert.equal(other?.displayName, 'Sana')

  const stillHabeeb = findActorForAccount('account-1')
  assert.equal(stillHabeeb?.id, habeeb.id, 'and the first is left exactly as it was')
  assert.equal(stillHabeeb?.accountId, 'account-1')
})

test('signing back in returns you to your own actor', () => {
  const habeeb = createLocalActor('Habeeb')
  linkCurrentActorToAccount('account-1')
  linkCurrentActorToAccount('account-2', 'Sana')

  const back = linkCurrentActorToAccount('account-1')
  assert.equal(back?.id, habeeb.id)
  assert.equal(getCurrentLocalActor()?.id, habeeb.id)
})

test('signing out removes the link and keeps the actor', () => {
  const actor = createLocalActor('Habeeb')
  linkCurrentActorToAccount('account-1')

  const after = unlinkCurrentActorFromAccount()
  assert.equal(after?.id, actor.id)
  assert.equal(after?.displayName, 'Habeeb')
  assert.equal(after?.accountId, undefined, 'the account link is gone')
  assert.equal(getCurrentLocalActor()?.id, actor.id, 'edits are still attributed to them')
  assert.equal(listLocalActors().length, 1, 'nothing was deleted')
})

test('signing out when never signed in is harmless', () => {
  const actor = createLocalActor('Habeeb')
  assert.equal(unlinkCurrentActorFromAccount()?.id, actor.id)
  assert.equal(listLocalActors().length, 1)
})

test('linking with no actor yet creates one and links it', () => {
  assert.equal(getCurrentLocalActor(), null)
  const linked = linkCurrentActorToAccount('account-1', 'Habeeb K')
  assert.equal(linked?.accountId, 'account-1')
  assert.equal(getCurrentLocalActor()?.id, linked?.id)
})

// ── the interface a fake can satisfy, which is how the UI is tested ──

test('a stand-in client satisfies the whole interface', async () => {
  const account: AuthAccount = { id: 'a1', email: 'someone@example.com', displayName: 'Someone' }
  let current: AuthAccount | null = null
  const listeners = new Set<(next: AuthAccount | null) => void>()

  const fake: AuthClient = {
    async getAccount() {
      return current
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async signInWithGoogle() {
      current = account
      listeners.forEach((listener) => listener(current))
    },
    async signOut() {
      current = null
      listeners.forEach((listener) => listener(current))
    },
  }

  const seen: (AuthAccount | null)[] = []
  const stop = fake.onChange((next) => seen.push(next))

  assert.equal(await fake.getAccount(), null)
  await fake.signInWithGoogle()
  assert.equal((await fake.getAccount())?.email, 'someone@example.com')
  await fake.signOut()
  assert.equal(await fake.getAccount(), null)

  assert.deepEqual(
    seen.map((entry) => entry?.id ?? null),
    ['a1', null],
    'every change is reported once, in order',
  )
  stop()
})
