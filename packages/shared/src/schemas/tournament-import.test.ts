import {describe, expect, it} from 'bun:test';
import {
  spreadsheetIdFromInput,
  TournamentBulkImportRequestSchema,
} from './tournament-import';

describe('spreadsheetIdFromInput', () => {
  it('takes the ID out of a spreadsheet URL', () => {
    expect(
      spreadsheetIdFromInput(
        'https://docs.google.com/spreadsheets/d/1CiNHRZo_xh-jq/edit?gid=0#gid=0',
      ),
    ).toBe('1CiNHRZo_xh-jq');
  });

  it('leaves a bare ID as it is', () => {
    expect(spreadsheetIdFromInput('1CiNHRZo_xh-jq')).toBe('1CiNHRZo_xh-jq');
  });
});

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
