/**
 * How long the link in an entry's verification mail stays valid. The
 * backend stamps the token's `expires_at` with it
 * (`apps/backend/src/lib/entry-verification.ts`) and the entry form tells
 * the participant the same number once they have submitted, so it lives here
 * where the two cannot drift apart.
 */
export const ENTRY_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
