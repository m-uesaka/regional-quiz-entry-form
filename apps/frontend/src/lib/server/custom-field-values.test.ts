import {describe, expect, it} from 'vitest';
import {readFormText} from './custom-field-values';

describe('readFormText', () => {
  it('reads a text control with its line breaks as LF', () => {
    const formData = new FormData();
    formData.set('freeText', 'a\r\nb\rc\nd');

    expect(readFormText(formData, 'freeText')).toBe('a\nb\nc\nd');
  });

  it('answers an empty string for a missing control or a file', () => {
    // A file in a text control's place is not text the visitor typed, so it
    // isn't read as its `String()` form ("[object File]").
    const formData = new FormData();
    formData.set('freeText', new File(['x'], 'x.txt'));

    expect(readFormText(formData, 'missing')).toBe('');
    expect(readFormText(formData, 'freeText')).toBe('');
  });
});
