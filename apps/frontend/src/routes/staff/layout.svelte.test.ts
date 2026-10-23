import {render, screen} from '@testing-library/svelte';
import {createRawSnippet} from 'svelte';
import {describe, expect, it} from 'vitest';
import Layout from './+layout.svelte';

/** Stands in for the page the layout wraps. */
const children = createRawSnippet(() => ({
  render: () => '<p>ページ本文</p>',
}));

describe('staff +layout.svelte', () => {
  it('offers logging out, posting to the staff logout route', () => {
    render(Layout, {
      data: {loggedIn: true, isGeneralStaff: false},
      children,
      params: {},
    });

    const button = screen.getByRole('button', {name: 'ログアウト'});
    expect(button.closest('form')).toHaveAttribute('action', '/staff/logout');
    expect(button.closest('form')).toHaveAttribute('method', 'POST');
  });

  it('hides the button on the login screen, where there is no session', () => {
    render(Layout, {
      data: {loggedIn: false, isGeneralStaff: false},
      children,
      params: {},
    });

    expect(screen.queryByRole('button', {name: 'ログアウト'})).toBeNull();
    expect(screen.getByText('ページ本文')).toBeInTheDocument();
  });

  it('links general staff to the dashboard', () => {
    render(Layout, {
      data: {loggedIn: true, isGeneralStaff: true},
      children,
      params: {},
    });

    expect(screen.getByRole('link', {name: 'ダッシュボード'})).toHaveAttribute(
      'href',
      '/staff/dashboard',
    );
  });

  it('does not link regional staff to the dashboard, which refuses them', () => {
    render(Layout, {
      data: {loggedIn: true, isGeneralStaff: false},
      children,
      params: {},
    });

    expect(screen.queryByRole('link', {name: 'ダッシュボード'})).toBeNull();
  });
});
