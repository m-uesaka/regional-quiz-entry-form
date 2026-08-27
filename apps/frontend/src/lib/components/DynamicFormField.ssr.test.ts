// Server-rendered output, which is what a visitor answers before the client
// bundle takes the form over — and all a visitor with JS off ever gets. The
// companion `DynamicFormField.svelte.test.ts` covers the mounted component;
// this file is deliberately in the `server` project so nothing here can be
// satisfied by an effect that only runs in a browser.

import {render} from 'svelte/server';
import {describe, expect, it} from 'vitest';
import type {FormFieldDefYaml} from '@regional-quiz/shared';
import DynamicFormField from './DynamicFormField.svelte';

/** The HTML the server sends for one field. */
function renderToHtml(field: FormFieldDefYaml, value: string | string[]) {
  return render(DynamicFormField, {props: {field, value}}).body;
}

describe('DynamicFormField (server-rendered)', () => {
  it('leaves a required checkbox group unconstrained', () => {
    // The group's "at least one checked" rule is spelled as a `required`
    // that is dropped again once a box is checked, and dropping it takes a
    // re-render the server-rendered page can't do — so a visitor who
    // checked one box would be blocked by the `required` still sitting on
    // the others, with nothing around to remove it. See #95.
    const field: FormFieldDefYaml = {
      type: 'checkbox',
      key: 'toppings',
      label: 'トッピング',
      required: true,
      options: ['チーズ', 'ベーコン'],
    };

    expect(renderToHtml(field, [])).not.toContain('required');
  });

  it('keeps the required constraint on a boolean checkbox', () => {
    // One box, and the browser's own rule for it ("this box must be
    // checked") is exactly the field's rule, so it needs no script.
    const field: FormFieldDefYaml = {
      type: 'checkbox',
      key: 'agree',
      label: '規約に同意する',
      required: true,
    };

    expect(renderToHtml(field, [])).toContain('required');
  });

  it('keeps the required constraint on a radio group', () => {
    // A radio group's `required` already means "one of the group", so it
    // holds without a re-render too.
    const field: FormFieldDefYaml = {
      type: 'radio',
      key: 'lunch',
      label: 'お弁当',
      required: true,
      options: ['和食', '洋食'],
    };

    expect(renderToHtml(field, '')).toContain('required');
  });

  it('keeps the required constraint on a textarea', () => {
    const field: FormFieldDefYaml = {
      type: 'textarea',
      key: 'note',
      label: '備考',
      required: true,
    };

    expect(renderToHtml(field, '')).toContain('required');
  });

  it('renders the message the action rejected the answer with', () => {
    const field: FormFieldDefYaml = {
      type: 'checkbox',
      key: 'toppings',
      label: 'トッピング',
      required: true,
      options: ['チーズ', 'ベーコン'],
    };

    const html = render(DynamicFormField, {
      props: {field, value: [], error: '「トッピング」は必須です'},
    }).body;

    expect(html).toContain('「トッピング」は必須です');
  });
});
