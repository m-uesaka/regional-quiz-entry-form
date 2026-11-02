/** Thrown when an API is called for a `tournamentId` that doesn't exist. */
export class TournamentNotFoundError extends Error {
  constructor(tournamentId: string) {
    super(`tournament not found: ${tournamentId}`);
    this.name = 'TournamentNotFoundError';
  }
}
