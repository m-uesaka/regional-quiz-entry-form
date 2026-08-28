/**
 * The SQLSTATE the tournament-scoped Postgres functions
 * (`sync_form_field_defs()`, `sync_regulations()`) raise when the tournament
 * they were called for doesn't exist.
 */
export const TOURNAMENT_NOT_FOUND_SQLSTATE = 'P0002';

/** Thrown when an API is called for a `tournamentId` that doesn't exist. */
export class TournamentNotFoundError extends Error {
  constructor(tournamentId: string) {
    super(`tournament not found: ${tournamentId}`);
    this.name = 'TournamentNotFoundError';
  }
}
