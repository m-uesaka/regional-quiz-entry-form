// Cloudflare's server-side half of Turnstile. The widget on the entry form
// and the password-reset request form hands the browser a token; this is
// what says whether that token is one Cloudflare actually issued.

const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Checks a Turnstile token against Cloudflare's siteverify API.
 *
 * Fails closed: an unreachable siteverify, a non-2xx answer and an
 * unparseable body all count as "not verified". Letting a submission
 * through when the check could not be made would turn a Cloudflare outage
 * into an open door for the mail bombing these two endpoints are protected
 * against -- stopping the send and asking for a retry is the lesser harm.
 *
 * `remoteip` is deliberately not sent. It is optional, and the token is
 * solved in the participant's browser while this call is made by the Worker
 * that the *frontend* forwarded the submission to (see `handleFetch` in
 * `apps/frontend/src/hooks.server.ts`), so the address this side could name
 * is not reliably the one the challenge was solved from. A mismatch there
 * would refuse a legitimate submission, which is exactly the failure this
 * endpoint can least afford.
 *
 * @param secret The Turnstile secret key (`TURNSTILE_SECRET_KEY`).
 * @param token The `cf-turnstile-response` token the widget produced.
 * @return Whether the token is valid.
 */
export async function verifyTurnstile(
  secret: string,
  token: string,
): Promise<boolean> {
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({secret, response: token}),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as {success?: boolean};
    return body.success === true;
  } catch {
    // A network failure, a DNS failure or a body that isn't JSON. None of
    // them say the token is good, so none of them may pass.
    return false;
  }
}
