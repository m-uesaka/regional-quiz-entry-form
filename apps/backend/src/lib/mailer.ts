export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
}

export interface MailSender {
  send(input: SendMailInput): Promise<void>;
}

/**
 * Sends mail via the Resend HTTP API.
 *
 * Resend is chosen because it's callable over `fetch` (no Node.js-only
 * SDK) and supports sender domain verification, both required to run on
 * Cloudflare Workers. Tasks 3-4, 5-5, and 6-3 depend only on the
 * `MailSender` interface above, not on Resend specifically.
 */
export class ResendMailSender implements MailSender {
  constructor(
    private readonly apiKey: string,
    private readonly fromAddress: string,
  ) {}

  async send(input: SendMailInput): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({from: this.fromAddress, ...input}),
    });
    if (!res.ok) {
      throw new Error(`Failed to send mail: ${res.status}`);
    }
  }
}
