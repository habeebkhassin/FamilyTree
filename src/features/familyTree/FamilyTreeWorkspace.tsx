import { useCallback, useMemo, useState } from 'react'
import type { FamilyTree } from '../../types'
import { DuplicateRelationshipError, InvalidRelationshipError } from '../../lib/storage'
import { FamilyGroupDetail } from '../familyGroups/FamilyGroupDetail'
import type { FamilyGroupMembership } from '../familyGroups/FamilyGroupDetail'
import { FamilyGroupForm } from '../familyGroups/FamilyGroupForm'
import type { FamilyGroupFormValues } from '../familyGroups/FamilyGroupForm'
import { FamilyGroupsOverview } from '../familyGroups/FamilyGroupsOverview'
import { LocalActorBadge } from '../identity/LocalActorBadge'
import { usePolicy } from '../policy/usePolicy'
import { useFamilyGroups } from '../familyGroups/useFamilyGroups'
import { AddRelativeScreen } from '../people/AddRelativeScreen'
import { PersonForm } from '../people/PersonForm'
import type { PersonFormValues } from '../people/PersonForm'
import { PersonProfile } from '../people/PersonProfile'
import { formatName, formatParentLinkBadge, formatUnionStatusLabel } from '../people/personDisplay'
import type { LinkExtras, RelativeIntent } from '../people/types'
import { FamilyTreeCanvas } from '../tree-view/FamilyTreeCanvas'
import { PeopleScreen } from './PeopleScreen'
import { MenuScreen } from './MenuScreen'
import { ViewOptionsScreen } from './ViewOptionsScreen'
import type { ImplementedView } from '../tree-view/viewTypes'
import { exportFamilyTree, backupFilename, serialiseBackup } from '../../lib/backup'
import { BackupActions } from './BackupActions'
import {
  AppHeader,
  BottomNavigation,
  EmptyState,
  IconButton,
  type Destination,
} from '../../components/AppShell'
import { Icon } from '../../components/icons'
import { Button } from '../../components/Button'
import { useFamilyGraph } from './useFamilyGraph'
import { useFocalPerson } from './useFocalPerson'
import './FamilyTreeWorkspace.css'

interface FamilyTreeWorkspaceProps {
  tree: FamilyTree
  /** A restored backup created a new tree; the app should switch to it. */
  onTreeImported: (familyTreeId: string) => void
}

type View =
  | { screen: 'home' }
  | { screen: 'tree' }
  | { screen: 'createPerson'; relativeIntent?: RelativeIntent }
  | { screen: 'editPerson'; personId: string }
  | { screen: 'personProfile'; personId: string }
  | { screen: 'familyGroups' }
  | { screen: 'createFamilyGroup' }
  | { screen: 'editFamilyGroup'; familyGroupId: string }
  | { screen: 'familyGroupDetail'; familyGroupId: string }
  /** Backup, restore and who is editing — reached from the menu. */
  | { screen: 'settings' }
  | { screen: 'menu' }
  | { screen: 'viewOptions' }

function describeLinkError(error: unknown): string {
  if (error instanceof DuplicateRelationshipError) return error.message
  if (error instanceof InvalidRelationshipError) return error.message
  return 'Something went wrong connecting them.'
}

export function FamilyTreeWorkspace({ tree, onTreeImported }: FamilyTreeWorkspaceProps) {
  const {
    people,
    parentLinks,
    unions,
    status,
    reload,
    engine,
    addPerson,
    editPerson,
    removePerson,
    connectExisting,
    createRelative,
  } = useFamilyGraph(tree.id)
  // The one place the interface consults the policy engine. Components
  // receive decisions; none of them reason about roles themselves.
  const policy = usePolicy(tree.id)
  // The viewpoint lives here rather than in the canvas so the trail
  // survives stepping into a profile and back.
  const focal = useFocalPerson({
    familyTreeId: tree.id,
    people,
    claims: policy.claims,
    actorId: policy.actorId,
    isReady: status === 'ready',
  })
  const {
    familyGroups,
    members: familyGroupMembers,
    membersByGroupId,
    groupsByPersonId,
    addGroup,
    editGroup,
    removeGroup,
    addMember,
    removeMember,
  } = useFamilyGroups(tree.id)
  const [view, setView] = useState<View>({ screen: 'home' })
  const [linkError, setLinkError] = useState<string | null>(null)
  const [isLinking, setIsLinking] = useState(false)
  /**
   * Which family groups are drawn collapsed in the tree view. Purely a
   * visualization preference — deliberately NOT stored on FamilyGroup or
   * in IndexedDB, since collapsing changes nothing about the genealogy.
   * In-memory only for this phase; persistence comes later.
   */
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<ReadonlySet<string>>(() => new Set())

  const toggleFamilyGroup = useCallback((familyGroupId: string) => {
    setCollapsedGroupIds((previous) => {
      const next = new Set(previous)
      if (next.has(familyGroupId)) next.delete(familyGroupId)
      else next.add(familyGroupId)
      return next
    })
  }, [])

  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people])

  function goHome() {
    setLinkError(null)
    setView({ screen: 'home' })
  }

  function openSettings() {
    setView({ screen: 'settings' })
  }

  /**
   * What the tree is showing, and how it is drawn.
   *
   * Lifted out of the canvas in Phase 3 so the View options screen can
   * change it. Presentation state only — nothing here reaches genealogy.
   */
  const [treeView, setTreeView] = useState<ImplementedView>('full')
  const [showGenerations, setShowGenerations] = useState(true)
  const [showPhotos, setShowPhotos] = useState(true)

  async function handleExport() {
    const backup = await exportFamilyTree(tree.id)
    const blob = new Blob([serialiseBackup(backup)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = backupFilename(backup)
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  /**
   * Which of the two destinations the bottom bar should show as current.
   *
   * A secondary screen reached from People — a profile, a form — still
   * belongs to People, so the bar does not appear to jump while you are
   * several steps into something.
   */
  const destination: Destination = view.screen === 'tree' ? 'tree' : 'people'

  /** Only the two top-level destinations get the bar and the add button. */
  const isTopLevel = view.screen === 'home' || view.screen === 'tree'

  /**
   * Screens that draw their own header — Phase 3.
   *
   * They must not also get the workspace bar, or a person's profile
   * arrives under two title bars: the family's name and then their own.
   * The screens still on the old bar are the ones Phase 3 did not
   * redesign, and they keep it until they do.
   */
  const bringsOwnHeader =
    view.screen === 'personProfile' ||
    view.screen === 'editPerson' ||
    (view.screen === 'createPerson' && !view.relativeIntent) ||
    view.screen === 'menu' ||
    view.screen === 'viewOptions' ||
    view.screen === 'settings'

  function navigate(next: Destination) {
    // Clears any stale relationship error on the way out, which is what
    // the old per-screen openers each did for themselves.
    setLinkError(null)
    setView(next === 'tree' ? { screen: 'tree' } : { screen: 'home' })
  }

  function openProfile(personId: string) {
    setLinkError(null)
    setView({ screen: 'personProfile', personId })
  }

  function openCreatePerson(relativeIntent?: RelativeIntent) {
    setLinkError(null)
    setView({ screen: 'createPerson', relativeIntent })
  }

  function openEditPerson(personId: string) {
    setLinkError(null)
    setView({ screen: 'editPerson', personId })
  }

  function openFamilyGroups() {
    setLinkError(null)
    setView({ screen: 'familyGroups' })
  }

  function openCreateFamilyGroup() {
    setLinkError(null)
    setView({ screen: 'createFamilyGroup' })
  }

  function openEditFamilyGroup(familyGroupId: string) {
    setLinkError(null)
    setView({ screen: 'editFamilyGroup', familyGroupId })
  }

  function openFamilyGroupDetail(familyGroupId: string) {
    setLinkError(null)
    setView({ screen: 'familyGroupDetail', familyGroupId })
  }

  async function handleCreateSubmit(values: PersonFormValues) {
    const person = await addPerson(values)
    openProfile(person.id)
  }

  async function handleEditSubmit(personId: string, values: PersonFormValues) {
    await editPerson(personId, values)
    openProfile(personId)
  }

  async function handleDelete(personId: string) {
    await removePerson(personId)
    goHome()
  }

  async function handleConnectExisting(personId: string, intent: RelativeIntent, extras: LinkExtras) {
    setLinkError(null)
    setIsLinking(true)
    try {
      await connectExisting(intent.anchorPersonId, personId, extras)
      openProfile(intent.anchorPersonId)
    } catch (error) {
      setLinkError(describeLinkError(error))
    } finally {
      setIsLinking(false)
    }
  }

  /**
   * Person creation and the ParentLink/Union write happen atomically in
   * one Dexie transaction (createRelative -> createPersonWithRelationship)
   * — so on failure nothing was created at all. Stay on this screen
   * rather than navigating to a person who doesn't exist.
   */
  async function handleCreateRelativeSubmit(values: PersonFormValues, intent: RelativeIntent, extras: LinkExtras) {
    setLinkError(null)
    setIsLinking(true)
    try {
      const person = await createRelative(values, intent.anchorPersonId, extras)
      openProfile(person.id)
    } catch (error) {
      setLinkError(describeLinkError(error))
    } finally {
      setIsLinking(false)
    }
  }

  async function handleCreateFamilyGroupSubmit(values: FamilyGroupFormValues) {
    const group = await addGroup(values)
    openFamilyGroupDetail(group.id)
  }

  async function handleEditFamilyGroupSubmit(familyGroupId: string, values: FamilyGroupFormValues) {
    await editGroup(familyGroupId, values)
    openFamilyGroupDetail(familyGroupId)
  }

  async function handleDeleteFamilyGroup(familyGroupId: string) {
    await removeGroup(familyGroupId)
    openFamilyGroups()
  }

  const headerActions = (
    <IconButton label="Menu" onClick={() => setView({ screen: 'menu' })}>
      {Icon.more({ size: 20 })}
    </IconButton>
  )

  return (
    <div className="workspace">
      {isTopLevel ? (
        <AppHeader
          title={view.screen === 'tree' ? 'My Family' : 'People'}
          subtitle={view.screen === 'tree' ? tree.name : undefined}
          actions={headerActions}
        />
      ) : view.screen === 'settings' ? (
        <AppHeader
          title="Backup & Sync"
          leading={
            <IconButton label="Back" onClick={() => setView({ screen: 'menu' })}>
              {Icon.back({ size: 20 })}
            </IconButton>
          }
        />
      ) : bringsOwnHeader ? null : (
        <header className="workspace__bar">
          <button type="button" className="workspace__brand" onClick={goHome}>
            {tree.name}
          </button>
          <LocalActorBadge onActorChange={() => void policy.reload()} />
        </header>
      )}

      <div className={view.screen === 'tree' ? 'app-page app-page--flush' : 'app-page'}>
        {view.screen === 'home' && (
          <div className="app-page__inner">
            <PeopleScreen
              people={people}
              status={status}
              onOpenPerson={openProfile}
              onAddPerson={() => openCreatePerson()}
              onRetry={reload}
            />
          </div>
        )}

        {view.screen === 'menu' && (
          <MenuScreen
            treeName={tree.name}
            onOpenFamilyGroups={openFamilyGroups}
            onOpenBackup={openSettings}
            onExport={() => void handleExport()}
            onOpenIdentity={openSettings}
            onBack={goHome}
          />
        )}

        {view.screen === 'viewOptions' && (
          <ViewOptionsScreen
            activeView={treeView}
            onChangeView={setTreeView}
            showGenerations={showGenerations}
            onChangeShowGenerations={setShowGenerations}
            showPhotos={showPhotos}
            onChangeShowPhotos={setShowPhotos}
            onBack={() => setView({ screen: 'tree' })}
          />
        )}

        {view.screen === 'settings' && (
          <div className="app-page__inner">
            <LocalActorBadge onActorChange={() => void policy.reload()} />
            <BackupActions tree={tree} onImported={onTreeImported} />
          </div>
        )}

        {view.screen === 'tree' && status === 'ready' && people.length === 0 && (
          <div className="app-page__inner">
            <EmptyState
              title="Start your family tree"
              body="Add your family members and keep your family history alive."
              action={<Button onClick={() => openCreatePerson()}>+ Add first person</Button>}
            />
          </div>
        )}

        {view.screen === 'tree' && people.length > 0 && (
          <FamilyTreeCanvas
            people={people}
            parentLinks={parentLinks}
            unions={unions}
            familyGroups={familyGroups}
            familyGroupMembers={familyGroupMembers}
            collapsedGroupIds={collapsedGroupIds}
            onToggleFamilyGroup={toggleFamilyGroup}
            onSelectPerson={openProfile}
            focalPersonId={focal.focalPersonId ?? undefined}
            onFocusPerson={focal.focusOn}
            focusHistory={focal.history}
            onFocusBack={focal.goBack}
            claimedPersonId={policy.claimedPersonId}
            shouldPromptForFocus={focal.shouldPromptForFocus}
            onDismissFocusPrompt={focal.dismissPrompt}
            requestedView={treeView}
            onChangeView={setTreeView}
            onOpenViewOptions={() => setView({ screen: 'viewOptions' })}
            showGenerations={showGenerations}
            showPhotos={showPhotos}
          />
        )}

        {view.screen === 'createPerson' &&
          (() => {
            const intent = view.relativeIntent
            if (!intent) {
              return <PersonForm mode="create" onSubmit={handleCreateSubmit} onCancel={goHome} />
            }
            return (
              <AddRelativeScreen
                intent={intent}
                anchorParents={engine.getParents(intent.anchorPersonId)}
                candidates={people.filter((person) => person.id !== intent.anchorPersonId)}
                error={linkError}
                isBusy={isLinking}
                onConnectExisting={(personId, extras) => handleConnectExisting(personId, intent, extras)}
                onCreateNew={(values, extras) => handleCreateRelativeSubmit(values, intent, extras)}
                onCancel={() => openProfile(intent.anchorPersonId)}
                onGoAddParent={() =>
                  openCreatePerson({ kind: 'parent', anchorPersonId: intent.anchorPersonId, anchorName: intent.anchorName })
                }
              />
            )
          })()}

        {view.screen === 'editPerson' &&
          (() => {
            const person = people.find((candidate) => candidate.id === view.personId)
            if (!person) return null
            return (
              <PersonForm
                mode="edit"
                initialValues={person}
                onSubmit={(values) => handleEditSubmit(person.id, values)}
                onCancel={() => openProfile(person.id)}
              />
            )
          })()}

        {view.screen === 'personProfile' &&
          (() => {
            const person = people.find((candidate) => candidate.id === view.personId)
            if (!person) return null

            const parents = engine.getParents(person.id).map((related) => ({
              id: related.parentLinkId,
              person: related.person,
              badge: formatParentLinkBadge(related.relationship),
            }))
            const children = engine.getChildren(person.id).map((related) => ({
              id: related.parentLinkId,
              person: related.person,
              badge: formatParentLinkBadge(related.relationship),
            }))
            const siblings = [
              ...engine.getSiblings(person.id).map((related) => ({ id: related.person.id, person: related.person })),
              ...engine
                .getHalfSiblings(person.id)
                .map((related) => ({ id: related.person.id, person: related.person, badge: 'Half-sibling' })),
            ]
            const partners = engine.getPartners(person.id).map((related) => ({
              id: related.union.id,
              person: related.person,
              badge: formatUnionStatusLabel(related.union.status),
            }))

            const familyGroupMemberships = (groupsByPersonId.get(person.id) ?? []).map((entry) => ({
              membershipId: entry.membershipId,
              group: entry.group,
            }))
            const memberFamilyGroupIds = new Set(familyGroupMemberships.map((entry) => entry.group.id))
            const availableFamilyGroups = familyGroups.filter((group) => !memberFamilyGroupIds.has(group.id))

            return (
              <PersonProfile
                person={person}
                policy={{
                  canEdit: policy.check('person.update', { personId: person.id }),
                  canDelete: policy.check('person.delete', { personId: person.id }),
                  isClaimedByYou: policy.claimedPersonId === person.id,
                  isClaimedByAnother: policy.isClaimedByAnother(person.id),
                  // Claiming is only offered when nobody holds this record
                  // and this actor has not already said they are someone else.
                  ...(policy.claimedPersonId === null && !policy.isClaimedByAnother(person.id)
                    ? { onClaim: () => void policy.claimPerson(person.id) }
                    : {}),
                }}
                parents={parents}
                children={children}
                siblings={siblings}
                partners={partners}
                familyGroupMemberships={familyGroupMemberships}
                availableFamilyGroups={availableFamilyGroups}
                onBack={goHome}
                onEdit={() => openEditPerson(person.id)}
                onDelete={() => handleDelete(person.id)}
                onAddRelative={(kind) =>
                  openCreatePerson({ kind, anchorPersonId: person.id, anchorName: formatName(person) })
                }
                onOpenPerson={openProfile}
                onAddToFamilyGroup={(familyGroupId) => addMember(familyGroupId, person.id)}
                onRemoveFromFamilyGroup={removeMember}
                onOpenFamilyGroup={openFamilyGroupDetail}
                onCreateFamilyGroup={openCreateFamilyGroup}
              />
            )
          })()}

        {view.screen === 'familyGroups' && (
          <FamilyGroupsOverview
            familyGroups={familyGroups}
            memberCountByGroupId={
              new Map(familyGroups.map((group) => [group.id, (membersByGroupId.get(group.id) ?? []).length]))
            }
            peopleById={peopleById}
            onBack={goHome}
            onCreate={openCreateFamilyGroup}
            onOpenGroup={openFamilyGroupDetail}
          />
        )}

        {view.screen === 'createFamilyGroup' && (
          <FamilyGroupForm
            mode="create"
            people={people}
            onSubmit={handleCreateFamilyGroupSubmit}
            onCancel={openFamilyGroups}
          />
        )}

        {view.screen === 'editFamilyGroup' &&
          (() => {
            const group = familyGroups.find((candidate) => candidate.id === view.familyGroupId)
            if (!group) return null
            return (
              <FamilyGroupForm
                mode="edit"
                initialValues={group}
                people={people}
                onSubmit={(values) => handleEditFamilyGroupSubmit(group.id, values)}
                onCancel={() => openFamilyGroupDetail(group.id)}
              />
            )
          })()}

        {view.screen === 'familyGroupDetail' &&
          (() => {
            const group = familyGroups.find((candidate) => candidate.id === view.familyGroupId)
            if (!group) return null

            const memberships: FamilyGroupMembership[] = (membersByGroupId.get(group.id) ?? [])
              .map((member) => {
                const person = peopleById.get(member.personId)
                return person ? { membershipId: member.id, person } : null
              })
              .filter((entry): entry is FamilyGroupMembership => entry !== null)
            const memberPersonIds = new Set(memberships.map((entry) => entry.person.id))
            const candidates = people.filter((person) => !memberPersonIds.has(person.id))
            const originPerson = group.originPersonId ? peopleById.get(group.originPersonId) : undefined

            return (
              <FamilyGroupDetail
                familyGroup={group}
                memberships={memberships}
                candidates={candidates}
                originPerson={originPerson}
                onBack={openFamilyGroups}
                onEdit={() => openEditFamilyGroup(group.id)}
                onDelete={() => handleDeleteFamilyGroup(group.id)}
                onAddMember={(personId) => addMember(group.id, personId)}
                onRemoveMember={removeMember}
                onOpenPerson={openProfile}
              />
            )
          })()}
      </div>

      {isTopLevel && (
        <>
          {/*
            One obvious action per destination, and only where it means
            something. An empty family already shows "Add first person" in
            the middle of the screen, so a second button offering the same
            thing would only be two ways to do one thing.
          */}
          <BottomNavigation
            current={destination}
            onNavigate={navigate}
            {...(people.length > 0
              ? { onAdd: () => openCreatePerson(), addLabel: 'Add a person' }
              : {})}
          />
        </>
      )}
    </div>
  )
}
