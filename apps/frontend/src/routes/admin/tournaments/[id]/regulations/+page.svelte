<script lang="ts">
  import type {Regulation} from '@regional-quiz/shared';
  import {toJstDatetimeLocal} from '$lib/jst-datetime';
  import type {RegulationRowValues} from '$lib/types/regulation-form';
  import type {PageProps} from './$types';

  const {data, form, params}: PageProps = $props();

  /**
   * Turns a stored regulation into the row the controls carry. The priority
   * window is shown as JST wall-clock time, which is what the action reads
   * back.
   * @param regulation One of the tournament's regulations.
   */
  function toRowValues(regulation: Regulation): RegulationRowValues {
    return {
      id: regulation.id,
      // The rendered position fills this in; a row only carries a value of
      // its own after a rejected save, where it echoes what was typed.
      order: '',
      label: regulation.label,
      priorityStartsAt: toJstDatetimeLocal(regulation.priorityStartsAt),
      priorityEndsAt: toJstDatetimeLocal(regulation.priorityEndsAt),
      remove: false,
    };
  }

  function emptyRow(): RegulationRowValues {
    return {
      id: '',
      order: '',
      label: '',
      priorityStartsAt: '',
      priorityEndsAt: '',
      remove: false,
    };
  }

  /**
   * Keeps exactly one blank row at the bottom, which is how a regulation is
   * added without any client-side scripting. A rejected save comes back with
   * its own blank row already in place, so another is only appended when the
   * last row is a saved one.
   * @param current The rows to display.
   */
  function withBlankRow(
    current: RegulationRowValues[],
  ): RegulationRowValues[] {
    const last = current.at(-1);
    if (last && last.id === '' && last.label.trim() === '') return current;
    return [...current, emptyRow()];
  }

  // A refused save re-renders what was submitted; anything else shows the
  // stored regulations, which `load` re-reads after every successful save.
  const rows = $derived(
    withBlankRow(form?.rows ?? data.regulations.map(toRowValues)),
  );
</script>

<h1>レギュレーションの管理</h1>

<p>
  エントリーフォームには「表示順」の小さい順に表示されます。並び替えるには番号を
  書き換えて保存してください。
</p>

{#if form?.saved}
  <p role="status">レギュレーションを保存しました</p>
{/if}
{#if form?.error}
  <p role="alert">{form.error}</p>
{/if}

<form method="POST">
  {#each rows as row, index (index)}
    <fieldset>
      <legend>{index + 1} 番目</legend>

      <input type="hidden" name="regulations[{index}].id" value={row.id} />

      <label>
        表示順
        <!-- Pre-filled with the row's current position so the numbers read
             as an absolute order the staff member can rewrite, rather than
             as an offset they have to work out. -->
        <input
          name="regulations[{index}].order"
          type="number"
          min="1"
          value={row.order === '' ? String(index + 1) : row.order}
        />
      </label>

      <label>
        レギュレーション名
        <input
          name="regulations[{index}].label"
          type="text"
          value={row.label}
        />
      </label>

      <!-- Both ends are set together or not at all; the schema refuses a
           half-filled window rather than guessing the missing end. -->
      <label>
        優先期間の開始 (JST)
        <input
          name="regulations[{index}].priorityStartsAt"
          type="datetime-local"
          value={row.priorityStartsAt}
        />
      </label>

      <label>
        優先期間の終了 (JST)
        <input
          name="regulations[{index}].priorityEndsAt"
          type="datetime-local"
          value={row.priorityEndsAt}
        />
      </label>

      {#if row.id !== ''}
        <label>
          <input
            name="regulations[{index}].remove"
            type="checkbox"
            checked={row.remove}
          />
          削除する
        </label>
      {/if}
    </fieldset>
  {/each}

  <button type="submit">保存</button>
</form>

<a href="/admin/tournaments/{params.id}/edit">大会の編集へ戻る</a>
