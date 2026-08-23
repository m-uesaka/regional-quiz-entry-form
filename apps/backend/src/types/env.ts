import type {StaffClaims} from '@regional-quiz/shared';

export interface Bindings {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  MAIL_API_KEY: string;
  // Non-secret: the "From" address entry/waitlist mail is sent as.
  MAIL_FROM_ADDRESS: string;
  // Non-secret: the frontend origin used to build links in outgoing mail
  // (e.g. the entry verification link).
  FRONTEND_URL: string;
  SESSION_SECRET: string;
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
