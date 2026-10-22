import {describe, expect, it} from 'bun:test';
import {UNUSABLE_PASSWORD_HASH} from '../lib/password';
import {buildBootstrapSql, buildPasswordLink} from './bootstrap-general-staff';

describe('buildBootstrapSql', () => {
  it('creates a general account that cannot log in until the link is used', () => {
    const sql = buildBootstrapSql('admin@example.com', 'abc123');

    expect(sql).toContain(
      `values ('admin@example.com', '${UNUSABLE_PASSWORD_HASH}', 'general')`,
    );
    expect(sql).toContain(
      "values (v_id, 'abc123', now() + interval '24 hours')",
    );
  });

  it('drops the links the account already had before adding the new one', () => {
    const sql = buildBootstrapSql('admin@example.com', 'abc123');

    const deleteIndex = sql.indexOf('delete from staff_password_reset_tokens');
    const insertIndex = sql.indexOf('insert into staff_password_reset_tokens');

    expect(deleteIndex).toBeGreaterThanOrEqual(0);
    expect(insertIndex).toBeGreaterThanOrEqual(0);
    expect(deleteIndex).toBeLessThan(insertIndex);
  });

  it('escapes single quotes in the address', () => {
    const sql = buildBootstrapSql("o'brien@example.com", 'abc123');

    expect(sql).toContain("'o''brien@example.com'");
    expect(sql).not.toContain("'o'brien");
  });
});

describe('buildPasswordLink', () => {
  it('points at the staff password page with the token', () => {
    expect(buildPasswordLink('https://example.pages.dev', 'abc123')).toBe(
      'https://example.pages.dev/staff/password-reset?token=abc123',
    );
  });

  it('does not double the slash when the URL has a trailing one', () => {
    expect(buildPasswordLink('https://example.pages.dev/', 'abc123')).toBe(
      'https://example.pages.dev/staff/password-reset?token=abc123',
    );
  });
});
