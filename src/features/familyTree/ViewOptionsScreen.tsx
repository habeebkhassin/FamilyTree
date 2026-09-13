import type { FamilyGroup } from '../../types'
import { AppHeader, IconButton, SectionHeader } from '../../components/AppShell'
import { ChoiceRow, ToggleRow } from '../../components/Detail'
import { Icon } from '../../components/icons'
import type { ImplementedView } from '../tree-view/viewTypes'
import { VIEW_CHOICES } from './viewChoices'

/**
 * What the tree shows.
 *
 * A screen rather than a row of buttons, so each choice can be a sentence
 * instead of a word. Nothing technical appears here: there is no way to
 * reach the layout, the ranking or anything about how the drawing is
 * produced, because none of that is a decision a family member should be
 * asked to make.
 *
 * The four views are the ones the projection layer actually implements,
 * named for what somebody would be looking for. They are named honestly
 * rather than tidily — "My close family" is not "Siblings only", because
 * that view also holds parents, children and partners, and a label that
 * promises less than it shows is its own kind of confusion.
 */
export function ViewOptionsScreen({
  activeView,
  onChangeView,
  canUseFocalViews,
  showGenerations,
  onChangeShowGenerations,
  showPhotos,
  onChangeShowPhotos,
  familyGroups,
  collapsedGroupIds,
  onToggleFamilyGroup,
  onBack,
}: {
  activeView: ImplementedView
  onChangeView: (view: ImplementedView) => void
  /**
   * Three of the four views are measured FROM somebody. With nobody
   * chosen there is nothing to measure from, so they are offered but not
   * selectable, and each says why.
   */
  canUseFocalViews: boolean
  showGenerations: boolean
  onChangeShowGenerations: (next: boolean) => void
  showPhotos: boolean
  onChangeShowPhotos: (next: boolean) => void
  /**
   * Collapsing a branch is a question about what the tree shows, which is
   * what this screen is for. It used to be a popover over the canvas.
   */
  familyGroups: FamilyGroup[]
  collapsedGroupIds: ReadonlySet<string>
  onToggleFamilyGroup: (familyGroupId: string) => void
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
          <SectionHeader title="Who to show" />
          <div className="menu-list">
            {VIEW_CHOICES.map((choice) => {
              const needsSomebody = choice.view !== 'full'
              const unavailable = needsSomebody && !canUseFocalViews
              return (
                <ChoiceRow
                  key={choice.view}
                  label={choice.label}
                  description={unavailable ? 'Choose someone on the tree first' : undefined}
                  selected={activeView === choice.view}
                  disabled={unavailable}
                  onClick={() => {
                    onChangeView(choice.view)
                    onBack()
                  }}
                />
              )
            })}
          </div>

          <SectionHeader title="How to show them" />
          <div className="menu-list">
            <ToggleRow
              label="Show generations"
              checked={showGenerations}
              onChange={onChangeShowGenerations}
            />
            <ToggleRow label="Show photos" checked={showPhotos} onChange={onChangeShowPhotos} />
          </div>

          {/*
            Only when the family actually has named branches. An empty
            section headed "Family branches" would suggest a feature that
            has gone missing rather than one nobody has used yet.
          */}
          {familyGroups.length > 0 && (
            <>
              <SectionHeader title="Family branches" />
              <div className="menu-list">
                {familyGroups.map((group) => (
                  <ToggleRow
                    key={group.id}
                    label={group.name}
                    checked={!collapsedGroupIds.has(group.id)}
                    onChange={() => onToggleFamilyGroup(group.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
