import type { EventAction } from '../core/events'

/**
 * A single command from the seed's event log, replayed in chronological
 * (ascending id) order. `payload` is the JSON-parsed event payload — its
 * shape depends on `action` (see `src/core/engine.ts`'s `appendEvent` call
 * sites for exactly what each action's payload carries).
 *
 * This is the ONLY type the `src/naive/*` baselines import: they replay the
 * same recorded command stream the seed produced, deliberately in isolation
 * from `src/core/billing.ts` (they are the wrong implementations, kept
 * naive on purpose).
 */
export interface CommandRecord {
  action: EventAction
  at: string
  payload: unknown
}
