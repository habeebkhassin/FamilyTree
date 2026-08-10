import { useState } from 'react'
import type { FamilyTree } from '../../types'
import { DuplicateRelationshipError, InvalidRelationshipError } from '../../lib/storage'
import { AddRelativeScreen } from '../people/AddRelativeScreen'
import { PersonForm } from '../people/PersonForm'
import type { PersonFormValues } from '../people/PersonForm'
import { PersonProfile } from '../people/PersonProfile'
import { formatName, formatParentLinkBadge, formatUnionStatusLabel } from '../people/personDisplay'
import type { LinkExtras, RelativeIntent } from '../people/types'
import { FamilyTreeHome } from './FamilyTreeHome'
import { useFamilyGraph } from './useFamilyGraph'
import './FamilyTreeWorkspace.css'

interface FamilyTreeWorkspaceProps {
  tree: FamilyTree
}

type View =
  | { screen: 'home' }
  | { screen: 'createPerson'; relativeIntent?: RelativeIntent }
  | { screen: 'editPerson'; personId: string }
  | { screen: 'personProfile'; personId: string }

function describeLinkError(error: unknown): string {
  if (error instanceof DuplicateRelationshipError) return error.message
  if (error instanceof InvalidRelationshipError) return error.message
  return 'Something went wrong connecting them.'
}

export function FamilyTreeWorkspace({ tree }: FamilyTreeWorkspaceProps) {
  const { people, status, reload, engine, addPerson, editPerson, removePerson, connectExisting, createRelative } =
    useFamilyGraph(tree.id)
  const [view, setView] = useState<View>({ screen: 'home' })
  const [linkError, setLinkError] = useState<string | null>(null)
  const [isLinking, setIsLinking] = useState(false)

  function goHome() {
    setLinkError(null)
    setView({ screen: 'home' })
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

  return (
    <div className="workspace">
      <header className="workspace__bar">
        <button type="button" className="workspace__brand" onClick={goHome}>
          {tree.name}
        </button>
      </header>

      <div className="workspace__content">
        {view.screen === 'home' && (
          <FamilyTreeHome
            tree={tree}
            people={people}
            status={status}
            onAddPerson={() => openCreatePerson()}
            onOpenPerson={openProfile}
            onRetry={reload}
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

            return (
              <PersonProfile
                person={person}
                parents={parents}
                children={children}
                siblings={siblings}
                partners={partners}
                onBack={goHome}
                onEdit={() => openEditPerson(person.id)}
                onDelete={() => handleDelete(person.id)}
                onAddRelative={(kind) =>
                  openCreatePerson({ kind, anchorPersonId: person.id, anchorName: formatName(person) })
                }
                onOpenPerson={openProfile}
              />
            )
          })()}
      </div>
    </div>
  )
}
