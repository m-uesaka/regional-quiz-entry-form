[← tasks.md](../tasks.md) / Phase 11: セキュリティ強化

### Task 11-4: パスワードハッシュの強化とアルゴリズム移行の余地

#### 実装・更新内容

* `lib/password.ts` は PBKDF2-HMAC-SHA256 / 10 万回 / 128bit ソルト / 256bit 出力。実装自体は妥当(Web Crypto、定数時間比較、ソルトごとにランダム)だが、**反復回数が OWASP の現行推奨(SHA-256 で 600,000 回)を大きく下回る**。
* さらに、保存形式が `saltHex:hashHex` の 2 部構成で、**アルゴリズムも反復回数も記録されていない**。このままでは回数を上げた瞬間に既存ユーザー全員がログインできなくなる(古いハッシュを古い回数で検証できない)。実質的にパラメータを一度も変えられない設計になっている。
* 対応:
  1. 保存形式を `pbkdf2-sha256$<iterations>$<saltHex>$<hashHex>` に変える。`$` を含まない文字列は旧形式(10 万回)として読む。
  2. 反復回数を引き上げる。**具体的な値は計測して決める**。Workers の CPU 時間は有料プランで 1 リクエストあたり 30 秒まで使えるが、ログインとエントリー登録の同期パスに乗る以上、実測して上限を決める必要がある(Task 12 の性能項目とも関係する)。目安として 600,000 回で 100〜300ms 程度。
  3. **ログイン成功時に静かに再ハッシュする**。検証が通ったパスワードは平文で手元にあるので、古いパラメータのハッシュならその場で新形式に書き換える。利用者に何も要求せずに移行が進む。
* パスワードポリシーは現在「8 文字以上」だけ(`EntryInputSchema` / `PasswordResetConfirmInputSchema`)。桁数を増やすより**よく使われるパスワードの拒否**の方が効くので、上位数千件の使い回しリストを `packages/shared` に持って弾く。文字種の強制(記号必須など)は利用者の負担の割に効果が薄いので入れない。
* 移行と並行して、パスワード最大長も決める(例: 256 文字)。PBKDF2 は入力長に比例してコストが上がるため、上限が無いと長大なパスワードで CPU を消費させられる。

#### コードスニペット

`apps/backend/src/lib/password.ts`(改修)

```typescript
// 現行の既定値。上げるときはこの定数だけを動かせばよく、既存ハッシュは
// 自分の iterations を保存形式の中に持っているので影響を受けない。
const PBKDF2_ITERATIONS = 600_000;
const LEGACY_PBKDF2_ITERATIONS = 100_000;
const ALGORITHM = 'pbkdf2-sha256';

// `pbkdf2-sha256$600000$<salt>$<hash>`。`$` を含まない文字列は、
// この形式を導入する前の `<salt>:<hash>`(10 万回)として読む。
interface ParsedHash {
  iterations: number;
  saltHex: string;
  hashHex: string;
}

function parseStoredHash(stored: string): ParsedHash | null {
  if (!stored.includes('$')) {
    const [saltHex, hashHex] = stored.split(':');
    return saltHex && hashHex
      ? {iterations: LEGACY_PBKDF2_ITERATIONS, saltHex, hashHex}
      : null;
  }
  const [algorithm, iterations, saltHex, hashHex] = stored.split('$');
  if (algorithm !== ALGORITHM) return null;
  /* 各フィールドの形式検証 */
}

/** 検証と同時に、古いパラメータなら再ハッシュすべきかを返す。 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<{valid: boolean; needsRehash: boolean}> {
  const parsed = parseStoredHash(stored);
  if (!parsed) return {valid: false, needsRehash: false};
  const bits = await deriveBits(password, fromHex(parsed.saltHex), parsed.iterations);
  const valid = timingSafeEqualHex(toHex(bits), parsed.hashHex);
  return {valid, needsRehash: valid && parsed.iterations < PBKDF2_ITERATIONS};
}
```

`apps/backend/src/routes/participant-auth.ts`(改修)

```typescript
    const {valid, needsRehash} = await verifyPassword(
      password,
      participant?.password_hash ?? DUMMY_PASSWORD_HASH,
    );
    if (!participant || !valid) {
      return c.json({error: 'invalid credentials'}, 401);
    }
    // 検証が通ったこの瞬間だけ平文が手元にある。利用者に何も要求せずに
    // 新しいパラメータへ移行できる唯一の機会なので、ここで書き換える。
    // 応答をブロックしないよう waitUntil() に載せ、失敗しても
    // ログインは成功させる(次回のログインでまた試される)。
    if (needsRehash) {
      c.executionCtx.waitUntil(rehashParticipantPassword(c.env, participant.id, password));
    }
```

`packages/shared/src/schemas/password.ts`(新規)

```typescript
// 桁数を増やすより使い回しを止める方が効く。記号必須などの文字種強制は
// 利用者の負担に見合わないので入れない。
export const PasswordSchema = z
  .string()
  .min(8, {message: 'パスワードは8文字以上で入力してください'})
  // 上限が無いと、長大な入力で PBKDF2 の計算量を吊り上げられる。
  .max(256, {message: 'パスワードは256文字以内で入力してください'})
  .refine(v => !COMMON_PASSWORDS.has(v.toLowerCase()), {
    message: 'よく使われるパスワードは設定できません',
  });
```

#### テスト

* In `apps/backend/src/lib/password.test.ts`
  * `verifyPassword accepts a hash stored in the legacy salt:hash format`
  * `verifyPassword reports needsRehash for a legacy hash`
  * `verifyPassword does not report needsRehash for a current hash`
  * `verifyPassword rejects a hash naming an unknown algorithm`
  * `hashPassword writes the algorithm and iteration count into the stored value`
* In `apps/backend/src/routes/participant-auth.test.ts` / `staff-auth.test.ts`
  * `login rehashes a legacy password and still succeeds`
  * `login still succeeds when the rehash fails`
* In `packages/shared/src/schemas/password.test.ts`
  * `PasswordSchema rejects a common password`
  * `PasswordSchema rejects a password over the maximum length`
* 計測: 選定した反復回数での `hashPassword` / `verifyPassword` の所要時間を記録し、`lib/password.ts` のコメントに残す

#### 依存タスク

* Task 3-3, Task 5-1, Task 5-5, Task 6-1
