export interface Bindings {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  MAIL_API_KEY: string;
  SESSION_SECRET: string;
}

export interface Variables {
  requestId: string;
}

export interface Env {
  Bindings: Bindings;
  Variables: Variables;
}
