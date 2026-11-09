// Cloudflare's server-side half of Turnstile. The widget on the entry form
// and the password-reset request form hands the browser a token; this is
// what says whether that token is one Cloudflare actually issued.

import type {TurnstileAction} from '@regional-quiz/shared';

const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** What a token has to have been solved for, besides being genuine. */
export interface TurnstileExpectation {
  /**
   * Where the widget may have been rendered: the frontend's hostnames
   * (`trustedHostnames()`). A sitekey whose allowed hosts take in both
   * staging and production would otherwise let a token solved on one be
   * spent on the other (#297).
   */
  hostnames: ReadonlySet<string>;
  /**
   * The form it was solved on. A token from the reset form spent on the
   * entry form costs the attacker nothing more, but there is no reason to
   * take it either (#297).
   */
  action: TurnstileAction;
}

/**
 * Cloudflare's test secret keys (always passes, always fails, already
 * spent). They verify only the dummy token the test site keys hand out, with
 * a dummy answer that names no hostname or action of ours, so neither is
 * checked against them; local development and the end-to-end run use them.
 * A production secret never matches.
 */
const TEST_SECRET_KEY_PATTERN = /^[123]x0{31}AA$/;

/** The part of a siteverify answer this reads. */
interface SiteverifyResponse {
  success?: boolean;
  hostname?: string;
  action?: string;
}

/**
 * Checks a Turnstile token against Cloudflare's siteverify API, and that it
 * was solved where and for what `expected` says.
 *
 * Fails closed: an unreachable siteverify, a non-2xx answer and an
 * unparseable body all count as "not verified". Letting a submission
 * through when the check could not be made would turn a Cloudflare outage
 * into an open door for the mail bombing these endpoints are protected
 * against -- stopping the send and asking for a retry is the lesser harm.
 *
 * A token without an `action` is let through: one solved on a page served
 * before the widget was given its action (#297) is still in the hands of
 * whoever had that page open while the backend is deployed ahead of the
 * frontend. One with a different action is refused.
 *
 * `remoteip` is not sent. `clientIp()` can name the participant now that
 * the frontend forwards their address (#188), but only as the rate limits
 * key on it -- an IPv6 address cut to its /64 -- and not at all where the
 * forwarding secret isn't configured, when it names the frontend. It is
 * optional, and an address that is not the one the challenge was solved
 * from could refuse a genuine submission, the failure these endpoints can
 * least afford, for a signal Cloudflare already has from the browser.
 *
 * @param secret The Turnstile secret key (`TURNSTILE_SECRET_KEY`).
 * @param token The `cf-turnstile-response` token the widget produced.
 * @param expected Where and for which form the token must have been solved.
 * @return Whether the token is valid for `expected`.
 */
export async function verifyTurnstile(
  secret: string,
  token: string,
  expected: TurnstileExpectation,
): Promise<boolean> {
  let body: SiteverifyResponse;
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({secret, response: token}),
    });
    if (!res.ok) return false;
    body = (await res.json()) as SiteverifyResponse;
  } catch {
    // A network failure, a DNS failure or a body that isn't JSON. None of
    // them say the token is good, so none of them may pass.
    return false;
  }
  if (body.success !== true) return false;
  if (TEST_SECRET_KEY_PATTERN.test(secret)) return true;
  if (
    typeof body.hostname !== 'string' ||
    !expected.hostnames.has(body.hostname)
  ) {
    return false;
  }
  return !body.action || body.action === expected.action;
}
