import {render, screen} from '@testing-library/svelte';
import {afterEach, describe, expect, it} from 'vitest';
import Page from './+page.svelte';
import type {ActionData} from './$types';

const TOKEN = 'b3f1c0de';

function renderPage(options: {hasToken?: boolean; form?: ActionData} = {}) {
  return render(Page, {
    props: {
      params: {},
      data: {token: options.hasToken ? TOKEN : null},
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

  describe('the token in the URL (#120)', () => {
    afterEach(() => {
      history.replaceState(null, '', '/');
    });

    it('the token is removed from the URL after it is read', () => {
      history.replaceState(null, '', `/password-reset?token=${TOKEN}&x=1`);

      renderPage({hasToken: true});

      expect(window.location.pathname).toBe('/password-reset');
      expect(window.location.search).toBe('?x=1');
    });

    it('carries the token in the form instead', () => {
      const {container} = renderPage({hasToken: true});

      const field = container.querySelector<HTMLInputElement>(
        'form input[name="token"]',
      );
      expect(field?.type).toBe('hidden');
      expect(field?.value).toBe(TOKEN);
    });
  });
});
