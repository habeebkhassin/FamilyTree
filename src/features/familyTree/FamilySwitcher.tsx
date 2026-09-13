import { useEffect, useState } from 'react'
import type { FamilyTree } from '../../types'
import { getAllFamilyTrees } from '../../lib/storage'
import { ChoiceRow } from '../../components/Detail'
import { AppHeader, IconButton } from '../../components/AppShell'
import { Icon } from '../../components/icons'

/**
 * Choosing which family to look at.
 *
 * The application has always been able to hold more than one family —
 * `getAllFamilyTrees` and the stored active id have been there since the
 * beginning, and restoring a backup creates a second one — but there has
 * never been a way to get back to the first. So the chevron beside the
 * family name in the header is not decoration: it opens this, and it is
 * only drawn at all when there is genuinely somewhere else to go.
 *
 * Reads the existing storage API and sets the existing active-tree
 * preference. It creates nothing and changes no genealogy.
 */
export function FamilySwitcher({
  activeTreeId,
  onPick,
  onBack,
}: {
  activeTreeId: string
  onPick: (familyTreeId: string) => void
  onBack: () => void
}) {
  const [trees, setTrees] = useState<FamilyTree[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void getAllFamilyTrees().then((found) => {
      if (!cancelled) setTrees(found)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <AppHeader
        title="Your families"
        leading={
          <IconButton label="Back" onClick={onBack}>
            {Icon.back({ size: 20 })}
          </IconButton>
        }
      />
      <div className="app-page">
        <div className="app-page__inner">
          {trees === null ? (
            <p className="people__status">Loading…</p>
          ) : (
            <div className="menu-list">
              {trees.map((tree) => (
                <ChoiceRow
                  key={tree.id}
                  label={tree.name}
                  description={tree.description || undefined}
                  selected={tree.id === activeTreeId}
                  onClick={() => {
                    // Re-picking the family already open is a no-op worth
                    // handling here rather than reloading everything.
                    if (tree.id === activeTreeId) onBack()
                    else onPick(tree.id)
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
