[← tasks.md](../tasks.md) / Phase 0: モノレポ基盤構築 ✅完了

### Task 0-6: Lint / Format / CI とメール送信サービスの選定 ✅

#### 実装・更新内容

* `gts`(Google TypeScript Style Guide 準拠の ESLint + Prettier + tsc 設定)を導入する。
* GitHub Actions で `typecheck` / `lint` / `test` を実行する CI を用意する。
* メール送信サービスを決定する(暫定: Resend。Cloudflare Workers から HTTP API で呼べること、送信元ドメイン認証ができることを条件に選定する)。決定した内容を `apps/backend/src/lib/mailer.ts` のインターフェースとして固定し、以降のタスク(3-4, 5-5, 6-3)はこのインターフェースにのみ依存する。

#### コードスニペット

`apps/backend/src/lib/mailer.ts`

```typescript
export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
}

export interface MailSender {
  send(input: SendMailInput): Promise<void>;
}

export class ResendMailSender implements MailSender {
  constructor(private readonly apiKey: string) {}

  async send(input: SendMailInput): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: 'entry@regionalquiz.example', ...input }),
    });
    if (!res.ok) {
      throw new Error(`Failed to send mail: ${res.status}`);
    }
  }
}
```

`.github/workflows/ci.yml`

```yaml
name: ci
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run typecheck
      - run: bun run lint
      - run: bun run test
```

#### テスト

* CI 上で `typecheck` / `lint` / `test` が空プロジェクトに対して green になることを確認する
* In `apps/backend/src/lib/mailer.test.ts`
  * `ResendMailSender.send throws on non-ok response`
    * `fetch` をモックして 4xx を返させ、エラーが投げられることを assert する

#### 依存タスク

* Task 0-2, Task 0-3
