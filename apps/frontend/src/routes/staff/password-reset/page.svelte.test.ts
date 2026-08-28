import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import Page from './+page.svelte';
import type {ActionData} from './$types';

function renderPage(options: {hasToken?: boolean; form?: ActionData} = {}) {
  render(Page, {
    props: {
      params: {},
      data: {loggedIn: false, hasToken: options.hasToken ?? true},
      form: options.form ?? null,
    },
  });
}

describe('staff password reset +page.svelte', () => {
  it('asks for the new password twice when the link carried a token', () => {
    renderPage();

    expect(screen.getByLabelText('パスワード')).toBeInTheDocument();
    expect(screen.getByLabelText('パスワード(確認用)')).toBeInTheDocument();
  });

  it('posts to its own URL so the token query parameter survives', () => {
    const {container} = render(Page, {
      props: {params: {}, data: {loggedIn: false, hasToken: true}, form: null},
    });

    const form = container.querySelector('form');
    expect(form?.getAttribute('method')).toBe('POST');
    expect(form?.hasAttribute('action')).toBe(false);
  });

  it('explains where to get a link instead of a form when there is no token', () => {
    renderPage({hasToken: false});

    expect(screen.queryByLabelText('パスワード')).not.toBeInTheDocument();
    expect(
      screen.getByText(/管理スタッフにリンクの再発行を依頼/),
    ).toBeInTheDocument();
  });

  it('shows the error the action came back with', () => {
    renderPage({form: {error: 'パスワードが一致しません'}});

    expect(screen.getByRole('alert')).toHaveTextContent(
      'パスワードが一致しません',
    );
  });

  it('links back to the staff login page', () => {
    renderPage();

    expect(
      screen.getByRole('link', {name: 'ログイン画面へ戻る'}),
    ).toHaveAttribute('href', '/staff/login');
  });
});
