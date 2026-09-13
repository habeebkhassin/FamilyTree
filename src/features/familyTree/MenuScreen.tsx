import { AppHeader, IconButton } from '../../components/AppShell'
import { MenuRow } from '../../components/Detail'
import { Icon } from '../../components/icons'

/**
 * The secondary menu — Phase 3.
 *
 * Everything you do occasionally, in one list, so the two screens people
 * actually use stay uncluttered.
 *
 * Every row here opens something real. Settings and Help are deliberately
 * absent rather than present and inert: a row that leads nowhere is worse
 * than no row, and adding them now would mean adding two empty screens to
 * keep them company.
 */
export function MenuScreen({
  treeName,
  onOpenFamilyGroups,
  onOpenBackup,
  onExport,
  onOpenIdentity,
  onBack,
}: {
  treeName: string
  onOpenFamilyGroups: () => void
  onOpenBackup: () => void
  onExport: () => void
  onOpenIdentity: () => void
  onBack: () => void
}) {
  return (
    <>
      <AppHeader
        title="My Family"
        subtitle={treeName}
        leading={
          <IconButton label="Back" onClick={onBack}>
            {Icon.back({ size: 20 })}
          </IconButton>
        }
      />
      <div className="app-page">
        <div className="app-page__inner">
          <div className="menu-list">
            <MenuRow
              icon={Icon.people()}
              label="Manage relatives"
              description="Branches and households you have named"
              onClick={onOpenFamilyGroups}
            />
            <MenuRow
              icon={Icon.cloud()}
              label="Backup & Sync"
              description="Save a copy of this family, or restore one"
              onClick={onOpenBackup}
            />
            <MenuRow
              icon={Icon.download()}
              label="Export tree"
              description="Download everything as a file"
              onClick={onExport}
            />
            <MenuRow
              icon={Icon.settings()}
              label="Who is editing"
              description="The name your changes are recorded under"
              onClick={onOpenIdentity}
            />
          </div>
        </div>
      </div>
    </>
  )
}
