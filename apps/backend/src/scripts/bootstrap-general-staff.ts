/**
 * Prints the SQL and the invite link that set up a general staff account
 * without going through `POST /api/staff/accounts`.
 *
 * That endpoint is general-staff-only, so a freshly deployed environment has
 * no way to create its first account through it. Nor can it recover the only
 * general staff member's account once its password is lost. This script
 * covers both: run the printed SQL in the Supabase SQL Editor, then open the
 * printed link and choose a password, exactly as an invited staff member
 * would. Nothing here connects to Supabase or mails anyone, so it needs no
 * secrets and works before `MAIL_API_KEY` is registered.
 *
 * Usage (from `apps/backend`):
 *   bun run staff:bootstrap <email> <frontend url>
 *
 * See `docs/supabase-deployment.md` 8.1.
 */
import {StaffAccountCreateInputSchema} from '@regional-quiz/shared';
import {UNUSABLE_PASSWORD_HASH} from '../lib/password';
import {generateToken, hashToken} from '../lib/token';

/**
 * How long the printed link stays usable. Matches the TTL
 * `sendStaffPasswordLink()` gives an invite mailed by the API.
 */
const TOKEN_TTL = '24 hours';

/** Quotes `value` as a Postgres string literal. */
function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Builds the SQL that creates the general staff account `email` (or reuses
 * it, if a general account with that address already exists) and gives it
 * one password link whose token hashes to `tokenHash`.
 *
 * Any link the account already had is deleted first, as the API does when it
 * re-issues one, so running this twice leaves only the newer link usable.
 * The account row is locked (`for update`) before its links are touched, so
 * concurrent runs for the same address take turns instead of both keeping a
 * usable link, matching the account-before-token order of
 * `reset_staff_password()`. An
 * address that belongs to a regional account is refused rather than handed a
 * link: that would be a regional staff member's password reset, which a
 * general staff member can already do from the staff screen.
 * @param email The account's address, already validated.
 * @param tokenHash `hashToken()` of the token in the printed link.
 */
export function buildBootstrapSql(email: string, tokenHash: string): string {
  const emailLiteral = quoteLiteral(email);
  return `do $$
declare
  v_id uuid;
begin
  insert into staff_accounts (email, password_hash, role)
  values (${emailLiteral}, ${quoteLiteral(UNUSABLE_PASSWORD_HASH)}, 'general')
  on conflict (email) do nothing;

  select id into v_id from staff_accounts
  where email = ${emailLiteral} and role = 'general'
  for update;
  if v_id is null then
    raise exception '% is a regional staff account', ${emailLiteral};
  end if;

  delete from staff_password_reset_tokens where staff_account_id = v_id;
  insert into staff_password_reset_tokens
    (staff_account_id, token_hash, expires_at)
  values (v_id, ${quoteLiteral(tokenHash)}, now() + interval '${TOKEN_TTL}');
end
$$;`;
}

/**
 * The page an invited staff member lands on, i.e. the link
 * `sendStaffPasswordLink()` mails.
 * @param frontendUrl The environment's `FRONTEND_URL`.
 * @param token The raw token.
 */
export function buildPasswordLink(frontendUrl: string, token: string): string {
  const url = new URL('/staff/password-reset', frontendUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

async function main(args: string[]): Promise<number> {
  const [email, frontendUrl] = args;
  if (!email || !frontendUrl) {
    console.error(
      'usage: bun run staff:bootstrap <email> <frontend url>\n' +
        '  e.g. bun run staff:bootstrap you@example.com https://staging.regional-quiz-project.app',
    );
    return 1;
  }
  const parsed = StaffAccountCreateInputSchema.safeParse({
    role: 'general',
    email,
  });
  if (!parsed.success) {
    console.error(`not a valid email address: ${email}`);
    return 1;
  }
  if (!URL.canParse(frontendUrl)) {
    console.error(`not a valid URL: ${frontendUrl}`);
    return 1;
  }

  const token = generateToken();
  console.log(
    '-- 1. Run this in the Supabase SQL Editor of the target project:',
  );
  console.log(buildBootstrapSql(parsed.data.email, await hashToken(token)));
  console.log('');
  console.log(
    `-- 2. Then, within ${TOKEN_TTL}, open this link and set a password:`,
  );
  console.log(buildPasswordLink(frontendUrl, token));
  return 0;
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
