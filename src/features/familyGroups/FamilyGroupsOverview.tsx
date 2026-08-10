import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import type { FamilyGroup, Person } from '../../types'
import { formatName } from '../people/personDisplay'
import { FamilyGroupCard } from './FamilyGroupCard'
import './FamilyGroupsOverview.css'

interface FamilyGroupsOverviewProps {
  familyGroups: FamilyGroup[]
  memberCountByGroupId: Map<string, number>
  peopleById: Map<string, Person>
  onBack: () => void
  onCreate: () => void
  onOpenGroup: (familyGroupId: string) => void
}

export function FamilyGroupsOverview({
  familyGroups,
  memberCountByGroupId,
  peopleById,
  onBack,
  onCreate,
  onOpenGroup,
}: FamilyGroupsOverviewProps) {
  return (
    <div className="family-groups-overview">
      <button type="button" className="family-groups-overview__back" onClick={onBack}>
        ← Back to family tree
      </button>

      <header className="family-groups-overview__header">
        <div>
          <p className="family-groups-overview__eyebrow">Organizational layer</p>
          <h1 className="family-groups-overview__title">Family Groups</h1>
          <p className="family-groups-overview__subtitle">
            Group people into lineages like "Mother's Family" or "Khassin Family." This is separate from — and never
            changes — the parent and partner connections in your tree.
          </p>
        </div>
        <Button onClick={onCreate}>Create Family Group</Button>
      </header>

      {familyGroups.length === 0 ? (
        <Card className="family-groups-overview__empty">
          <h2 className="family-groups-overview__empty-title">No family groups yet.</h2>
          <p className="family-groups-overview__empty-text">
            Create one to organize part of your tree into a named lineage.
          </p>
          <Button onClick={onCreate}>Create Family Group</Button>
        </Card>
      ) : (
        <div className="family-groups-overview__grid">
          {familyGroups.map((group) => {
            const originPerson = group.originPersonId ? peopleById.get(group.originPersonId) : undefined
            return (
              <FamilyGroupCard
                key={group.id}
                familyGroup={group}
                memberCount={memberCountByGroupId.get(group.id) ?? 0}
                originPersonName={originPerson ? formatName(originPerson) : undefined}
                onClick={() => onOpenGroup(group.id)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
