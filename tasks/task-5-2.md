[← tasks.md](../tasks.md) / Phase 5: 参加者向けマイページ

### Task 5-2: マイページ トップ(複数大会のエントリー状況)

#### 実装・更新内容

* ログイン中の participant が持つ全エントリー(同一地域内の最強位・新人王両方を含みうる)を一覧表示する `GET /mypage/entries` API と、対応するフロントページを実装する。

#### コードスニペット

`apps/backend/src/routes/mypage.ts`

```typescript
import { Hono } from 'hono';
import type { Env } from '../types/env';
import { requireParticipant } from '../middleware/participant-auth';
import { createDbClient } from '../lib/db';

export const mypageRoute = new Hono<Env>()
  .use('*', requireParticipant())
  .get('/entries', async (c) => {
    const db = createDbClient(c.env);
    const { data } = await db
      .from('entries')
      .select('*, tournaments(name, type, region_id)')
      .eq('participant_id', c.get('participantId'));
    return c.json(data ?? []);
  });
```

`apps/frontend/src/routes/mypage/+page.svelte`

```svelte
<script lang="ts">
  import type { PageProps } from './$types';
  let { data }: PageProps = $props();
</script>

<h1>マイページ</h1>
{#each data.entries as entry (entry.id)}
  <section>
    <h2>{entry.tournaments.name}({entry.tournaments.type === 'saikyoi' ? '最強位' : '新人王'})</h2>
    <p>ステータス: {entry.status}</p>
    <a href={`/mypage/${entry.tournamentId}/edit`}>編集する</a>
  </section>
{/each}
```

#### テスト

* In `apps/backend/src/routes/mypage.test.ts`
  * `GET /mypage/entries returns only the logged-in participant's entries`
    * 2 participant 分の entry を用意し、片方のセッションでリクエストして自分のものだけ返ることを assert する
  * `GET /mypage/entries returns entries for both saikyoi and shinjinou in the same region`
    * 同一地域の2大会にエントリーした participant で、両方が配列に含まれることを assert する

#### 依存タスク

* Task 5-1
