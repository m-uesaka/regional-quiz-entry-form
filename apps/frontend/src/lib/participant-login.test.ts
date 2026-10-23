import {describe, expect, it} from 'vitest';
import {
  participantLandingPath,
  participantLoginPath,
} from './participant-login';

describe('participantLoginPath', () => {
  it('carries the entry form to come back to', () => {
    expect(participantLoginPath('/tokyo/saikyoi/entry')).toBe(
      '/mypage/login?redirectTo=%2Ftokyo%2Fsaikyoi%2Fentry',
    );
  });
});

describe('participantLandingPath', () => {
  it('honours an entry form', () => {
    expect(participantLandingPath('/tokyo/shinjinou/entry')).toBe(
      '/tokyo/shinjinou/entry',
    );
  });

  it('falls back to the mypage without a target', () => {
    expect(participantLandingPath(null)).toBe('/mypage');
  });

  it.each([
    ['a protocol-relative URL', '//evil.example/saikyoi/entry'],
    ['an absolute URL', 'https://evil.example/tokyo/saikyoi/entry'],
    ['a backslash trick', '/\\evil.example/saikyoi/entry'],
    ['a page that is not an entry form', '/staff/dashboard'],
    ['an entry form with a trailing segment', '/tokyo/saikyoi/entry/x'],
  ])('refuses %s', (_label, target) => {
    expect(participantLandingPath(target)).toBe('/mypage');
  });
});
