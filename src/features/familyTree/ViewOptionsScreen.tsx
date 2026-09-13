import { AppHeader, IconButton } from '../../components/AppShell'
import { ChoiceRow, ToggleRow } from '../../components/Detail'
import { Icon } from '../../components/icons'
import type { ImplementedView } from '../tree-view/viewTypes'
import { VIEW_CHOICES } from './viewChoices'

/**
 * What the tree shows — Phase 3.
 *
 * A screen rather than a row of buttons, so each choice can be a sentence
 * instead of a word. Nothing technical appears here: there is no way to
 * reach the layout, the ranking or anything about how the drawing is
 * produced, because none of that is a decision a family member should be
 * asked to make.
 *
 * The four views are the ones the projection layer already implements,
 * named for what somebody would actually be looking for. They are named
 * honestly rather than tidily — "My close family" is not "Siblings only",
 * because that view also holds parents, children and partners, and a
 * label that promises less than it shows is its own kind of confusion.
 */
export function ViewOptionsScreen({
  activeView,
  onChangeView,
  showGenerations,
  onChangeShowGenerations,
  showPhotos,
  onChangeShowPhotos,
  onBack,
}: {
  activeView: ImplementedView
  onChangeView: (view: ImplementedView) => void
  showGenerations: boolean
  onChangeShowGenerations: (next: boolean) => void
  showPhotos: boolean
  onChangeShowPhotos: (next: boolean) => void
  onBack: () => void
}) {
  return (
    <>
      <AppHeader
        title="View options"
        leading={
          <IconButton label="Back" onClick={onBack}>
            {Icon.back({ size: 20 })}
          </IconButton>
        }
      />
      <div className="app-page">
        <div className="app-page__inner">
          <div className="menu-list">
            {VIEW_CHOICES.map((choice) => (
              <ChoiceRow
                key={choice.view}
                label={choice.label}
                selected={activeView === choice.view}
                onClick={() => {
                  onChangeView(choice.view)
                  onBack()
                }}
              />
            ))}
          </div>

          <div className="menu-list">
            <ToggleRow
              label="Show generations"
              checked={showGenerations}
              onChange={onChangeShowGenerations}
            />
            <ToggleRow label="Show photos" checked={showPhotos} onChange={onChangeShowPhotos} />
          </div>
        </div>
      </div>
    </>
  )
}
