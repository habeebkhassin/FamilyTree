import { useEffect, useState } from 'react'
import {
  applyTheme,
  getStoredTheme,
  resolveTheme,
  setStoredTheme,
  THEME_CHOICES,
  watchSystemTheme,
} from '../../lib/theme'
import type { ThemeChoice } from '../../lib/theme'
import './ThemeSetting.css'

/**
 * How FamilyTree looks on this device.
 *
 * Three words in a row rather than a settings page: there is one decision
 * here and it has three answers, and anything more elaborate would be a
 * dashboard built around a single preference.
 *
 * A radiogroup rather than three buttons, because that is what this is —
 * one choice among three, where picking one unpicks the others. Screen
 * readers announce it as such and arrow keys move through it, which three
 * separate buttons would not.
 */
export function ThemeSetting() {
  const [choice, setChoice] = useState<ThemeChoice>(() => getStoredTheme())
  const [system, setSystem] = useState(() => resolveTheme('system'))

  /*
    Under "System" the page re-themes itself with no help from us — the
    attribute is absent, so the media query in index.css is what is
    deciding, and it reacts on its own.

    This watcher is only so the sentence below stays true: it says which
    appearance the device is currently asking for, and a line that still
    read "light" after the phone went dark would be worse than no line.
  */
  useEffect(() => {
    if (choice !== 'system') return
    return watchSystemTheme(setSystem)
  }, [choice])

  function pick(next: ThemeChoice) {
    setChoice(next)
    setStoredTheme(next)
    applyTheme(next)
  }

  return (
    <section className="theme-setting">
      <h2 className="theme-setting__heading">Appearance</h2>
      <div className="theme-setting__card">
        <div className="theme-setting__text">
          <span className="theme-setting__label" id="theme-label">
            Theme
          </span>
          <span className="theme-setting__hint">Choose how FamilyTree looks on this device.</span>
        </div>

        <div className="theme-setting__options" role="radiogroup" aria-labelledby="theme-label">
          {THEME_CHOICES.map((option) => {
            const selected = option.value === choice
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`theme-setting__option${selected ? ' theme-setting__option--on' : ''}`}
                onClick={() => pick(option.value)}
              >
                <span className="theme-setting__swatch" data-theme-preview={option.value} aria-hidden="true" />
                {option.label}
                {/* Said in words as well as in colour, so the selection is
                    not carried by a tint alone. */}
                {selected && <span className="theme-setting__sr-only">, selected</span>}
              </button>
            )
          })}
        </div>

        {choice === 'system' && (
          <p className="theme-setting__following">
            Following this device, which is currently {system === 'dark' ? 'dark' : 'light'}.
          </p>
        )}
      </div>
    </section>
  )
}
