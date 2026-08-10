import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createPerson,
  createPersonWithRelationship,
  deletePerson,
  getParentLinksByTree,
  getPeopleByTree,
  getUnionsByTree,
  linkRelative,
  updatePerson,
} from '../../lib/storage'
import type { CreatePersonInput, RelativeLinkKind } from '../../lib/storage'
import { createRelationshipEngine } from '../../lib/relationships/deriveRelationships'
import type { ParentLink, Person, Union } from '../../types'
import type { PersonChanges } from '../people/types'

type Status = 'loading' | 'ready' | 'error'

export function useFamilyGraph(familyTreeId: string) {
  const [people, setPeople] = useState<Person[]>([])
  const [parentLinks, setParentLinks] = useState<ParentLink[]>([])
  const [unions, setUnions] = useState<Union[]>([])
  const [status, setStatus] = useState<Status>('loading')

  const reload = useCallback(async () => {
    setStatus('loading')
    try {
      const [peopleList, parentLinkList, unionList] = await Promise.all([
        getPeopleByTree(familyTreeId),
        getParentLinksByTree(familyTreeId),
        getUnionsByTree(familyTreeId),
      ])
      peopleList.sort((a, b) => formatSortKey(a).localeCompare(formatSortKey(b)))
      setPeople(peopleList)
      setParentLinks(parentLinkList)
      setUnions(unionList)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [familyTreeId])

  useEffect(() => {
    void reload()
  }, [reload])

  const engine = useMemo(() => createRelationshipEngine(people, parentLinks, unions), [people, parentLinks, unions])

  const addPerson = useCallback(
    async (input: Omit<CreatePersonInput, 'familyTreeId'>) => {
      const person = await createPerson({ ...input, familyTreeId })
      await reload()
      return person
    },
    [familyTreeId, reload],
  )

  const editPerson = useCallback(
    async (id: string, changes: PersonChanges) => {
      await updatePerson(id, changes)
      await reload()
    },
    [reload],
  )

  const removePerson = useCallback(
    async (id: string) => {
      await deletePerson(id)
      await reload()
    },
    [reload],
  )

  /** Links an already-existing anchor and an already-existing other person. */
  const connectExisting = useCallback(
    async (anchorPersonId: string, otherPersonId: string, link: RelativeLinkKind) => {
      await linkRelative(familyTreeId, anchorPersonId, otherPersonId, link)
      await reload()
    },
    [familyTreeId, reload],
  )

  /** Creates a brand-new relative and links them to the anchor, atomically. */
  const createRelative = useCallback(
    async (input: Omit<CreatePersonInput, 'familyTreeId'>, anchorPersonId: string, link: RelativeLinkKind) => {
      const person = await createPersonWithRelationship({ ...input, familyTreeId }, anchorPersonId, link)
      await reload()
      return person
    },
    [familyTreeId, reload],
  )

  return {
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
  }
}

function formatSortKey(person: Person): string {
  return `${person.firstName} ${person.lastName}`.trim().toLowerCase()
}
