/**
 * How FamilyTree looks on this device.
 *
 * ONE MECHANISM, and deliberately a small one: a single attribute on the
 * root element, which the token block in index.css already keys off. No
 * component asks what the theme is, nothing re-renders when it changes,
 * and there is no context, no provider and no library — the cascade does
 * the work it was designed to do.
 *
 *
 * A DEVICE PREFERENCE, NOT A FACT ABOUT THE FAMILY
 * ────────────────────────────────────────────────
 * It lives in localStorage beside the other per-device preferences, never
 * in Dexie and never in the cloud. Two people sharing a tree are entitled
 * to different-looking screens, and a theme that arrived over sync would
 * change somebody's phone because a relative changed theirs.
 *
 * The three states are the three that exist. "System" is not "light with
 * a fallback": it is a standing instruction to follow the device, and it
 * keeps following it while the application is open.
 */

/*
  Browser globals are reached through `globalThis` here, the same way
  cloudConfig and mediaStore reach theirs: the test configuration has no
  DOM lib on purpose, and describing only what this file touches keeps it
  compiling in both projects without widening either.
*/
interface MediaQueryLike {
  matches: boolean
  addEventListener(event: 'change', listener: () => void): void
  removeEventListener(event: 'change', listener: () => void): void
}

interface RootElementLike {
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
  style: {
    setProperty(name: string, value: string): void
    removeProperty(name: string): void
  }
}

const browser = globalThis as {
  window?: { matchMedia?: (query: string) => MediaQueryLike }
  document?: { documentElement: RootElementLike }
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

function darkMediaQuery(): MediaQueryLike | null {
  const matchMedia = browser.window?.matchMedia
  if (typeof matchMedia !== 'function') return null
  return matchMedia.call(browser.window, DARK_QUERY)
}

export type ThemeChoice = 'light' | 'dark' | 'system'

/** What is actually painted, once "system" has been resolved. */
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'familytree.theme'

export const THEME_CHOICES: { value: ThemeChoice; label: string; hint: string }[] = [
  { value: 'light', label: 'Light', hint: 'Always the light appearance' },
  { value: 'dark', label: 'Dark', hint: 'Always the dark appearance' },
  { value: 'system', label: 'System', hint: 'Follow this device' },
]

function isChoice(value: unknown): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system'
}

/**
 * The stored choice, or "system".
 *
 * System is the default on a device that has never chosen, because the
 * person has usually already told their phone what they prefer and being
 * asked again is not a courtesy.
 */
export function getStoredTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isChoice(stored) ? stored : 'system'
  } catch {
    // Private browsing, blocked storage. Following the device is still
    // the right answer, and it costs nothing to fail this way.
    return 'system'
  }
}

export function setStoredTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    // Best effort, like every other preference here. The choice still
    // applies for this session.
  }
}

/** What the device itself asks for. */
export function systemTheme(): ResolvedTheme {
  return darkMediaQuery()?.matches ? 'dark' : 'light'
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  return choice === 'system' ? systemTheme() : choice
}

/**
 * Paint it.
 *
 * `data-theme` is what the stylesheet reads. `color-scheme` is set beside
 * it so the browser's own furniture — scrollbars, form controls, the
 * canvas behind the page — matches; without it a light page can arrive
 * with dark scrollbars on a dark device.
 *
 * An explicit choice sets both. "System" REMOVES the attribute rather
 * than writing the resolved value, which is what lets the media query in
 * index.css stay in charge and keep following the device.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = browser.document?.documentElement
  if (!root) return
  if (choice === 'system') {
    root.removeAttribute('data-theme')
    root.style.removeProperty('color-scheme')
  } else {
    root.setAttribute('data-theme', choice)
    root.style.setProperty('color-scheme', choice)
  }
}

/**
 * Follow the device while "System" is selected.
 *
 * Returns an unsubscribe. Only meaningful for "system" — an explicit
 * choice is an instruction, and a phone switching to night mode is not a
 * reason to override somebody who has said "always light".
 */
export function watchSystemTheme(listener: (theme: ResolvedTheme) => void): () => void {
  const query = darkMediaQuery()
  if (!query) return () => {}
  const handle = () => listener(query.matches ? 'dark' : 'light')
  query.addEventListener('change', handle)
  return () => query.removeEventListener('change', handle)
}
