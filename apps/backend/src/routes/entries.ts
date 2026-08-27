import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {EntryInputSchema} from '@regional-quiz/shared';
import type {Env} from '../types/env';
import {createEntry} from '../lib/entries';
import {internalError} from '../lib/errors';

const TournamentIdParamSchema = z.object({tournamentId: z.string().uuid()});

export const entriesRoute = new Hono<Env>().post(
  '/:tournamentId/entries',
  zValidator('param', TournamentIdParamSchema),
  zValidator('json', EntryInputSchema),
  async c => {
    const result = await createEntry(
      c.env,
      c.req.valid('param').tournamentId,
      c.req.valid('json'),
    );
    if (!result.ok) {
      // Unauthenticated, and a 500 here carries whatever Supabase said
      // about the insert — kept server-side. The 4xx messages are the
      // ones the form maps to its own wording.
      if (result.status === 500) {
        return c.json(
          internalError('failed to create the entry', result.error),
          500,
        );
      }
      return c.json({error: result.error}, result.status);
    }
    return c.json(result.entry, 201);
  },
);
