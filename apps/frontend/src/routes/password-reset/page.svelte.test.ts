import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import Page from './+page.svelte';
import type {ActionData} from './$types';

function renderPage(options: {hasToken?: boolean; form?: ActionData} = {}) {
  render(Page, {
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
    renderPage({hasToken: true, form: {error: 'パスワードが一致しません'}});

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
});
