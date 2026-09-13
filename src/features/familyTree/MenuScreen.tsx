import { AppHeader } from '../../components/AppShell'
import { MenuRow } from '../../components/Detail'
import { Icon } from '../../components/icons'

/**
 * More — the third destination.
 *
 * Everything you do occasionally, in one list, so the two screens people
 * actually use stay uncluttered. It is a place in the bottom bar rather
 * than a menu hidden behind an icon, because a reader should be able to
 * see that there IS more without first having to discover it.
 *
 * Every row here opens something real. Settings and Help are deliberately
 * absent rather than present and inert: a row that leads nowhere is worse
 * than no row, and adding them now would mean adding two empty screens to
 * keep them company.
 */
export function MenuScreen({
  treeName,
  onAddPerson,
  onOpenFamilyGroups,
  onOpenBackup,
  onExport,
  onOpenIdentity,
  onSwitchFamily,
  onOpenAccount,
  accountSummary,
}: {
  treeName: string
  onAddPerson: () => void
  onOpenFamilyGroups: () => void
  onOpenBackup: () => void
  onExport: () => void
  onOpenIdentity: () => void
  /** Absent when this device holds only one family. */
  onSwitchFamily?: () => void
  /**
   * Absent when this copy of FamilyTree has no cloud configured. A row
   * offering to sign in to nothing would be exactly the dead end this
   * menu has always refused to carry.
   */
  onOpenAccount?: () => void
  /** What the account row says underneath — an email, or an invitation. */
  accountSummary?: string
}) {
  return (
    <>
      {/*
        A destination in the bottom bar now rather than a screen reached
        from the header, so it carries no back button: you leave it the
        way you arrived, by choosing Tree or People.
      */}
      <AppHeader title="More" subtitle={treeName} />
      <div className="app-page">
        <div className="app-page__inner">
          <div className="menu-list">
            <MenuRow
              icon={Icon.people()}
              label="Add a person"
              description="Put somebody new into this family"
              onClick={onAddPerson}
            />
            <MenuRow
              icon={Icon.branch()}
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
            {onOpenAccount && (
              <MenuRow
                icon={Icon.cloud()}
                label="Account"
                description={accountSummary ?? 'Sign in to use FamilyTree on your other devices'}
                onClick={onOpenAccount}
              />
            )}
            {/* Only when there is another family to switch to. */}
            {onSwitchFamily && (
              <MenuRow
                icon={Icon.layers()}
                label="Switch family"
                description="Open another family tree on this device"
                onClick={onSwitchFamily}
              />
            )}
          </div>
        </div>
      </div>
    </>
  )
}
