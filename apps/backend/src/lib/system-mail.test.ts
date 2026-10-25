import {describe, expect, it} from 'bun:test';
import {
  buildSystemMail,
  describeLinkLifetime,
  systemMailSubject,
} from './system-mail';

describe('systemMailSubject', () => {
  it('prefixes the title with the site name', () => {
    expect(systemMailSubject('パスワードの再設定')).toBe(
      '【地域クイズ最強位・新人王】パスワードの再設定',
    );
  });
});

describe('describeLinkLifetime', () => {
  it('states the lifetime in hours', () => {
    expect(describeLinkLifetime(24 * 60 * 60 * 1000)).toBe(
      'このリンクの有効期限は、メールの送信から24時間です。',
    );
  });
});

describe('buildSystemMail', () => {
  const url = 'https://entry.example.com/verify?token=abc&x=1';
  const mail = buildSystemMail('user@example.com', '件名', [
    '「<大会>」へのエントリーを受け付けました。',
    {label: 'エントリーを確定する', url},
  ]);

  it('passes the recipient and subject through', () => {
    expect(mail).toMatchObject({to: 'user@example.com', subject: '件名'});
  });

  it('escapes paragraphs in the HTML body', () => {
    expect(mail.html).toContain(
      '<p>「&lt;大会&gt;」へのエントリーを受け付けました。</p>',
    );
  });

  it('writes a link out with its URL in full, not only behind its label', () => {
    const escaped = 'https://entry.example.com/verify?token=abc&amp;x=1';
    expect(mail.html).toContain(
      `<p>エントリーを確定する<br><a href="${escaped}">${escaped}</a></p>`,
    );
  });

  it('gives a plain-text body that says the same thing, unescaped', () => {
    expect(mail.text).toStartWith(
      '「<大会>」へのエントリーを受け付けました。\n\n' +
        `エントリーを確定する\n${url}\n\n`,
    );
  });

  it('closes both bodies with the footer', () => {
    expect(mail.html).toContain(
      '<hr><p>地域クイズ最強位・新人王 エントリー<br>',
    );
    expect(mail.text).toContain('----\n地域クイズ最強位・新人王 エントリー\n');
    expect(mail.text).toContain('送信専用のアドレス');
  });
});
