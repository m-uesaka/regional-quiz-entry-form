import {describe, expect, it} from 'vitest';
import {staffScopeLabel} from './staff-scope';

describe('staffScopeLabel', () => {
  it('names an account the way the login screen offers it', () => {
    expect(staffScopeLabel('saikyoi')).toBe('最強位の地域スタッフ');
    expect(staffScopeLabel('shinjinou')).toBe('新人王の地域スタッフ');
    expect(staffScopeLabel('general')).toBe('統括スタッフ');
  });
});
