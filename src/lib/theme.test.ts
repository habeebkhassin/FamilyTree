import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, beforeEach } from 'node:test'
import {
  applyTheme,
  getStoredTheme,
  resolveTheme,
  setStoredTheme,
  systemTheme,
  THEME_CHOICES,
  watchSystemTheme,
} from './theme'
import type { ResolvedTheme } from './theme'

/**
 * How FamilyTree looks on this device.
 *
 * The rule worth protecting is the one that is easy to get wrong: "system"
 * is not a third colour, it is the ABSENCE of an instruction. Writing the
 * resolved value into the attribute would look identical on the day it was
 * written and then quietly stop following the device, which is the whole
 * point of choosing it.
 */

/** The smallest localStorage these functions need. */
function installStorage(): { entries: Map<string, string>; blocked: boolean } {
  const state = { entries: new Map<string, string>(), blocked: false }
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => {
      if (state.blocked) throw new Error('storage is blocked')
      return state.entries.get(key) ?? null
    },
    setItem: (key: string, value: string) => {
      if (state.blocked) throw new Error('storage is blocked')
      state.entries.set(key, value)
    },
    removeItem: (key: string) => {
      if (state.blocked) throw new Error('storage is blocked')
      state.entries.delete(key)
    },
    clear: () => state.entries.clear(),
    key: () => null,
    length: 0,
  }
  return state
}

/** A root element and a media query, which is all applyTheme touches. */
function installDocument() {
  const attributes = new Map<string, string>()
  const styles = new Map<string, string>()
  const root = {
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    style: {
      setProperty: (name: string, value: string) => void styles.set(name, value),
      removeProperty: (name: string) => void styles.delete(name),
    },
  }
  ;(globalThis as { document?: unknown }).document = { documentElement: root }
  return { attributes, styles }
}

function installMatchMedia(prefersDark: boolean) {
  const listeners = new Set<() => void>()
  const query = {
    matches: prefersDark,
    addEventListener: (_event: string, listener: () => void) => void listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => void listeners.delete(listener),
  }
  ;(globalThis as { window?: unknown }).window = {
    matchMedia: () => query,
  }
  return {
    /** The device's setting changes while the app is open. */
    change(toDark: boolean) {
      query.matches = toDark
      listeners.forEach((listener) => listener())
    },
    listenerCount: () => listeners.size,
  }
}

beforeEach(() => {
  installStorage()
  installDocument()
  installMatchMedia(false)
})

// ── the default ─────────────────────────────────────────────────────

test('a device that has never chosen follows itself', () => {
  assert.equal(getStoredTheme(), 'system')
})

test('the three choices are the three that exist', () => {
  assert.deepEqual(THEME_CHOICES.map((choice) => choice.value), ['light', 'dark', 'system'])
})

// ── choosing ────────────────────────────────────────────────────────

test('light and dark are remembered', () => {
  setStoredTheme('light')
  assert.equal(getStoredTheme(), 'light')
  setStoredTheme('dark')
  assert.equal(getStoredTheme(), 'dark')
})

test('choosing system forgets the choice rather than recording one', () => {
  /*
    The distinction this whole module turns on. Storing "system" as a
    value would work today and be wrong tomorrow: it would have to be
    re-resolved somewhere, and anything that forgot to would pin the
    theme to whatever the device happened to be on the day it was saved.
  */
  setStoredTheme('dark')
  setStoredTheme('system')
  assert.equal(getStoredTheme(), 'system')
  assert.equal(localStorage.getItem('familytree.theme'), null, 'nothing is left behind')
})

test('a damaged value falls back to following the device', () => {
  localStorage.setItem('familytree.theme', 'chartreuse')
  assert.equal(getStoredTheme(), 'system')
})

test('blocked storage is not a broken application', () => {
  const state = installStorage()
  state.blocked = true
  assert.equal(getStoredTheme(), 'system')
  assert.doesNotThrow(() => setStoredTheme('dark'))
})

// ── resolving ───────────────────────────────────────────────────────

test('system resolves to whatever the device asks for', () => {
  installMatchMedia(true)
  assert.equal(systemTheme(), 'dark')
  assert.equal(resolveTheme('system'), 'dark')

  installMatchMedia(false)
  assert.equal(systemTheme(), 'light')
  assert.equal(resolveTheme('system'), 'light')
})

test('an explicit choice ignores the device', () => {
  installMatchMedia(true)
  assert.equal(resolveTheme('light'), 'light', 'a dark phone does not overrule "always light"')
  installMatchMedia(false)
  assert.equal(resolveTheme('dark'), 'dark')
})

// ── painting ────────────────────────────────────────────────────────

test('an explicit choice stamps the root, and says so to the browser too', () => {
  const { attributes, styles } = installDocument()
  applyTheme('dark')
  assert.equal(attributes.get('data-theme'), 'dark')
  // Without this, a dark page can arrive with light scrollbars.
  assert.equal(styles.get('color-scheme'), 'dark')

  applyTheme('light')
  assert.equal(attributes.get('data-theme'), 'light')
  assert.equal(styles.get('color-scheme'), 'light')
})

test('system stamps nothing, which is what keeps the media query in charge', () => {
  const { attributes, styles } = installDocument()
  applyTheme('dark')
  applyTheme('system')
  assert.equal(attributes.get('data-theme'), undefined, 'the attribute is removed, not rewritten')
  assert.equal(styles.get('color-scheme'), undefined)
})

// ── following the device ────────────────────────────────────────────

test('a change of system appearance is reported while system is selected', () => {
  const media = installMatchMedia(false)
  const seen: ResolvedTheme[] = []
  const stop = watchSystemTheme((theme) => seen.push(theme))

  media.change(true)
  media.change(false)
  assert.deepEqual(seen, ['dark', 'light'])

  stop()
  media.change(true)
  assert.deepEqual(seen, ['dark', 'light'], 'and stops when told to')
  assert.equal(media.listenerCount(), 0, 'leaving nothing behind')
})

test('with no matchMedia at all, nothing throws and light is assumed', () => {
  ;(globalThis as { window?: unknown }).window = {}
  assert.equal(systemTheme(), 'light')
  assert.doesNotThrow(() => watchSystemTheme(() => {})())
})

// ── it is a device preference, and only that ────────────────────────

test('the theme is a device preference, written only to local storage', () => {
  /*
    It must never travel. Two people sharing a tree are entitled to
    different-looking screens, and a theme arriving over sync would
    change somebody's phone because a relative changed theirs.

    Asserted structurally: this module is checked for any import of the
    database or the cloud, so the claim is a property of the file rather
    than of how carefully it happens to be called today.
  */
  const state = installStorage()
  setStoredTheme('dark')
  assert.deepEqual([...state.entries.keys()], ['familytree.theme'])

  const source = readFileSync('src/lib/theme.ts', 'utf8')
  assert.ok(!/from '.*storage/.test(source), 'the theme never reaches the database')
  assert.ok(!/from '.*cloud/.test(source), 'nor the cloud')
  assert.ok(!/supabase/i.test(source), 'and names no backend at all')
})
