import type {TournamentType} from '@regional-quiz/shared';

/** Values collected by `TournamentForm`, ready to send to the tournaments API. */
export interface TournamentFormValues {
  regionId: string;
  type: TournamentType;
  name: string;
  capacity: number | null;
  entryOpensAt: string;
  entryClosesAt: string;
}

/**
 * Initial values used to pre-populate `TournamentForm`, e.g. when editing an
 * existing tournament. All fields are optional so the same type can describe
 * an empty "create" form.
 */
export interface TournamentFormInitialValues {
  regionId?: string;
  type?: TournamentType;
  name?: string;
  capacity?: number | null;
  entryOpensAt?: string;
  entryClosesAt?: string;
}
