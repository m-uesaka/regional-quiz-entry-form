import type {TournamentType} from '@regional-quiz/shared';

/**
 * A form definition's unsaved YAML, kept in the tab's session storage so
 * that what the page can't hold on to itself -- a `load` re-run that shows
 * the error page, a reload -- doesn't throw it away (#338).
 *
 * Session storage rather than local: the draft belongs to the tab it was
 * typed in, and goes when the tab does. Every access is wrapped, since
 * storage can be blocked or full; a draft that can't be kept is only a
 * draft the page loses the way it did before.
 */
interface StoredDraft {
  /** The stored text the draft was typed over. */
  base: string;
  yaml: string;
}

/**
 * Keyed on the type as well as the tournament: the YAML names the type, so a
 * draft typed for the other one is one the API would refuse.
 */
function draftKey(tournamentId: string, type: TournamentType): string {
  return `form-definition-draft:${tournamentId}:${type}`;
}

/**
 * The draft left behind for the tournament, if it was typed over the
 * definition stored now. One typed over an older definition is dropped
 * rather than brought back over what has been saved since.
 * @param tournamentId The tournament.
 * @param type Its type.
 * @param base The stored definition, as YAML.
 * @return The draft, or null.
 */
export function readYamlDraft(
  tournamentId: string,
  type: TournamentType,
  base: string,
): string | null {
  try {
    const raw = sessionStorage.getItem(draftKey(tournamentId, type));
    if (raw === null) {
      return null;
    }
    const draft = JSON.parse(raw) as Partial<StoredDraft>;
    if (draft.base === base && typeof draft.yaml === 'string') {
      return draft.yaml;
    }
    sessionStorage.removeItem(draftKey(tournamentId, type));
    return null;
  } catch {
    return null;
  }
}

/**
 * Keeps the draft for the tournament.
 * @param tournamentId The tournament.
 * @param type Its type.
 * @param base The stored definition the draft was typed over.
 * @param yaml The draft.
 */
export function writeYamlDraft(
  tournamentId: string,
  type: TournamentType,
  base: string,
  yaml: string,
): void {
  try {
    sessionStorage.setItem(
      draftKey(tournamentId, type),
      JSON.stringify({base, yaml} satisfies StoredDraft),
    );
  } catch {
    // Not kept: see the module comment.
  }
}

/**
 * Forgets the tournament's draft: it was saved, or let go on purpose.
 * @param tournamentId The tournament.
 * @param type Its type.
 */
export function clearYamlDraft(
  tournamentId: string,
  type: TournamentType,
): void {
  try {
    sessionStorage.removeItem(draftKey(tournamentId, type));
  } catch {
    // Nothing to forget.
  }
}
