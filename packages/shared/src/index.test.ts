import {describe, expect, it} from 'bun:test';
import * as shared from './index';

describe('index', () => {
  it('module loads without throwing', () => {
    expect(shared).toBeDefined();
  });
});
