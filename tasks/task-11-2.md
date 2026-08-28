[← tasks.md](../tasks.md) / Phase 11: セキュリティ強化

### Task 11-2: エントリー登録のメールアドレス列挙対策

#### 実装・更新内容

* ログイン(ダミーハッシュで PBKDF2 の時間を揃える)とパスワード再設定要求(`waitUntil()` で処理前に応答する)は、アドレスの登録有無が漏れないよう丁寧に作られている。ところが**エントリー登録だけがそのオラクルになっている**:
  * `lib/entries.ts:179` — 登録済みアドレス + 誤ったパスワード → `401 invalid password`。未登録なら処理が続く。応答の違いから「そのアドレスが登録済みか」が判る。
  * `lib/entries.ts:165` — `409 already registered in another region`。**どの地域に登録済みか**まで漏れる。参加者名簿が事実上公開されているクイズ大会の文脈では、これは「誰がどの地域大会に出ているか」の推測材料になる。
* 対策: **未認証のエントリー投稿では、アドレスの状態にかかわらず同じ応答を返す**。既存アカウントに関する事情はメールで本人にだけ伝える。
  * 未登録 → 従来どおりアカウントを作り、確認メールを送る。
  * 登録済み + パスワード一致 → 従来どおりエントリーを作り、確認メールを送る。
  * 登録済み + パスワード不一致 → **エントリーは作らず、そのアドレスへ「エントリーするには登録済みのパスワードでログインしてください」というメールを送る**。API の応答は成功と同じ。
  * 他地域に登録済み → 同様に、その旨をメールで本人にだけ伝える。API の応答は成功と同じ。
* UX の代償: パスワードを打ち間違えた善意の利用者が、画面上では成功に見えてメールで気付く形になる。これを緩和するため、フォームに「既にエントリー・アカウント登録済みの方はログインしてから」の導線(`/mypage/login?redirect=...`)を明示し、ログイン済みならフォームがメール・パスワード欄を隠して**セッションでそのままエントリーできる**ようにする。ログイン済み経路では従来どおり即時のエラーを返してよい(既に本人確認が済んでいるため、漏れる情報が無い)。
* 応答を統一しても、**処理時間の差**でなお判別できる(PBKDF2 の有無、メール送信の有無)。Task 11-1 のレート制限を前提条件とし、加えて分岐後の処理を `waitUntil()` に載せて応答を先に返す。

#### コードスニペット

`apps/backend/src/lib/entries.ts`(改修)

```typescript
/**
 * 未認証のエントリー投稿は、アドレスの状態にかかわらず同じ結果を返す。
 * 「登録済みか」「どの地域に登録済みか」を応答から読めなくするため、
 * 本人にだけ意味のある事情はメールで伝える。
 *
 * セッション付きの投稿(participantId が渡る)は本人確認が済んでいるので、
 * 従来どおり即時にエラーを返してよい。
 */
type CreateEntryOutcome =
  | {kind: 'created'; entryId: string}
  | {kind: 'notified'; reason: 'password-mismatch' | 'other-region'};

async function createEntryUnauthenticated(
  env: Bindings,
  tournamentId: string,
  input: EntryInput,
): Promise<CreateEntryOutcome> {
  /* ... */
  if (existingParticipant && existingParticipant.region_id !== tournament.region_id) {
    await sendOtherRegionNotice(env, input.email);
    return {kind: 'notified', reason: 'other-region'};
  }
  if (existingParticipant && !(await verifyPassword(input.password, existingParticipant.password_hash))) {
    await sendLoginRequiredNotice(env, input.email);
    return {kind: 'notified', reason: 'password-mismatch'};
  }
  /* 以降は従来どおり */
}
```

`apps/backend/src/routes/entries.ts`(改修)

```typescript
    // 分岐の中身(PBKDF2・メール送信)は応答時間に出る。先に 202 を返し、
    // 処理は waitUntil() に載せて、成功経路と拒否経路の所要時間を揃える。
    c.executionCtx.waitUntil(createEntryUnauthenticated(c.env, tournamentId, input));
    return c.json({ok: true, message: '確認メールを送信しました'}, 202);
```

#### テスト

* In `apps/backend/src/lib/entries.test.ts`
  * `createEntryUnauthenticated notifies by mail instead of failing on a wrong password`
  * `createEntryUnauthenticated notifies by mail instead of failing for another region`
  * `createEntryUnauthenticated creates no entry when the password does not match`
* In `apps/backend/src/routes/entries.test.ts`
  * `POST /tournaments/:id/entries answers identically for a known and an unknown email`
  * `POST /tournaments/:id/entries answers identically for a registered email with a wrong password`
  * `POST /tournaments/:id/entries still reports errors directly for a logged-in participant`
* In `apps/frontend/src/routes/[regionSlug]/[tournamentSlug]/entry/page.svelte.test.ts`
  * `the form hides the credential fields for a logged-in participant`
  * `the form links to the login page for participants who already have an account`

#### 依存タスク

* Task 3-3, Task 5-1, Task 11-1
