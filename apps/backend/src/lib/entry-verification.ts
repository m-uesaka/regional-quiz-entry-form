import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {ResendMailSender} from './mailer';
import {generateToken, hashToken} from './token';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Issues a one-time email verification token for `entryId` and mails a
 * confirmation link to `email`.
 * @param env The Worker bindings.
 * @param entryId The `entries` row awaiting verification.
 * @param email The address to send the verification link to.
 */
export async function sendVerificationEmail(
  env: Bindings,
  entryId: string,
  email: string,
): Promise<void> {
  const db = createDbClient(env);
  const token = generateToken();
  const {error} = await db.from('email_verification_tokens').insert({
    entry_id: entryId,
    token_hash: await hashToken(token),
    expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  });
  if (error) {
    // Don't send a link whose token was never persisted -- the recipient
    // would click through to a token that can never be found.
    throw new Error(`failed to persist verification token: ${error.message}`);
  }

  const mailer = new ResendMailSender(env.MAIL_API_KEY, env.MAIL_FROM_ADDRESS);
  await mailer.send({
    to: email,
    subject: 'エントリー確認メール',
    html: `<a href="${env.FRONTEND_URL}/verify?token=${token}">こちらをクリックしてエントリーを確定してください</a>`,
  });
}
