import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addFamilyGroupMember,
  createFamilyGroup,
  deleteFamilyGroup,
  getFamilyGroupMembersByTree,
  getFamilyGroupsByTree,
  removeFamilyGroupMember,
  updateFamilyGroup,
} from '../../lib/storage'
import type { CreateFamilyGroupInput, UpdateFamilyGroupInput } from '../../lib/storage'
import type { FamilyGroup, FamilyGroupMember } from '../../types'

type Status = 'loading' | 'ready' | 'error'

/**
 * Loads every FamilyGroup and FamilyGroupMember row for one FamilyTree —
 * mirrors useFamilyGraph.ts's shape (status/reload + mutator callbacks
 * that reload afterward). Kept entirely separate from useFamilyGraph:
 * FamilyGroup is an organizational layer over the genealogy graph, not
 * part of it, so this hook never touches people/parentLinks/unions state.
 */
export function useFamilyGroups(familyTreeId: string) {
  const [familyGroups, setFamilyGroups] = useState<FamilyGroup[]>([])
  const [members, setMembers] = useState<FamilyGroupMember[]>([])
  const [status, setStatus] = useState<Status>('loading')

  const reload = useCallback(async () => {
    setStatus('loading')
    try {
      const [groups, memberRows] = await Promise.all([
        getFamilyGroupsByTree(familyTreeId),
        getFamilyGroupMembersByTree(familyTreeId),
      ])
      groups.sort((a, b) => a.name.localeCompare(b.name))
      setFamilyGroups(groups)
      setMembers(memberRows)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [familyTreeId])

  useEffect(() => {
    void reload()
  }, [reload])

  const membersByGroupId = useMemo(() => {
    const map = new Map<string, FamilyGroupMember[]>()
    for (const member of members) {
      const list = map.get(member.familyGroupId) ?? []
      list.push(member)
      map.set(member.familyGroupId, list)
    }
    return map
  }, [members])

  const groupsByPersonId = useMemo(() => {
    const groupById = new Map(familyGroups.map((group) => [group.id, group]))
    const map = new Map<string, { membershipId: string; group: FamilyGroup }[]>()
    for (const member of members) {
      const group = groupById.get(member.familyGroupId)
      if (!group) continue
      const list = map.get(member.personId) ?? []
      list.push({ membershipId: member.id, group })
      map.set(member.personId, list)
    }
    return map
  }, [familyGroups, members])

  const addGroup = useCallback(
    async (input: Omit<CreateFamilyGroupInput, 'familyTreeId'>) => {
      const group = await createFamilyGroup({ ...input, familyTreeId })
      await reload()
      return group
    },
    [familyTreeId, reload],
  )

  const editGroup = useCallback(
    async (id: string, changes: UpdateFamilyGroupInput) => {
      await updateFamilyGroup(id, changes)
      await reload()
    },
    [reload],
  )

  const removeGroup = useCallback(
    async (id: string) => {
      await deleteFamilyGroup(id)
      await reload()
    },
    [reload],
  )

  const addMember = useCallback(
    async (familyGroupId: string, personId: string) => {
      await addFamilyGroupMember({ familyTreeId, familyGroupId, personId })
      await reload()
    },
    [familyTreeId, reload],
  )

  const removeMember = useCallback(
    async (membershipId: string) => {
      await removeFamilyGroupMember(membershipId)
      await reload()
    },
    [reload],
  )

  return {
    familyGroups,
    status,
    reload,
    membersByGroupId,
    groupsByPersonId,
    addGroup,
    editGroup,
    removeGroup,
    addMember,
    removeMember,
  }
}
