// Server-rendered output, which is all a visitor with JS off ever gets. The
// companion `TextField.svelte.test.ts` covers the mounted component; this file
// is in the `server` project so nothing here can be satisfied by an effect.

import {createRawSnippet} from 'svelte';
import type {Component, ComponentProps} from 'svelte';
import {render} from 'svelte/server';
import {describe, expect, it} from 'vitest';
import TextField from './TextField.svelte';

const FIELD = {id: 'name', name: 'name', label: '氏名'};

// `render()` takes `Omit<Props, ...>`, which is more than TypeScript can
// represent for a union of every input and textarea attribute. The props are
// still checked, by `renderToHtml()`'s own parameter.
const UncheckedTextField = TextField as unknown as Component<object>;

/** The HTML the server sends for one field. */
function renderToHtml(props: ComponentProps<typeof TextField>) {
  return render(UncheckedTextField, {props}).body;
}

describe('TextField (server-rendered)', () => {
  it('puts the value in the input', () => {
    // `defaultValue` would be dropped here, and a rejected submission would
    // come back blank. See `apps/frontend/README.md`.
    expect(renderToHtml({...FIELD, value: '山田'})).toMatch(
      /<input[^>]*value="山田"/,
    );
  });

  it('puts the value in the textarea', () => {
    expect(renderToHtml({...FIELD, multiline: true, value: '山田'})).toMatch(
      /<textarea[^>]*>山田<\/textarea>/,
    );
  });

  it('wires the message to the control', () => {
    const body = renderToHtml({...FIELD, error: '入力してください'});

    expect(body).toContain('aria-describedby="name-error"');
    expect(body).toContain('aria-invalid="true"');
    expect(body).toMatch(/<p[^>]*id="name-error"[^>]*>入力してください<\/p>/);
  });

  it('renders a snippet label in the label element', () => {
    const body = renderToHtml({
      ...FIELD,
      label: createRawSnippet(() => ({render: () => '<em>氏名</em>'})),
    });

    expect(body).toMatch(
      /<label[^>]*for="name"[^>]*>.*<em>氏名<\/em>.*<\/label>/,
    );
  });

  it('leaves the wiring out while there is no message', () => {
    const body = renderToHtml(FIELD);

    expect(body).not.toContain('aria-describedby');
    expect(body).not.toContain('aria-invalid');
  });
});
