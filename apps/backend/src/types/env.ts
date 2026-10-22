import type {StaffClaims} from '@regional-quiz/shared';
import type {BulkMailMessage} from '../lib/bulk-mail-queue';
import type {TournamentRow} from '../lib/tournaments';

export interface Bindings {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  MAIL_API_KEY: string;
  // Non-secret and normally unset: the mail provider's API origin. Only
  // the end-to-end tests set it, pointing `createMailSender()` at a local
  // stub so a test run neither needs a real API key nor delivers mail.
  MAIL_API_BASE_URL?: string;
  // Secret: used to authenticate `values.get` reads against the Google
  // Sheets API v4 for Task 2-3's spreadsheet-to-YAML preview tool.
  GOOGLE_SHEETS_API_KEY: string;
  // Non-secret: the "From" address entry/waitlist mail is sent as.
  MAIL_FROM_ADDRESS: string;
  // Non-secret: the frontend origin used to build links in outgoing mail
  // (e.g. the entry verification link).
  FRONTEND_URL: string;
  SESSION_SECRET: string;
  // Secret: the Turnstile secret key `lib/turnstile.ts` verifies the
  // widget's tokens with. It is not among the `vars` of the deployed
  // environments on purpose -- a `var` of the same name would overwrite the
  // secret on the next deploy.
  TURNSTILE_SECRET_KEY: string;
  // Cloudflare's Rate Limiting bindings, declared in `wrangler.toml`. Each
  // is shared by several endpoints, which is why every key built for them
  // says what it is keyed on (see `middleware/rate-limit.ts`):
  //
  //   - `LOGIN_IP_RATE_LIMITER` caps credential guessing from one address
  //     across the two login endpoints. Each attempt costs a PBKDF2
  //     verification, so it is also what stops an unauthenticated caller
  //     from spending the Worker's CPU.
  //   - `LOGIN_EMAIL_RATE_LIMITER` caps guessing against one account, which
  //     the IP limit cannot see when the guesses come from a botnet. It is
  //     a separate binding rather than a second key on the one above
  //     because its number has to be far looser: a limit keyed on an email
  //     address is also a way to lock its owner out, and the tighter it is
  //     the cheaper that is to do (`wrangler.toml` has the numbers).
  //   - `MAIL_TRIGGER_EMAIL_RATE_LIMITER` caps how much of one inbox the two
  //     endpoints that send mail to an address the caller chose can spend.
  //     This is the tight one: it is the mail bomb it stops.
  //   - `MAIL_TRIGGER_IP_RATE_LIMITER` caps the same two endpoints per
  //     source address. Split off for the same reason as the login pair, and
  //     looser than it looks like it should be: an IP is not one person, and
  //     this limit is spent before the challenge and the schema have had a
  //     say (`wrangler.toml` has the numbers).
  LOGIN_IP_RATE_LIMITER: RateLimit;
  LOGIN_EMAIL_RATE_LIMITER: RateLimit;
  MAIL_TRIGGER_IP_RATE_LIMITER: RateLimit;
  MAIL_TRIGGER_EMAIL_RATE_LIMITER: RateLimit;
  // The queue the staff bulk send is handed to (Task 10-4), declared in
  // `wrangler.toml` as both a producer binding and a consumer. The route
  // enqueues one message per recipient and answers; `lib/bulk-mail-queue.ts`
  // does the sending from the consumer, which is what lifted the old
  // 80-recipient ceiling -- a consumer invocation is not bound by the ~30
  // seconds of post-response time a request's `waitUntil()` gets.
  BULK_MAIL_QUEUE: Queue<BulkMailMessage>;
}

export interface Variables {
  requestId: string;
  // Set by `requireOpenEntryPeriodOrStaff()` (`middleware/entry-period.ts`)
  // with the row it had to read anyway, so the handler behind it doesn't
  // fetch the same tournament a second time. Optional because most routes
  // never run that middleware.
  tournament?: TournamentRow;
  // Also set by `requireOpenEntryPeriodOrStaff()`, and only on the path it
  // took because the entry period has closed and the caller proved they are
  // the tournament's own staff. Kept apart from `staff` below because it
  // carries a weaker promise: that gate also lets anonymous requests through
  // while the period is open, so a handler behind it has to check. The
  // routes that mount it are `Hono<StaffEnv>` apps (their write siblings are
  // staff-only), where `staff` reads as guaranteed -- which for the gated
  // read it is not.
  entryPeriodStaff?: StaffClaims;
}

export interface Env {
  Bindings: Bindings;
  Variables: Variables;
}

// Used by routes mounted behind the staff-auth middleware, where the
// authenticated staff member's JWT claims are guaranteed to be set.
export interface StaffEnv {
  Bindings: Bindings;
  Variables: Variables & {staff: StaffClaims};
}

// Used by routes mounted behind `requireParticipant()`, where the
// authenticated participant's id is guaranteed to be set.
export interface ParticipantEnv {
  Bindings: Bindings;
  Variables: Variables & {participantId: string};
}
