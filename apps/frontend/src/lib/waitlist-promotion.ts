import type {WaitlistPromotion} from '@regional-quiz/shared';

/** What staff are told about a waitlist promotion (#223). */
export interface PromotionNotice {
  text: string;
  /** False when staff have something to follow up. */
  ok: boolean;
}

/**
 * Words what promoting the waitlist into freed seats came to, for the edit
 * screen and the bulk import's results alike.
 * @param promotion The API's answer: the counts, or null when the
 *     promotion failed.
 * @return The notice, or null when nobody was promoted.
 */
export function promotionNotice(
  promotion: WaitlistPromotion | null,
): PromotionNotice | null {
  if (promotion === null) {
    return {
      text: 'キャンセル待ちの繰り上げに失敗しました。大会の編集画面で定員を保存し直すと、もう一度繰り上げます',
      ok: false,
    };
  }
  const {promotedCount, mailFailedCount} = promotion;
  if (promotedCount === 0) {
    return null;
  }
  if (mailFailedCount === 0) {
    return {
      text: `キャンセル待ち${promotedCount}件を繰り上げ、通知メールを送りました`,
      ok: true,
    };
  }
  return {
    text: `キャンセル待ち${promotedCount}件を繰り上げました。うち${mailFailedCount}件は通知メールを送れなかったため、エントリー一覧で確認して連絡してください`,
    ok: false,
  };
}
