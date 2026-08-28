import type {StaffClaims} from '@regional-quiz/shared';

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
  // Cloudflare's Rate Limiting bindings, declared in `wrangler.toml`. Both
  // are shared by several endpoints, which is why every key built for them
  // says what it is keyed on (see `middleware/rate-limit.ts`):
  //
  //   - `LOGIN_RATE_LIMITER` caps credential guessing on the two login
  //     endpoints. Each attempt costs a PBKDF2 verification, so it is also
  //     what stops an unauthenticated caller from spending the Worker's CPU.
  //   - `MAIL_TRIGGER_RATE_LIMITER` caps the two endpoints that send mail to
  //     an address the caller chose, and so is much tighter.
  LOGIN_RATE_LIMITER: RateLimit;
  MAIL_TRIGGER_RATE_LIMITER: RateLimit;
}

export interface Variables {
  requestId: string;
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
