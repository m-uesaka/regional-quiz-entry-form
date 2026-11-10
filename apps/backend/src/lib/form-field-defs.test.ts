import {afterEach, beforeEach, describe, expect, it} from 'bun:test';
import {testBindings} from '../test-support/bindings';
import {createDbClient} from './db';
import {UnexpectedFailure} from './errors';
import {fetchFormFieldDefs, validateCustomFieldValues} from './form-field-defs';

const TOURNAMENT_ID = '22222222-2222-4222-8222-222222222222';

const SHIRT_SIZE_ROW = {
  field_key: 'shirt_size',
  label: 'Tシャツサイズ',
  field_type: 'radio',
  required: true,
  options: ['S', 'M'],
  display_order: 0,
};

const POSTGREST_ERROR = {
  message: 'connection terminated',
  details: 'the details',
  hint: null,
  code: '57P01',
};

const db = createDbClient(testBindings());

describe('form field def reads (mocked Supabase)', () => {
  const originalFetch = globalThis.fetch;
  let requestedUrls: URL[];

  /**
   * Answers every PostgREST call with the given response.
   * @param respond Builds the response.
   */
  function mockFetch(respond: () => Response): void {
    globalThis.fetch = ((input: Parameters<typeof fetch>[0]) => {
      requestedUrls.push(new URL(String(input)));
      return Promise.resolve(respond());
    }) as unknown as typeof fetch;
  }

  beforeEach(() => {
    requestedUrls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('fetchFormFieldDefs', () => {
    it("reads the tournament's rows in display order", async () => {
      mockFetch(() => Response.json([SHIRT_SIZE_ROW]));

      const fieldDefs = await fetchFormFieldDefs(db, TOURNAMENT_ID);

      expect(fieldDefs).toEqual([
        {
          fieldKey: 'shirt_size',
          label: 'Tシャツサイズ',
          plainLabel: 'Tシャツサイズ',
          fieldType: 'radio',
          required: true,
          options: ['S', 'M'],
          displayOrder: 0,
        },
      ]);
      expect(requestedUrls).toHaveLength(1);
      expect(requestedUrls[0].pathname).toBe('/rest/v1/form_field_defs');
      expect(Object.fromEntries(requestedUrls[0].searchParams)).toEqual({
        select: 'field_key,label,field_type,required,options,display_order',
        tournament_id: `eq.${TOURNAMENT_ID}`,
        order: 'display_order.asc',
      });
    });

    it('throws the whole database error for the log', async () => {
      mockFetch(() => Response.json(POSTGREST_ERROR, {status: 500}));

      await expect(fetchFormFieldDefs(db, TOURNAMENT_ID)).rejects.toMatchObject(
        {
          context: 'failed to read the form field defs',
          cause: POSTGREST_ERROR,
        },
      );
    });

    it('treats an answer with no rows as a failed read, not an empty form', async () => {
      mockFetch(() => new Response('', {status: 200}));

      await expect(fetchFormFieldDefs(db, TOURNAMENT_ID)).rejects.toMatchObject(
        {
          context: 'failed to read the form field defs',
          cause: {message: 'the form field defs read returned no data'},
        },
      );
    });

    it('still answers an empty list for a tournament with no custom fields', async () => {
      mockFetch(() => Response.json([]));

      const fieldDefs = await fetchFormFieldDefs(db, TOURNAMENT_ID);

      expect(fieldDefs).toEqual([]);
    });

    it('throws on a stored row the schema refuses', async () => {
      mockFetch(() =>
        Response.json([{...SHIRT_SIZE_ROW, field_type: 'not-a-type'}]),
      );

      await expect(fetchFormFieldDefs(db, TOURNAMENT_ID)).rejects.toThrow();
    });
  });

  describe('validateCustomFieldValues', () => {
    it('accepts answers that fit the form', async () => {
      mockFetch(() => Response.json([SHIRT_SIZE_ROW]));

      const check = await validateCustomFieldValues(db, TOURNAMENT_ID, {
        shirt_size: 'S',
      });

      expect(check).toEqual({ok: true});
    });

    it("refuses answers that don't fit the form with a 400", async () => {
      mockFetch(() => Response.json([SHIRT_SIZE_ROW]));

      const check = await validateCustomFieldValues(db, TOURNAMENT_ID, {
        shirt_size: 'XXL',
      });

      expect(check).toMatchObject({ok: false, status: 400});
    });

    it("throws a failed read, with the database's error", async () => {
      mockFetch(() => Response.json(POSTGREST_ERROR, {status: 500}));

      await expect(
        validateCustomFieldValues(db, TOURNAMENT_ID, {shirt_size: 'S'}),
      ).rejects.toMatchObject({cause: POSTGREST_ERROR});
    });

    // Without this, the required fields would go unchecked.
    it('refuses to check against an answer with no rows', async () => {
      mockFetch(() => new Response('', {status: 200}));

      await expect(
        validateCustomFieldValues(db, TOURNAMENT_ID, {}),
      ).rejects.toBeInstanceOf(UnexpectedFailure);
    });
  });
});
