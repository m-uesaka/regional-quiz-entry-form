import {describe, expect, it} from 'vitest';
import {promotionNotice} from './waitlist-promotion';

describe('promotionNotice', () => {
  it('says nothing when nobody was promoted', () => {
    expect(promotionNotice({promotedCount: 0, mailFailedCount: 0})).toBeNull();
  });

  it('reports the promotions and that everyone was mailed', () => {
    expect(promotionNotice({promotedCount: 3, mailFailedCount: 0})).toEqual({
      text: 'キャンセル待ち3件を繰り上げ、通知メールを送りました',
      ok: true,
    });
  });

  // Those participants don't know they were confirmed.
  it('asks staff to follow up the mails that could not be sent', () => {
    const notice = promotionNotice({promotedCount: 3, mailFailedCount: 1});

    expect(notice?.ok).toBe(false);
    expect(notice?.text).toContain('うち1件は通知メールを送れなかった');
  });

  it('says how to retry a failed promotion', () => {
    const notice = promotionNotice(null);

    expect(notice?.ok).toBe(false);
    expect(notice?.text).toContain('定員を保存し直す');
  });
});
