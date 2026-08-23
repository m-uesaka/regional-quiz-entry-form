[← tasks.md](../tasks.md) / Phase 3: エントリーフォーム機能(参加者向け)

### Task 3-2: レギュレーション確認 UI と優先期間ロジック ✅

#### 実装・更新内容

* 大会に紐づくレギュレーション一覧を表示し、参加者が満たすものを1つ以上選択(チェック)させる UI を実装する。
* 「現在時刻が優先期間内であれば、優先期間の設定されたレギュレーションのいずれかを選ばないとエントリーできない」判定ロジックを `packages/shared` に共通関数として実装し、フロント(エントリー不可の表示)とバックエンド(Task 3-3 のバリデーション)の両方から使う。

#### コードスニペット

`packages/shared/src/logic/regulation-eligibility.ts`

```typescript
export interface RegulationWindow {
  id: string;
  priorityStartsAt: string | null;
  priorityEndsAt: string | null;
}

export function isRegulationSelectionAllowed(
  regulations: RegulationWindow[],
  selectedRegulationId: string,
  now: Date,
): boolean {
  const activePriorityIds = regulations
    .filter((r) => r.priorityStartsAt && r.priorityEndsAt)
    .filter((r) => now >= new Date(r.priorityStartsAt!) && now <= new Date(r.priorityEndsAt!))
    .map((r) => r.id);

  if (activePriorityIds.length === 0) return true;
  return activePriorityIds.includes(selectedRegulationId);
}
```

#### テスト

* In `packages/shared/src/logic/regulation-eligibility.test.ts`
  * `allows any regulation when no priority window is active`
    * 優先期間を持たないレギュレーションのみで呼び出し、`true` を assert する
  * `restricts to priority regulations during their window`
    * 優先期間中の時刻を渡し、優先対象外レギュレーションの選択で `false` を assert する
  * `opens up after the priority window ends`
    * 優先期間終了後の時刻を渡し、非優先レギュレーションの選択でも `true` を assert する

#### 依存タスク

* Task 1-2
