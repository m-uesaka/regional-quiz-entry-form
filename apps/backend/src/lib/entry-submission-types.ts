/**
 * @fileoverview The types the stages of an entry submission share:
 * `entry-submission.ts` (the flow), `entry-write.ts`, `entry-takeover.ts` and
 * `entry-unauthenticated.ts` all import from here, and this imports from none
 * of them.
 */

import type {Tables} from './db';
import {UnexpectedFailure, type ClientFailure} from './errors';

export type CreateEntryResult =
  {ok: true; entry: {id: string}} | ClientFailure<400 | 401 | 403 | 409>;

/**
 * What `createEntryAfterCheck()` comes to. A submission that took an
 * unverified account over and then failed also carries the tournaments
 * whose pending entries the takeover withdrew: the takeover can't be undone,
 * so the notice of the failure is where the owner learns of them (#291).
 */
export type AddressEntryResult =
  | CreateEntryResult
  | (Extract<CreateEntryResult, {ok: false}> & {
      withdrawnTournaments: string[];
    });

/**
 * An `UnexpectedFailure` of the entry that followed a takeover of an
 * unverified account (#189). The takeover is already committed and can't be
 * undone, so the failure carries the tournaments it withdrew entries from, for
 * the notice of the failure (#291) -- as a returned failure does in
 * `AddressEntryResult`. To `app.onError` it is any other `UnexpectedFailure`.
 */
export class FailureAfterTakeover extends UnexpectedFailure {
  constructor(
    failure: UnexpectedFailure,
    readonly withdrawnTournaments: string[] | undefined,
  ) {
    super(failure.context, failure.cause);
  }
}

/**
 * When the mail of an anonymous entry goes out: at once, or later from the
 * queue because its address was over the per-address limit when it was
 * submitted (#346, `lib/deferred-entry-mail.ts`). The entry itself is made
 * the same way either way.
 */
export type EntryMailDelivery = 'now' | 'deferred';

/**
 * The tournament an entry submission is checked against. `capacity` is null
 * for an uncapped tournament, which can never waitlist anyone.
 */
export interface EntryTournamentRow extends Pick<
  Tables<'tournaments'>,
  | 'id'
  | 'name'
  | 'type'
  | 'capacity'
  | 'entry_opens_at'
  | 'entry_closes_at'
  | 'entries_paused'
> {
  // A to-one embed, so PostgREST answers with the region object itself
  // rather than a single-element array (unlike `regulations` below).
  regions: Pick<Tables<'regions'>, 'name'>;
  regulations: Array<
    Pick<
      Tables<'regulations'>,
      'id' | 'priority_starts_at' | 'priority_ends_at' | 'closes_with_priority'
    >
  >;
}
