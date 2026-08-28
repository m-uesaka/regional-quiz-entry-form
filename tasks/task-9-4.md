[← tasks.md](../tasks.md) / Phase 9: 管理機能の欠落解消(運用ブロッカー)

### Task 9-4: 統括スタッフ向け管理画面(地域・レギュレーション・スタッフ)

#### 実装・更新内容

* Task 9-1〜9-3 で足した API に画面を付ける。現状 `/admin` 配下にあるのは大会の作成・編集(`admin/tournaments/new`, `admin/tournaments/[id]/edit`)だけで、地域もレギュレーションもスタッフも UI が無い。
* 追加する画面:
  * `/admin/regions` — 地域の一覧・追加・名称変更。
  * `/admin/tournaments/[id]/regulations` — レギュレーションの並び替え・優先期間の設定。大会編集画面(既存)からリンクする。
  * `/admin/staff` — スタッフアカウントの一覧・招待・パスワード再設定リンクの再送。
* **`/admin/*` にサーバ側のガードを入れる**。現在 `admin/tournaments/new` には `+page.server.ts` が無く、未ログインでも作成フォームが表示される(送信して初めて API が 401 を返す)。`/admin` 直下に `+layout.server.ts` を置き、`locals.staff?.role === 'general'` でなければログイン画面へリダイレクトする。これは `/staff/*` 側が既にやっていることの横展開。
* 大会作成フォームの `regionId` を、UUID の直接入力から `GET /api/regions` を引いたセレクトボックスに置き換える。
* 各画面は `+page.server.ts` の `load` と form actions で組む。`admin/tournaments/new` などが使っているクライアント側 `createApiClient()` は Task 9-5 が終わるまで本番で 404 になるため、新規画面はサーバ経由に寄せる。

#### コードスニペット

`apps/frontend/src/routes/admin/+layout.server.ts`(新規)

```typescript
import {error, redirect} from '@sveltejs/kit';
import {staffLoginPath} from '$lib/server/staff-login';
import type {LayoutServerLoad} from './$types';

// /admin 配下は統括スタッフ専用。API 側でも requireGeneralStaff() が効いて
// いるが、未ログインの訪問者に管理フォームを描いて送信時に初めて弾く、という
// 挙動をやめるための入口側のガード。
export const load: LayoutServerLoad = ({locals, url}) => {
  if (!locals.staff) {
    redirect(303, staffLoginPath(url));
  }
  if (locals.staff.role !== 'general') {
    error(403, 'この画面を利用する権限がありません');
  }
  return {staff: locals.staff};
};
```

`apps/frontend/src/routes/admin/tournaments/[id]/regulations/+page.server.ts`(新規)

```typescript
export const load: PageServerLoad = async ({params, fetch}) => {
  const api = createApiClient(fetch);
  const res = await api.api.tournaments[':tournamentId'].regulations.$get({
    param: {tournamentId: params.id},
  });
  if (!res.ok) error(502, 'レギュレーションの取得に失敗しました');
  return {regulations: await res.json()};
};

export const actions = {
  default: async ({params, request, fetch}) => {
    const form = await request.formData();
    // 行は `regulations[i].label` 形式で送られてくる。並び順がそのまま
    // display_order になるので、添字の昇順で組み直す。
    const parsed = RegulationSyncInputSchema.safeParse({
      regulations: readRegulationRows(form),
    });
    if (!parsed.success) {
      return fail(400, {error: '入力内容を確認してください', /* ... */});
    }
    const res = await createApiClient(fetch)
      .api.tournaments[':tournamentId'].regulations.$put({
        param: {tournamentId: params.id},
        json: parsed.data,
      });
    if (!res.ok) {
      // 409 は「エントリーに使われているレギュレーションを消そうとした」。
      // API が日本語で理由を返すのでそのまま出す。
      return fail(res.status, {error: await readErrorMessage(res)});
    }
    return {saved: true};
  },
} satisfies Actions;
```

#### テスト

* In `apps/frontend/src/routes/admin/layout.server.test.ts`
  * `load redirects an anonymous visitor to the staff login`
  * `load rejects regional staff with 403`
* In `apps/frontend/src/routes/admin/regions/page.server.test.ts`
  * `the create action reports a duplicate slug on the slug field`
* In `apps/frontend/src/routes/admin/tournaments/[id]/regulations/page.server.test.ts`
  * `the save action sends the rows in the displayed order`
  * `the save action surfaces the API's 409 message`
* In `apps/frontend/src/routes/admin/staff/page.svelte.test.ts`
  * `the account list renders the region and tournament type of a regional account`

#### 依存タスク

* Task 2-4, Task 9-1, Task 9-2, Task 9-3
