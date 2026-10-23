import {render, screen} from '@testing-library/svelte';
import {afterEach, describe, expect, it} from 'vitest';
import Page from './+page.svelte';
import type {ActionData} from './$types';

const TOKEN = 'b3f1c0de';

function renderPage(options: {hasToken?: boolean; form?: ActionData} = {}) {
  render(Page, {
    props: {
      params: {},
      data: {
        loggedIn: false,
        isGeneralStaff: false,
        token: (options.hasToken ?? true) ? TOKEN : null,
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

  it('posts to its own URL with the token in a hidden field', () => {
    const {container} = render(Page, {
      props: {
        params: {},
        data: {loggedIn: false, isGeneralStaff: false, token: TOKEN},
        form: null,
      },
    });

    const form = container.querySelector('form');
    expect(form?.getAttribute('method')).toBe('POST');
    // Posting back to the page's own URL is the fallback for a browser that
    // never ran the script taking the token out of it.
    expect(form?.hasAttribute('action')).toBe(false);
    const field = form?.querySelector<HTMLInputElement>('input[name="token"]');
    expect(field?.type).toBe('hidden');
    expect(field?.value).toBe(TOKEN);
  });

  describe('the token in the URL (#120)', () => {
    afterEach(() => {
      history.replaceState(null, '', '/');
    });

    it('the token is removed from the URL after it is read', () => {
      history.replaceState(null, '', `/staff/password-reset?token=${TOKEN}`);

      renderPage();

      expect(window.location.pathname).toBe('/staff/password-reset');
      expect(window.location.search).toBe('');
    });
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
