import {describe, expect, it} from 'bun:test';
import {TournamentBulkImportRequestSchema} from './tournament-import';

describe('TournamentBulkImportRequestSchema', () => {
  it('trims what was pasted', () => {
    expect(
      TournamentBulkImportRequestSchema.parse({spreadsheetId: '  abc  '}),
    ).toEqual({spreadsheetId: 'abc'});
  });

  it('refuses an empty input in Japanese', () => {
    const result = TournamentBulkImportRequestSchema.safeParse({
      spreadsheetId: '   ',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(
      'スプレッドシートの ID または URL を入力してください',
    );
  });
});
