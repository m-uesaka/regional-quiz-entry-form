import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import Page from './+page.svelte';
import type {ActionData} from './$types';

function renderPage(options: {hasToken?: boolean; form?: ActionData} = {}) {
  render(Page, {
    props: {
      params: {},
      data: {
        loggedIn: false,
        isGeneralStaff: false,
        hasToken: options.hasToken ?? true,
      },
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

  // The token stays in an httpOnly cookie (`$lib/server/reset-token.ts`):
  // nothing in the page carries it (#120).
  it('posts to its own URL with no token in the form', () => {
    const {container} = render(Page, {
      props: {
        params: {},
        data: {loggedIn: false, isGeneralStaff: false, hasToken: true},
        form: null,
      },
    });

    const form = container.querySelector('form');
    expect(form?.getAttribute('method')).toBe('POST');
    expect(form?.hasAttribute('action')).toBe(false);
    expect(form?.querySelector('input[name="token"]')).toBeNull();
  });

  it('offers the request form again once the API has refused the token', () => {
    renderPage({
      form: {
        error:
          'このリンクは無効か、有効期限が切れています。もう一度パスワード再設定を申し込むか、統括スタッフにリンクの再発行を依頼してください',
        tokenRejected: true,
      },
    });

    expect(screen.queryByLabelText('パスワード')).not.toBeInTheDocument();
    expect(screen.getByLabelText('メールアドレス')).toBeInTheDocument();
  });

  it('asks for the address and the account type when there is no token', () => {
    renderPage({hasToken: false});

    expect(screen.queryByLabelText('パスワード')).not.toBeInTheDocument();
    expect(screen.getByLabelText('メールアドレス')).toHaveAttribute(
      'name',
      'email',
    );
    expect(screen.getByLabelText('区分')).toHaveAttribute('name', 'scope');
    expect(
      screen.getByRole('button', {name: '再設定用リンクを送信する'}),
    ).toBeInTheDocument();
  });

  it('replaces the request form with a neutral confirmation once sent', () => {
    renderPage({hasToken: false, form: {sent: true}});

    expect(screen.getByRole('status')).toHaveTextContent(
      'パスワード再設定用のリンクをメールで送信しました',
    );
    expect(screen.queryByLabelText('メールアドレス')).not.toBeInTheDocument();
  });

  it('shows the error the action came back with', () => {
    renderPage({
      form: {error: 'パスワードが一致しません', tokenRejected: false},
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'パスワードが一致しません',
    );
  });

  it('offers to ask for a new link beside the password form', () => {
    renderPage();

    expect(
      screen.getByRole('link', {name: '新しいリンクを申し込む'}),
    ).toHaveAttribute('href', '/staff/password-reset?request');
  });

  it('links back to the staff login page', () => {
    renderPage();

    expect(
      screen.getByRole('link', {name: 'ログイン画面へ戻る'}),
    ).toHaveAttribute('href', '/staff/login');
  });
});
