import Dexie from 'dexie'
import type { Transaction } from 'dexie'

/**
 * Ties every event produced by one logical user action to a single id.
 *
 * The grouping is scoped to the Dexie TRANSACTION rather than passed
 * around as an argument. Every storage mutator already opens a
 * transaction, and Dexie joins a nested one into its parent when the table
 * scope is a subset — which is exactly what `createPersonWithRelationship`
 * does when it calls `createPerson` and `createParentLink` inside itself.
 * Reusing that existing boundary means:
 *
 *   - no public storage signature changes to thread an id through;
 *   - a cascade like deletePerson groups automatically, because all its
 *     writes are already in one transaction;
 *   - nested mutators group with their caller rather than each inventing
 *     their own id;
 *   - the group can never span a rollback, because the transaction is the
 *     same unit that commits or does not.
 *
 * The id is stashed on the root transaction object. Dexie may hand back a
 * child transaction for a nested scope, so the parent chain is walked to
 * the top — otherwise a nested mutation would start a second group inside
 * the first.
 */
interface ChangeSetCarrier {
  __changeSetId?: string
  parent?: Transaction
}

function rootTransaction(transaction: Transaction): Transaction {
  let current = transaction
  // `parent` is set on sub-transactions; the root is the unit that commits.
  while ((current as ChangeSetCarrier).parent) {
    current = (current as ChangeSetCarrier).parent as Transaction
  }
  return current
}

/**
 * The id for the change set currently in progress, creating one on first
 * use within a transaction.
 *
 * Outside a transaction there is nothing to group with, so each call is
 * its own change set of one. In practice every mutator runs inside a
 * transaction, so that path is a safety net rather than a normal case.
 */
export function currentChangeSetId(): string {
  const transaction = Dexie.currentTransaction
  if (!transaction) return crypto.randomUUID()

  const root = rootTransaction(transaction) as Transaction & ChangeSetCarrier
  if (!root.__changeSetId) {
    root.__changeSetId = crypto.randomUUID()
  }
  return root.__changeSetId
}
