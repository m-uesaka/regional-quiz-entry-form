[← tasks.md](../tasks.md) / Phase 10: 要件との差分の解消

### Task 10-4: 一斉メールの Cloudflare Queues 化(80 名上限の撤廃)

#### 実装・更新内容

* スタッフの一斉メールが **1 リクエストあたり 80 名までしか送れない**。`MAX_BACKGROUND_RECIPIENTS`(`lib/bulk-mail.ts`)は「レスポンス送出後に `waitUntil()` が生かされるのは約 30 秒」という Cloudflare の制約から逆算した値で、超えると 413 を返して拒否する。定員が数百人ある地域では要件「地域スタッフが参加者にメールを送信できる」が成立しない。`routes/staff-mail.ts` に既に TODO として残っている。
* 送信をリクエストのライフサイクルから切り離し、Cloudflare Queues のコンシューマへ移す。コンシューマは呼び出しごとに独立した実行時間を持つため、`waitUntil()` の予算に縛られない。
* 分割の方針: プロデューサ(HTTP ルート)は宛先を確定して**受信者をバッチに分けて enqueue するだけ**にし、ページングもレート制御もコンシューマ側で行う。1 メッセージ = 1 受信者にすると再試行の粒度が最小になり、部分失敗の扱いが単純になる(Queues はメッセージ単位で ack/retry する)。
* 既存の `sendBulkMail()` のレート制御・リトライロジックはコンシューマ内でそのまま使える。変わるのは「予算 (`budgetMs`) で打ち切る」部分で、これはコンシューマでは不要になるため、呼び出し側で `budgetMs: Infinity` 相当を渡せるようにする。
* Cloudflare Queues は有料プラン限定。プランを上げられない場合の代替は Cloudflare Workflows か、Cron Trigger で `mail_outbox` テーブルを定期的に掃き出す方式。**どれを採るかは課金判断なので、着手前に確認する**。ここでは Queues を第一候補として書く。
* 送信結果を追える場所が現状ログしか無いのも併せて直す。`mail_jobs` テーブルに件数・成功・失敗を記録し、スタッフ画面から「何人に送れたか」を確認できるようにする。

#### コードスニペット

`apps/backend/wrangler.toml`

```toml
[[queues.producers]]
queue = "regional-quiz-bulk-mail"
binding = "BULK_MAIL_QUEUE"

[[queues.consumers]]
queue = "regional-quiz-bulk-mail"
# 1 メッセージ = 1 受信者。バッチでまとめて受け取り、バッチ内で
# lib/bulk-mail.ts のレート制御をかける。
max_batch_size = 10
max_batch_timeout = 5
max_retries = 3
dead_letter_queue = "regional-quiz-bulk-mail-dlq"
```

`apps/backend/src/routes/staff-mail.ts`(改修)

```typescript
    // 上限チェック(MAX_BACKGROUND_RECIPIENTS)は削除。宛先を確定したら
    // キューに積むだけで、送信はコンシューマが行う。
    const jobId = await createMailJob(c.env, {
      tournamentId,
      total: recipients.length,
      subject,
    });
    await c.env.BULK_MAIL_QUEUE.sendBatch(
      recipients.map(to => ({body: {jobId, to, subject, html: body}})),
    );
    const response: StaffMailResult = {jobId, accepted: recipients.length};
    return c.json(response, 202);
```

`apps/backend/src/index.ts`(改修)

```typescript
// Worker のエクスポートが default の fetch ハンドラだけではなくなる。
// Hono の app をそのまま default export していたのを、fetch と queue を
// 持つオブジェクトに変える。
export default {
  fetch: app.fetch,
  queue: handleBulkMailQueue,
} satisfies ExportedHandler<Bindings, BulkMailMessage>;
```

#### テスト

* In `apps/backend/src/lib/bulk-mail-queue.test.ts`
  * `the consumer sends every message in the batch`
  * `the consumer retries a rate-limited message instead of acking it`
  * `the consumer acks a permanently rejected address and records the failure`
  * `the consumer records the job's progress so the staff screen can read it`
* In `apps/backend/src/routes/staff-mail.test.ts`(改修)
  * `POST /staff/.../mail enqueues one message per recipient`
  * `POST /staff/.../mail no longer refuses a list over 80 recipients`
  * `POST /staff/.../mail returns the job id with 202`
* In `apps/e2e`
  * 既存のメール stub をキュー経由でも受け取れるよう `support/mail-sink.ts` を更新し、一斉送信の E2E を維持する

#### 依存タスク

* Task 6-3
