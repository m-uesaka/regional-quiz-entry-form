/**
 * The domain every mail the app sends comes from, or that domain's
 * subdomains: the backend's `MAIL_FROM_ADDRESS` is `no-reply@mail.` under it
 * (`staging.mail.` on staging). The entry form names it to participants
 * whose carrier filters mail by sender domain, and a backend test holds each
 * environment's `MAIL_FROM_ADDRESS` in `wrangler.toml` to it, so moving the
 * sending domain fails there rather than leaving the page naming the old
 * one.
 */
export const MAIL_SENDER_DOMAIN = 'regional-quiz-project.app';
