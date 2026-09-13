import { IconGlyph as Glyph } from './IconGlyph'

/**
 * The icon set — Phase 3.
 *
 * Plain outline glyphs, one weight, one corner treatment, drawn inline so
 * there is no icon font or package to load. Familiar shapes on purpose: a
 * cake for a birthday, a pin for a place, a pencil for edit. Every one is
 * `aria-hidden` and always sits beside a real word, so nothing here has to
 * be recognised to be understood.
 */
export const Icon = {
  back: (p?: { size?: number }) => (
    <Glyph size={p?.size}>
      <path d="M15 5l-7 7 7 7" />
    </Glyph>
  ),
  close: (p?: { size?: number }) => (
    <Glyph size={p?.size}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Glyph>
  ),
  check: (p?: { size?: number }) => (
    <Glyph size={p?.size}>
      <path d="M5 12.5l5 5L19 7" />
    </Glyph>
  ),
  more: (p?: { size?: number }) => (
    <svg viewBox="0 0 24 24" width={p?.size ?? 22} height={p?.size ?? 22} aria-hidden="true">
      <g fill="currentColor">
        <circle cx="12" cy="5" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="12" cy="19" r="1.8" />
      </g>
    </svg>
  ),
  search: (p?: { size?: number }) => (
    <Glyph size={p?.size}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </Glyph>
  ),
  edit: (p?: { size?: number }) => (
    <Glyph size={p?.size}>
      <path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5V20z" />
    </Glyph>
  ),
  trash: (p?: { size?: number }) => (
    <Glyph size={p?.size}>
      <path d="M4 7h16M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12" />
    </Glyph>
  ),
  cake: (p?: { size?: number }) => (
    <Glyph size={p?.size}>
      <path d="M4 20h16M4.5 20v-5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v5M12 13V9M12 6.5V5" />
    </Glyph>
  ),
  pin: (p?: { size?: number }) => (
    <Glyph size={p?.size}>
      <path d="M12 21s6.5-5.7 6.5-10.4A6.5 6.5 0 0 0 5.5 10.6C5.5 15.3 12 21 12 21z" />
      <circle cx="12" cy="10.4" r="2.4" />
    </Glyph>
  ),
  briefcase: (p?: { size?: number }) => (
    <Glyph size={p?.size}>
      <rect x="3.5" y="7.5" width="17" height="12" rx="2" />
      <path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5" />
    </Glyph>
  ),
  note: (p?: { size?: number }) => (
    <Glyph size={p?.size}>
      <path d="M6 3.5h8.5L19 8v12.5H6z" />
      <path d="M14 3.5V8h5M9 13h6M9 16.5h4" />
    </Glyph>
  ),
  photo: (p?: { size?: number }) => (
    <Glyph size={p?.size}>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="M4.5 17l4.5-4.5L13 16l3-2.5 3.5 3.5" />
    </Glyph>
  ),
  camera: (p?: { size?: number }) => (
    <Glyph size={p?.size}>
      <path d="M3.5 8.5h3.2l1.4-2.2h7.8l1.4 2.2h3.2v10H3.5z" />
      <circle cx="12" cy="13" r="3.4" />
    </Glyph>
  ),
  settings: (p?: { size?: number }) => (
    <Glyph size={p?.size}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M4.2 7.5l1.9 1.1M17.9 15.4l1.9 1.1M4.2 16.5l1.9-1.1M17.9 8.6l1.9-1.1" />
    </Glyph>
  ),
  cloud: (p?: { size?: number }) => (
    <Glyph size={p?.size}>
      <path d="M7 18.5a4 4 0 0 1 .4-8 5.2 5.2 0 0 1 10 1.2 3.4 3.4 0 0 1-.4 6.8z" />
    </Glyph>
  ),
  download: (p?: { size?: number }) => (
    <Glyph size={p?.size}>
      <path d="M12 4v10M8 10.5l4 4 4-4M4.5 19.5h15" />
    </Glyph>
  ),
  people: (p?: { size?: number }) => (
    <Glyph size={p?.size}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.2 19c0-3.1 2.6-5.2 5.8-5.2s5.8 2.1 5.8 5.2" />
      <path d="M16.2 6.2a3 3 0 0 1 0 5.6M17.5 13.9c2 .6 3.3 2.2 3.3 4.4" />
    </Glyph>
  ),
  help: (p?: { size?: number }) => (
    <Glyph size={p?.size}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2-2.4 3.5M12 17h.01" />
    </Glyph>
  ),
  layers: (p?: { size?: number }) => (
    <Glyph size={p?.size}>
      <path d="M12 3.5l8.5 4.3-8.5 4.3-8.5-4.3z" />
      <path d="M3.5 12.5l8.5 4.3 8.5-4.3" />
    </Glyph>
  ),
  /** Two interlocking rings — a partnership. */
  rings: (p?: { size?: number }) => (
    <Glyph size={p?.size}>
      <circle cx="9" cy="12" r="5" />
      <circle cx="15" cy="12" r="5" />
    </Glyph>
  ),
  /** A parent above, branching to children. */
  branch: (p?: { size?: number }) => (
    <Glyph size={p?.size}>
      <circle cx="12" cy="5" r="2.2" />
      <circle cx="6" cy="19" r="2.2" />
      <circle cx="18" cy="19" r="2.2" />
      <path d="M12 7.2v4.3M6 16.8V13h12v3.8" />
    </Glyph>
  ),
  /** A child below, joined upward. */
  child: (p?: { size?: number }) => (
    <Glyph size={p?.size}>
      <circle cx="7" cy="5.5" r="2.2" />
      <circle cx="17" cy="5.5" r="2.2" />
      <circle cx="12" cy="18.5" r="2.2" />
      <path d="M7 7.7v3.3h10V7.7M12 11v5.3" />
    </Glyph>
  ),
  /** Two of the same generation, side by side. */
  siblings: (p?: { size?: number }) => (
    <Glyph size={p?.size}>
      <circle cx="7" cy="15" r="2.6" />
      <circle cx="17" cy="15" r="2.6" />
      <path d="M12 4v4.5M7 12.4V8.5h10v3.9" />
    </Glyph>
  ),
}
