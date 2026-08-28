import {render, screen} from '@testing-library/svelte';
import {createRawSnippet} from 'svelte';
import {describe, expect, it} from 'vitest';
import Layout from './+layout.svelte';

/** Stands in for the page the layout wraps. */
const children = createRawSnippet(() => ({
  render: () => '<p>ページ本文</p>',
}));

describe('mypage +layout.svelte', () => {
  it('offers logging out, posting to the mypage action', () => {
    render(Layout, {data: {loggedIn: true}, children, params: {}});

    const button = screen.getByRole('button', {name: 'ログアウト'});
    // Absolute, so the nested entry-edit screens post to the same action.
    expect(button.closest('form')).toHaveAttribute('action', '/mypage?/logout');
    expect(button.closest('form')).toHaveAttribute('method', 'POST');
  });

  it('hides the button on the login screen, where there is no session', () => {
    render(Layout, {data: {loggedIn: false}, children, params: {}});

    expect(screen.queryByRole('button', {name: 'ログアウト'})).toBeNull();
    expect(screen.getByText('ページ本文')).toBeInTheDocument();
  });
});
