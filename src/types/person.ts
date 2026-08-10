export type Gender = 'female' | 'male' | 'other' | 'unknown'

export interface Person {
  id: string
  familyTreeId: string
  firstName: string
  lastName: string
  gender: Gender
  birthDate?: string
  deathDate?: string
  isPlaceholder?: boolean
  notes?: string
  profilePhotoId?: string
  createdAt: string
  updatedAt: string
}
