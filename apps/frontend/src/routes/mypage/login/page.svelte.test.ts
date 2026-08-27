import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import Page from './+page.svelte';
import type {ActionData} from './$types';

function renderPage(
  options: {passwordReset?: boolean; form?: ActionData} = {},
) {
  render(Page, {
    props: {
      params: {},
      data: {passwordReset: options.passwordReset ?? false},
      form: options.form ?? null,
    },
  });
}

describe('participant login +page.svelte', () => {
  it('asks for an email address and a password', () => {
    renderPage();

    expect(screen.getByLabelText('メールアドレス')).toBeInTheDocument();
    expect(screen.getByLabelText('パスワード')).toBeInTheDocument();
  });

  it('links to the password reset page', () => {
    renderPage();

    expect(
      screen.getByRole('link', {name: 'パスワードを忘れた方はこちら'}),
    ).toHaveAttribute('href', '/password-reset');
  });

  it('shows the rejection message and keeps the email typed in', () => {
    renderPage({
      form: {
        error: 'メールアドレスまたはパスワードが違います',
        email: 'sanka@example.com',
      },
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'メールアドレスまたはパスワードが違います',
    );
    expect(screen.getByLabelText('メールアドレス')).toHaveValue(
      'sanka@example.com',
    );
  });

  it('confirms a completed password reset', () => {
    renderPage({passwordReset: true});

    expect(screen.getByRole('status')).toHaveTextContent(
      'パスワードを再設定しました',
    );
  });

  it('says nothing about a password reset that did not happen', () => {
    renderPage();

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
