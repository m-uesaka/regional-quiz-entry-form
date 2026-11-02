import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import type {CustomFieldValues} from '@regional-quiz/shared';
import type {Database as GeneratedDatabase} from '../types/database';
import type {Bindings} from '../types/env';

/** `T` flattened into one object type, keeping each member's modifiers. */
type Flatten<T> = {[K in keyof T]: T[K]};

/** `T` with the members `U` names replaced by `U`'s. */
type Override<T, U> = Flatten<Omit<T, keyof U> & U>;

type GeneratedPublic = GeneratedDatabase['public'];
type GeneratedTables = GeneratedPublic['Tables'];
type GeneratedFunctions = GeneratedPublic['Functions'];

/**
 * `entries` with `custom_field_values` narrowed from the generated `Json`:
 * every stored value originated from an `EntryInput['customFieldValues']`.
 */
type EntriesTable = Override<
  GeneratedTables['entries'],
  {
    Row: Override<
      GeneratedTables['entries']['Row'],
      {custom_field_values: CustomFieldValues}
    >;
    Insert: Override<
      GeneratedTables['entries']['Insert'],
      {custom_field_values?: CustomFieldValues}
    >;
    Update: Override<
      GeneratedTables['entries']['Update'],
      {custom_field_values?: CustomFieldValues}
    >;
  }
>;

/** Function `F` with the arguments `U` names replaced by `U`'s. */
type OverrideArgs<F extends keyof GeneratedFunctions, U> = Override<
  GeneratedFunctions[F],
  {Args: Override<GeneratedFunctions[F]['Args'], U>}
>;

/** Function `F` with its result replaced by `R`. */
type OverrideReturns<F extends keyof GeneratedFunctions, R> = Override<
  GeneratedFunctions[F],
  {Returns: R}
>;

/**
 * Where the functions differ from what the generator can see. It types
 * every function argument and result as non-null and every column a function
 * returns as non-null, and it cannot narrow what a function returns beyond
 * the column or enum type.
 *
 * A type alias, not an interface: the client requires the functions to be a
 * `Record`, which an interface is not assignable to.
 */
type FunctionOverrides = {
  // Only the two statuses a confirmation can end in.
  confirm_entry_by_token: OverrideReturns<
    'confirm_entry_by_token',
    'confirmed' | 'waitlisted'
  >;
  // A null `p_capacity` is stored as an uncapped tournament.
  import_tournament: OverrideArgs<
    'import_tournament',
    {p_capacity: number | null}
  >;
  // A null `p_free_text` is stored as-is, as an insert would.
  reenter_cancelled_entry: OverrideArgs<
    'reenter_cancelled_entry',
    {p_free_text: string | null; p_custom_field_values: CustomFieldValues}
  >;
  // Null, not an array, when the address turned out to be verified.
  take_over_unverified_participant: OverrideReturns<
    'take_over_unverified_participant',
    string[] | null
  >;
  // `tournament_name` and `capacity` carry the nullable `tournaments.name`
  // and `tournaments.capacity`.
  tournament_entry_summary: OverrideReturns<
    'tournament_entry_summary',
    Array<
      Override<
        GeneratedFunctions['tournament_entry_summary']['Returns'][number],
        {tournament_name: string | null; capacity: number | null}
      >
    >
  >;
};

/**
 * The schema generated from `supabase/migrations` (see `bun run db:types`),
 * with what the generator cannot know corrected here, once, rather than at
 * each query.
 */
export type Database = Override<
  GeneratedDatabase,
  {
    public: Override<
      GeneratedPublic,
      {
        Tables: Override<GeneratedTables, {entries: EntriesTable}>;
        Functions: Override<GeneratedFunctions, FunctionOverrides>;
      }
    >;
  }
>;

type PublicTables = Database['public']['Tables'];

/** A row of table `T`, as selected. */
export type Tables<T extends keyof PublicTables> = PublicTables[T]['Row'];

/** A row of table `T`, as inserted. */
export type TablesInsert<T extends keyof PublicTables> =
  PublicTables[T]['Insert'];

/** A row of table `T`, as updated. */
export type TablesUpdate<T extends keyof PublicTables> =
  PublicTables[T]['Update'];

/**
 * The Supabase client every backend module talks to the database through,
 * typed against `Database`.
 */
export type DbClient = SupabaseClient<Database>;

/**
 * Creates a Supabase client bound to the given Worker environment.
 *
 * Cloudflare Workers is not a Node.js runtime, so we rely on
 * `@supabase/supabase-js`'s fetch-based client rather than a
 * Node-specific driver.
 * @param env The Worker bindings containing the Supabase URL and
 *     secret key.
 */
export function createDbClient(env: Bindings): DbClient {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false,
    },
  });
}
