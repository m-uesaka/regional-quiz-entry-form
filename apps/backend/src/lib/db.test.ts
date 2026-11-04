import {describe, expect, it} from 'bun:test';
import {createDbClient} from './db';
import {testBindings} from '../test-support/bindings';

describe('createDbClient', () => {
  it('returns a client', () => {
    const env = testBindings();

    const client = createDbClient(env);

    expect(client).toBeDefined();
  });
});
