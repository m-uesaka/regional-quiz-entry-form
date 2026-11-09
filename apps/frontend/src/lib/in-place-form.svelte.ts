import type {SubmitFunction} from '@sveltejs/kit';

/**
 * Shown in place of the error page when the action itself failed (it threw,
 * or the request never reached it) rather than refusing with `fail()`.
 */
export const ACTION_ERROR_MESSAGE =
  '送信に失敗しました。時間をおいてもう一度お試しください';

/** How an {@link InPlaceForm} treats its controls once an answer is in. */
export interface InPlaceFormOptions {
  /**
   * Whether a successful submission clears the controls, as `update()`'s
   * own `reset` does. Defaults to true.
   */
  resetOnSuccess?: boolean;
  /**
   * Whether a refused or failed submission clears them too. For a
   * safeguard (a typed word, a required tick) that must be given again for
   * every attempt, as the page load the form used to cause did.
   */
  resetOnRefusal?: boolean;
}

/**
 * A form sent with `use:enhance` that stays on the page whatever comes
 * back, so state the page holds outside the form (an unsaved draft) isn't
 * thrown away by it.
 *
 * - An action that failed outright is reported through {@link error} rather
 *   than handed to `applyAction`, which would swap the page for
 *   `+error.svelte` (#338).
 * - A second submission while one is still out is dropped, and
 *   {@link pending} is there to disable the submit button with, so a double
 *   click doesn't send the action twice and have the second answer replace
 *   the first's (#338).
 *
 * Create it while the component initialises, and pass {@link submit} to
 * `use:enhance`.
 */
export class InPlaceForm {
  private submitting = $state(false);
  private failure = $state<string | null>(null);

  constructor(private readonly options: InPlaceFormOptions = {}) {}

  /** Whether a submission is out and its answer not yet applied. */
  get pending(): boolean {
    return this.submitting;
  }

  /** Why the last submission failed outright, if it did. */
  get error(): string | null {
    return this.failure;
  }

  /** The callback to give `use:enhance`. */
  readonly submit: SubmitFunction = ({cancel, formElement}) => {
    if (this.submitting) {
      cancel();
      return;
    }
    this.submitting = true;
    this.failure = null;
    return async ({result, update}) => {
      try {
        if (result.type === 'error') {
          this.failure = ACTION_ERROR_MESSAGE;
        } else {
          await update({reset: this.options.resetOnSuccess ?? true});
        }
        if (
          this.options.resetOnRefusal &&
          (result.type === 'failure' || result.type === 'error')
        ) {
          formElement.reset();
        }
      } finally {
        this.submitting = false;
      }
    };
  };
}
