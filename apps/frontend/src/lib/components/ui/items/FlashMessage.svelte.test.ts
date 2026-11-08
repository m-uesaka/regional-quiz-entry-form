import {render, screen} from '@testing-library/svelte';
import {createRawSnippet} from 'svelte';
import {describe, expect, it} from 'vitest';
import FlashMessage from './FlashMessage.svelte';

/** Children holding one inline element, as a message with a link has. */
function text(html: string) {
  return createRawSnippet(() => ({render: () => html}));
}

describe('FlashMessage', () => {
  it('shows an error as a danger message announced at once', () => {
    const {container} = render(FlashMessage, {
      kind: 'error',
      children: text('<span>保存できませんでした</span>'),
    });

    const message = container.querySelector('[data-rabee-ui="message"]');
    expect(message).toHaveClass('bg-destructive/10', 'border-destructive');
    const line = screen.getByRole('alert');
    expect(line.tagName).toBe('P');
    expect(line).toHaveClass('text-sm', 'text-foreground');
    expect(line).toHaveTextContent('保存できませんでした');
    expect(message).toContainElement(line);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a success as a success message announced politely', () => {
    const {container} = render(FlashMessage, {
      kind: 'success',
      children: text('<span>保存しました</span>'),
    });

    const message = container.querySelector('[data-rabee-ui="message"]');
    expect(message).toHaveClass('bg-success/10', 'border-success');
    const line = screen.getByRole('status');
    expect(line.tagName).toBe('P');
    expect(line).toHaveClass('text-sm', 'text-foreground');
    expect(line).toHaveTextContent('保存しました');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps inline markup in the text', () => {
    render(FlashMessage, {
      kind: 'error',
      children: text('<a href="/admin/regions">地域の管理</a>'),
    });

    expect(screen.getByRole('alert')).toContainElement(
      screen.getByRole('link', {name: '地域の管理'}),
    );
  });
});
