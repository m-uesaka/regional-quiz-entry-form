import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import Page from './+page.svelte';
import type {ActionData} from './$types';

function renderPage(options: {hasToken?: boolean; form?: ActionData} = {}) {
  return render(Page, {
    props: {
      params: {},
      data: {hasToken: options.hasToken ?? false},
      form: options.form ?? null,
    },
  });
}

describe('password reset +page.svelte', () => {
  it('asks for an email address when the page was opened without a token', () => {
    renderPage();

    expect(screen.getByLabelText('メールアドレス')).toBeInTheDocument();
    expect(screen.queryByLabelText('新しいパスワード')).not.toBeInTheDocument();
  });

  it('asks for a new password twice when the mailed link carried a token', () => {
    renderPage({hasToken: true});

    expect(screen.getByLabelText('新しいパスワード')).toBeInTheDocument();
    expect(
      screen.getByLabelText('新しいパスワード(確認用)'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('メールアドレス')).not.toBeInTheDocument();
  });

  it('replaces the email form with a neutral confirmation once a link was asked for', () => {
    renderPage({form: {sent: true}});

    expect(screen.getByRole('status')).toHaveTextContent(
      'パスワード再設定用のリンクをメールで送信しました',
    );
    expect(screen.queryByLabelText('メールアドレス')).not.toBeInTheDocument();
  });

  it('shows the error the action came back with', () => {
    renderPage({
      hasToken: true,
      form: {error: 'パスワードが一致しません', tokenRejected: false},
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'パスワードが一致しません',
    );
  });

  it('links back to the login page', () => {
    renderPage();

    expect(
      screen.getByRole('link', {name: 'ログイン画面へ戻る'}),
    ).toHaveAttribute('href', '/mypage/login');
  });

  // The token stays in an httpOnly cookie (`$lib/server/reset-token.ts`):
  // nothing in the page carries it (#120).
  it('puts no token in the form', () => {
    const {container} = renderPage({hasToken: true});

    expect(container.querySelector('input[name="token"]')).toBeNull();
  });

  it('offers the request form again once the API has refused the token', () => {
    renderPage({
      hasToken: true,
      form: {
        error:
          'このリンクは無効か、有効期限が切れています。もう一度パスワード再設定をやり直してください',
        tokenRejected: true,
      },
    });

    expect(screen.getByLabelText('メールアドレス')).toBeInTheDocument();
    expect(screen.queryByLabelText('新しいパスワード')).not.toBeInTheDocument();
  });
});
