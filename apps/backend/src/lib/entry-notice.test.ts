import {describe, expect, it} from 'bun:test';
import {buildEntryNoticeMail, entryNoticeSubject} from './entry-notice';

const ENV = {FRONTEND_URL: 'https://entry.example.com'};

describe('buildEntryNoticeMail', () => {
  it('says nothing of a withdrawal when none was made', () => {
    const mail = buildEntryNoticeMail(
      ENV,
      'a@example.com',
      '大会',
      'regulation-unavailable',
    );

    expect(mail.subject).toBe(entryNoticeSubject('大会'));
    expect(mail.html).toContain('レギュレーションが変更されました');
    expect(mail.html).not.toContain('取り消しました');
  });

  // A takeover before the failure withdrew these, and nothing else tells
  // the owner (#291).
  it('names the entries a takeover withdrew before the submission failed', () => {
    const mail = buildEntryNoticeMail(
      ENV,
      'a@example.com',
      '大会',
      'processing-failed',
      ['東京大会', '大阪大会'],
    );

    expect(mail.html).toContain('エントリーを完了できませんでした');
    expect(mail.html).toContain(
      'まだ確定していない「東京大会」、「大阪大会」へのエントリーは',
    );
    expect(mail.html).toContain('取り消しました');
    expect(mail.html).toContain(
      '取り消したエントリーへの参加を引き続き希望する場合は',
    );
    // Not the verification mail's advice: there is no entry here to confirm.
    expect(mail.html).not.toContain('このエントリーを確定した後');
  });

  it('still tells of a withdrawal whose tournaments could not be read', () => {
    const mail = buildEntryNoticeMail(
      ENV,
      'a@example.com',
      '大会',
      'regulation-unavailable',
      [],
    );

    expect(mail.html).toContain(
      'まだ確定していないエントリーは、異なるパスワードまたは別の地域の大会でエントリーされたため取り消しました',
    );
  });
});
