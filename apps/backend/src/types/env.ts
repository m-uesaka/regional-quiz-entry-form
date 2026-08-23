export interface Bindings {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  MAIL_API_KEY: string;
  SESSION_SECRET: string;
}

export type StaffRole = 'regional' | 'general';

/** Claims carried by the `staff_session` JWT cookie (see Task 6-1). */
export interface StaffClaims {
  sub: string;
  role: StaffRole;
  regionId: string | null;
  tournamentType: 'saikyoi' | 'shinjinou' | null;
}

export interface Variables {
  requestId: string;
  staff?: StaffClaims;
}

export interface Env {
  Bindings: Bindings;
  Variables: Variables;
}
