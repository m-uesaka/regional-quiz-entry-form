// The pair of headers the frontend's SSR forwards a browser's address in
// (`rewriteApiRequest` in `apps/frontend/src/lib/server/backend-fetch.ts`)
// and the backend reads it from (`clientIp()` in
// `apps/backend/src/middleware/rate-limit.ts`). Kept here so the two sides
// can't drift apart: a misspelt name on either would quietly put everybody
// back in one rate-limit bucket (#188). Lower-case, as the frontend sets
// them; header names are case-insensitive anyway.
export const CLIENT_IP_HEADER = 'x-client-ip';
export const CLIENT_IP_FORWARD_SECRET_HEADER = 'x-client-ip-forward-secret';
