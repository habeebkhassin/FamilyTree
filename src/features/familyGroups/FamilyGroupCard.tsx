import type { FamilyGroup } from '../../types'
import { formatFamilyGroupOrigin, formatMemberCount } from './familyGroupDisplay'
import './FamilyGroupCard.css'

interface FamilyGroupCardProps {
  familyGroup: FamilyGroup
  memberCount: number
  originPersonName?: string
  onClick?: () => void
}

export function FamilyGroupCard({ familyGroup, memberCount, originPersonName, onClick }: FamilyGroupCardProps) {
  const origin = formatFamilyGroupOrigin(familyGroup)
  const metaParts = [
    origin ? `Established ${origin}` : null,
    originPersonName ? `Founded by ${originPersonName}` : null,
    formatMemberCount(memberCount),
  ].filter((part): part is string => Boolean(part))

  return (
    <button type="button" className="family-group-card" onClick={onClick}>
      <span className="family-group-card__name">{familyGroup.name}</span>
      {familyGroup.notes && <span className="family-group-card__description">{familyGroup.notes}</span>}
      <span className="family-group-card__meta">{metaParts.join(' · ')}</span>
    </button>
  )
}
