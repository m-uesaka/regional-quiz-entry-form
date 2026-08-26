// A stand-in for the Resend HTTP API, started as one of Playwright's
// `webServer`s. The backend is pointed at it through the
// `MAIL_API_BASE_URL` binding (see `apps/backend/src/lib/mailer.ts`), so a
// test run neither needs a real API key nor delivers mail, and the tests
// can read what was sent.
//
// This is the only way the tests can get at an entry's verification token:
// the token is generated per request and only ever stored hashed
// (`apps/backend/src/lib/token.ts`), so the mail body is the sole place
// the raw value appears.

import {MAIL_SINK_PORT} from './env';

/** One captured send, in the shape `GET /messages` answers with. */
interface CapturedMail {
  id: string;
  from: string;
  to: string[];
  subject: string;
  html: string;
  receivedAt: string;
}

/** The body `ResendMailSender` posts, as far as this stub cares. */
interface ResendSendRequest {
  from?: string;
  to?: string | string[];
  subject?: string;
  html?: string;
}

const captured: CapturedMail[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

/**
 * Normalizes Resend's `to`, which accepts a single address as well as a
 * list, into a list.
 * @param to The `to` field as posted.
 */
function toRecipients(to: string | string[] | undefined): string[] {
  if (Array.isArray(to)) {
    return to;
  }
  return to === undefined ? [] : [to];
}

async function handleSend(request: Request): Promise<Response> {
  const body = (await request.json()) as ResendSendRequest;
  const mail: CapturedMail = {
    id: crypto.randomUUID(),
    from: body.from ?? '',
    to: toRecipients(body.to),
    subject: body.subject ?? '',
    html: body.html ?? '',
    receivedAt: new Date().toISOString(),
  };
  captured.push(mail);
  // Resend answers a successful send with the new message's id, and
  // `ResendMailSender` only checks `res.ok`, so the shape matters less
  // than the status.
  return json({id: mail.id});
}

/**
 * Answers `GET /messages`, newest first so a test that wants "the mail
 * this step just sent" can take the first match.
 * @param url The request URL, whose `to` query narrows the result.
 */
function handleList(url: URL): Response {
  const to = url.searchParams.get('to');
  const messages = [...captured]
    .reverse()
    .filter(mail => to === null || mail.to.includes(to));
  return json({messages});
}

const server = Bun.serve({
  port: MAIL_SINK_PORT,
  hostname: '127.0.0.1',
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/healthz') {
      return json({ok: true});
    }
    // The path Resend itself serves, so the stub is a drop-in for it.
    if (request.method === 'POST' && url.pathname === '/emails') {
      return handleSend(request);
    }
    if (request.method === 'GET' && url.pathname === '/messages') {
      return handleList(url);
    }
    if (request.method === 'DELETE' && url.pathname === '/messages') {
      captured.length = 0;
      return new Response(null, {status: 204});
    }
    return json({error: 'not found'}, 404);
  },
});

console.log(`mail sink listening on http://127.0.0.1:${server.port}`);
