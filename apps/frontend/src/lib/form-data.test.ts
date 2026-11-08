import {describe, expect, it} from 'vitest';
import {readString, readStrings} from './form-data';

describe('readString', () => {
  it('reads a text control', () => {
    const formData = new FormData();
    formData.set('email', 'staff@example.com');

    expect(readString(formData, 'email')).toBe('staff@example.com');
  });

  it('answers an empty string for a missing control or a file', () => {
    const formData = new FormData();
    formData.set('upload', new File(['x'], 'x.txt'));

    expect(readString(formData, 'missing')).toBe('');
    expect(readString(formData, 'upload')).toBe('');
  });
});

describe('readStrings', () => {
  it('reads every value of a control, in order', () => {
    const formData = new FormData();
    formData.append('ids', 'a');
    formData.append('ids', 'b');

    expect(readStrings(formData, 'ids')).toEqual(['a', 'b']);
  });

  it('leaves out a value that came as a file', () => {
    const formData = new FormData();
    formData.append('ids', 'a');
    formData.append('ids', new File(['x'], 'x.txt'));

    expect(readStrings(formData, 'ids')).toEqual(['a']);
  });

  it('answers an empty list for a missing control', () => {
    expect(readStrings(new FormData(), 'missing')).toEqual([]);
  });
});
