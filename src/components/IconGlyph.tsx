import type { ReactNode } from 'react'

/**
 * The shared frame every icon is drawn in — one viewBox, one stroke
 * weight, one corner treatment, so the set reads as one set.
 *
 * Its own file because `icons.tsx` exports a plain object rather than
 * components, and a module that mixes the two breaks fast refresh.
 */
export function IconGlyph({ size = 22, children }: { size?: number; children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </g>
    </svg>
  )
}
