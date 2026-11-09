import {describe, expect, it} from 'bun:test';
import {SheetFetchError} from './google-sheets';
import {classifySheetImportError} from './sheet-import-errors';
import {FormSheetError} from './sheet-to-form-definition';
import {RegulationSheetError} from './sheet-to-regulations';

/** What `classifySheetImportError(e)` throws, or `undefined` if it returns. */
function thrownBy(e: unknown): unknown {
  try {
    classifySheetImportError(e);
  } catch (thrown: unknown) {
    return thrown;
  }
  return undefined;
}

describe('classifySheetImportError', () => {
  it("answers the converters' own errors with 400 and their message", () => {
    expect(
      classifySheetImportError(new FormSheetError('2行目: A列(key)が空です')),
    ).toEqual({status: 400, error: '2行目: A列(key)が空です'});
    expect(
      classifySheetImportError(
        new RegulationSheetError('2行目: レギュレーション名が空です'),
      ),
    ).toEqual({status: 400, error: '2行目: レギュレーション名が空です'});
  });

  it("answers Google's refusals by who is at fault", () => {
    expect(classifySheetImportError(new SheetFetchError('nope', 404))).toEqual({
      status: 400,
      error: 'nope',
    });
    expect(
      classifySheetImportError(new SheetFetchError('down', 503)).status,
    ).toBe(502);
    expect(
      classifySheetImportError(new SheetFetchError('slow down', 429)).status,
    ).toBe(503);
  });

  // #293: these used to come back as a 400 carrying the raw message.
  it('throws anything else again rather than answering it', () => {
    for (const e of [
      new SyntaxError('Unexpected token < in JSON at position 0'),
      new TypeError("Cannot read properties of undefined (reading 'map')"),
      new Error('something else'),
      'not even an Error',
    ]) {
      expect(thrownBy(e)).toBe(e);
    }
  });
});
