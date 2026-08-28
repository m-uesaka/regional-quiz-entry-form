[← tasks.md](../tasks.md) / Phase 9: 管理機能の欠落解消(運用ブロッカー)

### Task 9-5: `/api/*` の Worker route 有効化(#101)

#### 実装・更新内容

* `apps/backend/wrangler.toml` の `[env.staging]` / `[env.production]` にある `routes` がコメントアウトされたままで、本番のフロントエンド・オリジンで `/api/*` がバックエンド Worker に届かない。`docs/supabase-deployment.md` 6.4 と #101 で追跡している Task 8-2 の残作業。
* 影響は「まだ繋がっていない」では済まない。ブラウザから直接 `/api/*` を叩いている以下は**本番で 404 になる**:
  * CSV ダウンロードリンク(`apps/frontend/src/routes/staff/[regionSlug]/[tournamentSlug]/entries/+page.svelte`)— 要件の「CSV出力機能」が提供できていない。
  * `/admin/tournaments/new` の大会作成、`/admin/tournaments/[id]/edit` のクライアント遷移、スプレッドシート取り込みパネル。
* 実ドメインを取得して Cloudflare Pages にカスタムドメインを割り当てた上で、`routes` を有効化する。`zone_name` が Cloudflare アカウントの持たないゾーンだと `wrangler deploy` 自体が落ちるため、ドメイン取得が前提条件になる。
* 併せて、疎通確認をデプロイワークフローの smoke test に組み込む。「route が効いているか」はフロントエンドのオリジンで `/api/healthz` が返るかどうかで判定できる。

#### コードスニペット

`apps/backend/wrangler.toml`

```toml
[env.production]
name = "regional-quiz-backend"
# routes は [env.*] の直下に書く。[env.*.vars] の下に置くと `routes` という名の
# var として解釈され、警告もエラーも出ないまま route 無しでデプロイされる。
routes = [
  {pattern = "entry.example.jp/api/*", zone_name = "example.jp"},
]
```

`.github/workflows/deploy-production.yml`(追記)

```yaml
      - name: Smoke test the /api/* route
        # Pages と Workers が同じホスト名を持つとき Workers route が優先される。
        # フロントエンドのオリジンで healthz が返れば route が効いている。
        run: |
          status=$(curl -s -o /dev/null -w '%{http_code}' \
            "https://${{ vars.FRONTEND_HOST }}/api/healthz")
          test "$status" = "200" || {
            echo "::error::/api/* is not routed to the backend Worker (got $status)"
            exit 1
          }
```

#### テスト

* 手動確認: `https://<frontend-host>/api/healthz` が `{"ok":true}` を返すこと
* 手動確認: スタッフ画面から CSV ダウンロードリンクを踏んでファイルが落ちること
* 手動確認: `/admin/tournaments/new` から大会を作成できること
* CI: 上記 smoke test を含むデプロイワークフローが成功すること

#### 依存タスク

* Task 8-2
