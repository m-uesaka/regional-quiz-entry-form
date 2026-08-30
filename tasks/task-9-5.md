[← tasks.md](../tasks.md) / Phase 9: 管理機能の欠落解消(運用ブロッカー)

### Task 9-5: `/api/*` の Worker route 有効化(#101)

#### 実装・更新内容

* `apps/backend/wrangler.toml` の `[env.staging]` / `[env.production]` にある `routes` がコメントアウトされたままで、本番のフロントエンド・オリジンで `/api/*` がバックエンド Worker に届かない。`docs/supabase-deployment.md` 6.4 と #101 で追跡している Task 8-2 の残作業。
* 影響は「まだ繋がっていない」では済まない。ブラウザから直接 `/api/*` を叩いている以下は**本番で 404 になる**:
  * CSV ダウンロードリンク(`apps/frontend/src/routes/staff/[regionSlug]/[tournamentSlug]/entries/+page.svelte`)— 要件の「CSV出力機能」が提供できていない。
  * `/admin/tournaments/new` の大会作成、`/admin/tournaments/[id]/edit` のクライアント遷移、スプレッドシート取り込みパネル。
* **route のホスト名は `wrangler.toml` に書かない**。Wrangler は route のゾーンをデプロイ時に Cloudflare アカウントへ問い合わせるため、アカウントが持たないゾーンを書くと `wrangler deploy` 自体が落ち、振り分けではなくパイプラインが壊れる。ドメイン取得を前提条件にしてしまうと、それまでリポジトリは「有効化できない設定」を抱え続けることになる。
* 代わりに、ホスト名を GitHub Environment の変数 `FRONTEND_HOST` に置き、`.github/workflows/deploy.yml` が設定されているときだけ `--route "$FRONTEND_HOST/api/*"` を付けてデプロイする。未設定なら route 無しでデプロイが通る(warning のみ)ため、ドメイン取得前でもパイプラインは壊れない。**実ドメインの有効化はコード変更なしの設定変更で済む。**
* `FRONTEND_URL` も同じ変数から `--var` で上書きする。これは `https://` + そのホスト名そのものであり、別々の設定にすると食い違いうる。しかもその食い違いはデプロイ時に気づけない — サイトは正常に見え、壊れるのはエントリー確定・パスワード再設定メール内のリンクだけだからである。`--var` は環境の vars を置き換えではなくマージするので、`MAIL_FROM_ADDRESS` と `wrangler secret put` 済みのシークレットはそのまま残る(wrangler 3.114 で `--dry-run` により確認済み)。
* `MAIL_FROM_ADDRESS` は導出しない。送信元ドメインはメール事業者側で検証済みのドメインであって、サイトのホスト名とは限らないため。`wrangler.toml` の手編集として残す。
* 併せて、疎通確認をデプロイワークフローの smoke test に組み込む。「route が効いているか」はフロントエンドのオリジンで `/api/healthz` が返るかどうかで判定できる。

#### コードスニペット

`.github/workflows/deploy.yml`

```yaml
      - name: Deploy the backend Worker
        run: |
          if [ -n "$FRONTEND_HOST" ]; then
            bunx wrangler deploy --env "$WRANGLER_ENV" \
              --route "$FRONTEND_HOST/api/*" \
              --var "FRONTEND_URL:https://$FRONTEND_HOST"
          else
            echo "::warning::FRONTEND_HOST is not set for this environment; ..."
            bunx wrangler deploy --env "$WRANGLER_ENV"
          fi
        working-directory: apps/backend
        env:
          WRANGLER_ENV: ${{ inputs.wrangler-env }}
          FRONTEND_HOST: ${{ vars.FRONTEND_HOST }}
          # ...

      # Pages デプロイの後。Worker は basePath('/api') を張っているので、
      # フロントエンドのオリジンで /api/healthz が返れば route が効いている。
      # route の伝播待ちのためリトライする。
      - name: Smoke test the /api/* route
        if: vars.FRONTEND_HOST != ''
        run: |
          for attempt in 1 2 3 4 5; do
            body=$(curl -fsS -m 10 "https://$FRONTEND_HOST/api/healthz" || true)
            case "$body" in
              *'"ok":true'*) exit 0 ;;
            esac
            sleep 10
          done
          echo "::error::/api/* does not reach the backend Worker"
          exit 1
        env:
          FRONTEND_HOST: ${{ vars.FRONTEND_HOST }}
```

`apps/backend/wrangler.toml` — `routes` は書かない。手で書き足す場合は `[env.*]` の直下に置くこと(`[env.*.vars]` の下だと `routes` という名の var として解釈され、警告もエラーも出ないまま route 無しでデプロイされる)。

#### 残作業(ドメイン取得が前提)

* [ ] 実ドメインを取得し、Cloudflare のゾーンに追加する
* [ ] Pages プロジェクト(production / staging)にカスタムドメインを割り当てる
* [ ] GitHub の `staging` / `production` Environment に `FRONTEND_HOST` 変数を登録する
* [ ] `wrangler.toml` の `[env.*.vars]` の `MAIL_FROM_ADDRESS` を実ドメインに差し替える
* [ ] Pages プロジェクトの `BACKEND_URL` がその環境のバックエンド Worker 自身のオリジン(`https://regional-quiz-backend[-staging].<subdomain>.workers.dev`)になっていることを確認する。フロントエンドのホスト名ではなく、ドメイン取得後も変更不要(手順書 6.3 / 6.4)

#### テスト

* 手動確認: `https://<frontend-host>/api/healthz` が `{"ok":true}` を返すこと
* 手動確認: スタッフ画面から CSV ダウンロードリンクを踏んでファイルが落ちること
* 手動確認: `/admin/tournaments/new` から大会を作成できること
* CI: 上記 smoke test を含むデプロイワークフローが成功すること

#### 依存タスク

* Task 8-2
