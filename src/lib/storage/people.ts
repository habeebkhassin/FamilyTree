import { db } from './db'
import type { Person } from '../../types'

export type CreatePersonInput = Omit<Person, 'id' | 'createdAt' | 'updatedAt'>

export async function createPerson(input: CreatePersonInput): Promise<Person> {
  const now = new Date().toISOString()
  const person: Person = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  }
  await db.people.add(person)
  return person
}

export function getPerson(id: string): Promise<Person | undefined> {
  return db.people.get(id)
}

export function getPeopleByTree(familyTreeId: string): Promise<Person[]> {
  return db.people.where('familyTreeId').equals(familyTreeId).toArray()
}

export async function updatePerson(
  id: string,
  changes: Partial<Omit<Person, 'id' | 'familyTreeId' | 'createdAt' | 'updatedAt'>>,
): Promise<void> {
  await db.people.update(id, { ...changes, updatedAt: new Date().toISOString() })
}

export function deletePerson(id: string): Promise<void> {
  return db.people.delete(id)
}
