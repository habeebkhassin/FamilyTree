/**
 * Where the cloud lives, if it lives anywhere — Milestone 1.
 *
 * Two values, both supplied by the environment and neither ever committed:
 *
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 *
 * Both are safe in a browser bundle by design — the anon key is a public
 * identifier that grants nothing on its own, and everything it can reach
 * is gated by row-level security on the server. A service-role key is the
 * opposite of that and must never appear in this application, in an
 * environment file, or in any build of it.
 *
 * WHEN NEITHER IS SET, THIS APPLICATION IS EXACTLY WHAT IT WAS.
 *
 * That is the point of reading configuration rather than assuming it.
 * FamilyTree has always been a local-first application that works with no
 * server, and a missing key must read as "there is no cloud here", never
 * as a misconfiguration to warn about. Nothing offers to sign in, nothing
 * fails, and no cloud code is even downloaded.
 */

export interface CloudConfig {
  url: string
  anonKey: string
}

/**
 * Read at call time rather than captured at module load, so a test can
 * arrange an environment and so nothing depends on import order.
 */
function readEnv(name: string): string | undefined {
  // `import.meta.env` is Vite's; under Node (tests) it is absent, and
  // process.env is the honest fallback rather than a shim.
  const viteEnv = (import.meta as { env?: Record<string, string | undefined> }).env
  const fromVite = viteEnv?.[name]
  if (typeof fromVite === 'string' && fromVite.trim()) return fromVite.trim()

  // Reached through globalThis so this compiles against the browser
  // tsconfig, which has no Node types and should not gain any.
  const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env
  const fromNode = nodeEnv?.[name]
  if (typeof fromNode === 'string' && fromNode.trim()) return fromNode.trim()

  return undefined
}

/**
 * The configured cloud, or null when this build has none.
 *
 * Both values are required together: a URL with no key cannot authenticate
 * anybody, and a key with no URL has nowhere to go. Half a configuration
 * is treated as none at all rather than as something to half-attempt.
 */
export function readCloudConfig(): CloudConfig | null {
  const url = readEnv('VITE_SUPABASE_URL')
  const anonKey = readEnv('VITE_SUPABASE_ANON_KEY')
  if (!url || !anonKey) return null
  return { url, anonKey }
}

export function isCloudConfigured(): boolean {
  return readCloudConfig() !== null
}
