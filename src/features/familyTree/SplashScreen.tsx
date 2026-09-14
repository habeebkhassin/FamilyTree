import './SplashScreen.css'

/**
 * A family grows into a tree.
 *
 * A pot, a seed, a stem, branches, a canopy — the shape of the thing the
 * application is for, drawn once while the session resolves.
 *
 *
 * WHY THIS IS NOT LOTTIE
 * ──────────────────────
 * Lottie needs a player, and the usual one is a quarter of a megabyte or
 * more. Spending that on a page that shows for under a second — in an
 * application whose whole promise is working offline on a phone — costs
 * every future load to decorate one. Six shapes and a keyframe list do
 * the same job in a few kilobytes, take their colours from the existing
 * tokens so they follow the theme for free, and have nothing to fetch.
 *
 * Swappable later: this is one component behind one prop, so a real
 * Lottie asset can replace it without anything else changing.
 *
 *
 * IT DECIDES NOTHING
 * ──────────────────
 * The splash is shown WHILE the session is being resolved and never
 * instead of resolving it. It gates nothing, knows nothing about
 * accounts, and cannot delay anybody: the moment startup has an answer,
 * whatever it is, this is gone.
 */
export function SplashScreen() {
  return (
    <div className="splash" role="status" aria-label="Loading FamilyTree">
      <div className="splash__stage">
        <svg viewBox="0 0 120 130" className="splash__art" aria-hidden="true">
          {/* Grown from the pot upward, so the order of the drawing is
              the order of the story. */}
          <g className="splash__canopy">
            <circle className="splash__leaf splash__leaf--1" cx="60" cy="34" r="13" />
            <circle className="splash__leaf splash__leaf--2" cx="38" cy="48" r="10" />
            <circle className="splash__leaf splash__leaf--3" cx="82" cy="48" r="10" />
          </g>

          <g className="splash__branches" fill="none" strokeLinecap="round">
            <path className="splash__branch splash__branch--l" d="M60 62 L42 50" />
            <path className="splash__branch splash__branch--r" d="M60 62 L78 50" />
          </g>

          <path className="splash__stem" d="M60 92 L60 40" fill="none" strokeLinecap="round" />

          <g className="splash__pot">
            <path d="M40 92 L46 118 H74 L80 92 Z" />
            <rect x="37" y="86" width="46" height="8" rx="3" />
          </g>
        </svg>
      </div>
      <p className="splash__word">Family Tree</p>
    </div>
  )
}
