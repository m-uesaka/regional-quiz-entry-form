import {describe, expect, it} from 'bun:test';
import {SheetImportRequestSchema} from './form-definition';
import {RegulationSheetImportRequestSchema} from './regulation';
import {spreadsheetIdFromInput} from './spreadsheet';
import {TournamentBulkImportRequestSchema} from './tournament-import';

const URL =
  'https://docs.google.com/spreadsheets/d/1CiNHRZo_xh-jq/edit?gid=0#gid=0';

describe('spreadsheetIdFromInput', () => {
  it('takes the ID out of a spreadsheet URL', () => {
    expect(spreadsheetIdFromInput(URL)).toBe('1CiNHRZo_xh-jq');
  });

  it('leaves a bare ID as it is', () => {
    expect(spreadsheetIdFromInput('1CiNHRZo_xh-jq')).toBe('1CiNHRZo_xh-jq');
  });
});

// The form-definition and regulation imports used to send a pasted URL to
// Google as the ID, and let a blank one through (#301).
describe('every sheet import takes the spreadsheet the same way', () => {
  const parsers = {
    'form definition': (spreadsheetId: string) =>
      SheetImportRequestSchema.safeParse({
        spreadsheetId,
        tournamentSlug: 'saikyoi',
      }),
    regulations: (spreadsheetId: string) =>
      RegulationSheetImportRequestSchema.safeParse({spreadsheetId}),
    'tournament index': (spreadsheetId: string) =>
      TournamentBulkImportRequestSchema.safeParse({spreadsheetId}),
  };

  for (const [name, parse] of Object.entries(parsers)) {
    it(`${name}: takes the ID out of a URL, trimmed`, () => {
      expect(parse(` ${URL} `).data?.spreadsheetId).toBe('1CiNHRZo_xh-jq');
      expect(parse(' abc ').data?.spreadsheetId).toBe('abc');
    });

    it(`${name}: refuses a blank input in Japanese`, () => {
      const result = parse('  ');

      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toBe(
        'スプレッドシートの ID または URL を入力してください',
      );
    });
  }
});
