import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {EntryInputSchema} from '@regional-quiz/shared';
import type {Env} from '../types/env';
import {createEntry} from '../lib/entries';

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
      return c.json({error: result.error}, result.status);
    }
    return c.json(result.entry, 201);
  },
);
