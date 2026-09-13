import type { ImplementedView } from '../tree-view/viewTypes'

/**
 * What the tree can show, in plain words — Phase 3.
 *
 * Named honestly rather than tidily. "My close family" is not "Siblings
 * only", because that view also holds parents, children and partners, and
 * a label that promises less than it shows is its own kind of confusion.
 *
 * A data file rather than part of the screen, so the screen exports only
 * a component.
 */
export const VIEW_CHOICES: { view: ImplementedView; label: string }[] = [
  { view: 'full', label: 'All family members' },
  { view: 'my-family', label: 'My close family' },
  { view: 'lineage', label: 'Parents and ancestors' },
  { view: 'descendants', label: 'Children and descendants' },
]
