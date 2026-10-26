import {render} from '@testing-library/svelte';
import {createRawSnippet} from 'svelte';
import {describe, expect, it} from 'vitest';
import Card from './Card.svelte';
import Input from './Input.svelte';

// Covers the local changes made to the vendored Rabee UI components; the
// rest of their behaviour is upstream's.

const body = createRawSnippet(() => ({render: () => '<p>本文</p>'}));

describe('Card', () => {
  it('lets a caller override the base spacing rather than sit beside it', () => {
    const {container} = render(Card, {class: 'gap-4', children: body});

    const card = container.querySelector('[data-rabee-ui="card"]');
    expect(card).toHaveClass('gap-4', 'bg-surface');
    expect(card).not.toHaveClass('gap-6');
  });
});

describe('Input', () => {
  it('leaves the padding to Tailwind when there is no start/end content', () => {
    const {container} = render(Input, {name: 'email'});

    expect(container.querySelector('input')).not.toHaveAttribute('style');
  });
});
