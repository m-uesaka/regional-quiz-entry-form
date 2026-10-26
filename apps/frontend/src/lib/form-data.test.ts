import {describe, expect, it} from 'vitest';
import {readString} from './form-data';

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
