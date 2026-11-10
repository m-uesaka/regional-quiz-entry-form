import type {RemoteFormField, RemoteFormIssue} from '@sveltejs/kit';
import type {Attachment} from 'svelte/attachments';
import {INVALID_INPUT_MESSAGE} from '$lib/form-errors';

/**
 * The message to show above a remote form (`form()` from `$app/server`) that
 * was refused, given its `fields.allIssues()`.
 *
 * An issue without a path belongs to the form as a whole — the handler threw
 * it with `invalid('...')` — and is shown as it is. Issues that belong to
 * controls are shown next to those controls instead, so above the form they
 * are summed up as one line asking to check the input.
 *
 * @param issues What `fields.allIssues()` returned; undefined while the form
 *     has not been refused.
 * @return The message, or null when there is nothing to show.
 */
export function formErrorMessage(
  issues: RemoteFormIssue[] | undefined,
): string | null {
  if (!issues || issues.length === 0) return null;
  const formIssue = issues.find(issue => issue.path.length === 0);
  return formIssue?.message ?? INVALID_INPUT_MESSAGE;
}

/** What `textFieldProps()` hands `TextField`. */
interface TextFieldProps {
  name: string;
  type: 'text';
  value: string;
  defaultValue?: string;
  error: string | undefined;
}

/**
 * The props that wire a `TextField` to one string field of a remote form:
 * its name, its current value and its first issue.
 *
 * `field.as('text')` cannot be spread onto `TextField` as it is: its `value`
 * is typed `string | number`, and it carries an `aria-invalid` that
 * `TextField` derives from `error` itself.
 *
 * Call it inside the markup (`{...textFieldProps(form.fields.name)}`), so
 * that it runs again when the form's state changes.
 *
 * @param field The field, e.g. `createRegion.fields.name`.
 * @param initial What the control starts at and resets to, for a form that
 *     edits something stored.
 */
export function textFieldProps(
  field: RemoteFormField<string>,
  initial?: string,
): TextFieldProps {
  const {name, value} =
    initial === undefined ? field.as('text') : field.as('text', initial);
  return {
    name,
    type: 'text',
    value: String(value),
    ...(initial === undefined ? {} : {defaultValue: initial}),
    error: field.issues()?.[0]?.message,
  };
}

/**
 * The query parameter a remote form posts to when it is submitted without
 * JavaScript (`?/remote=<id>`, the form's `action`).
 */
const REMOTE_ACTION_PARAM = '/remote';

/**
 * The URL of the page a remote form was submitted from, given the `url` of
 * the request its handler runs in.
 *
 * Submitted by the client bundle, a remote form's handler already sees the
 * page's URL. Submitted without JavaScript, the browser posts to the form's
 * `action`, so the handler sees the page's URL with `?/remote=<id>` added —
 * which must not end up in a link back to the page, such as the login
 * screen's `redirectTo`.
 *
 * @param url `getRequestEvent().url` inside the handler.
 * @return A copy of `url` without the remote action.
 */
export function remoteFormPageUrl(url: URL): URL {
  const page = new URL(url);
  page.searchParams.delete(REMOTE_ACTION_PARAM);
  return page;
}

/**
 * Whether a control holds something other than what it was rendered with.
 * @param control One of a form's `elements`.
 */
function isEdited(control: Element): boolean {
  if (control instanceof HTMLInputElement) {
    return control.type === 'checkbox' || control.type === 'radio'
      ? control.checked !== control.defaultChecked
      : control.value !== control.defaultValue;
  }
  if (control instanceof HTMLTextAreaElement) {
    return control.value !== control.defaultValue;
  }
  if (control instanceof HTMLSelectElement) {
    return Array.from(control.options).some(
      option => option.selected !== option.defaultSelected,
    );
  }
  return false;
}

/**
 * Tells a remote form about what was typed into it before the client bundle
 * took over. Goes on the `<form>`, after the form itself:
 *
 * ```svelte
 * <form {...createRegion} {@attach adoptEarlyInput}>
 * ```
 *
 * A remote form keeps its own copy of each field's value and learns of a
 * change from the control's `input` event. It only starts listening once the
 * page has hydrated, so what was typed into the server-rendered page is
 * missing from that copy. Nothing shows until the form renders again from
 * the copy — which is what a refused submission does, emptying those
 * controls just as their messages appear (the same loss as #90, one step
 * later). Replaying an `input` event for every control that no longer holds
 * what it was rendered with hands the form what it missed.
 *
 * The listener this relies on is added by the form's own attachment, which
 * is why the order on the element matters.
 */
export const adoptEarlyInput: Attachment<HTMLFormElement> = form => {
  for (const control of form.elements) {
    if (isEdited(control)) {
      control.dispatchEvent(new Event('input', {bubbles: true}));
    }
  }
};

/**
 * Hands out one instance of a remote form per key, and the same one every
 * time it is asked for that key:
 *
 * ```svelte
 * <script lang="ts">
 *   const updateFormOf = keyedForms(updateRegion);
 * </script>
 *
 * {#each data.regions as region (region.id)}
 *   {@const update = updateFormOf(region.id)}
 * ```
 *
 * `form.for(key)` on its own does not promise that. SvelteKit keeps the
 * instance only while something it counts is using it, and for a row that
 * was rendered on the server the count does not hold across the list being
 * loaded again — which a successful submission triggers. `for(key)` then
 * returns a fresh instance, and the result the old one had just received is
 * gone: the row's "saved" message showed for a few milliseconds and vanished
 * (found by `apps/e2e/tests/admin-regions.spec.ts` on a slow CI runner).
 * Holding on to the instance for as long as the page lives avoids it.
 *
 * Call it once, in the component's `<script>`.
 *
 * @param form The remote form, e.g. `updateRegion`.
 * @return Looks up, or on first use creates, the instance for a key.
 */
export function keyedForms<Instance>(form: {
  for(key: string): Instance;
}): (key: string) => Instance {
  const instances = new Map<string, Instance>();
  return key => {
    let instance = instances.get(key);
    if (instance === undefined) {
      instance = form.for(key);
      instances.set(key, instance);
    }
    return instance;
  };
}
