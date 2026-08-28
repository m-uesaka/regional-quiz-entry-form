import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import Page from './+page.svelte';

/** Renders the login screen with the given action result, if any. */
function renderPage(
  form: {email: string; error: string} | null = null,
  passwordSet = false,
) {
  render(Page, {
    props: {params: {}, data: {loggedIn: false, passwordSet}, form},
  });
}

describe('staff login +page.svelte', () => {
  it('asks for an email address and a password', () => {
    renderPage();

    expect(screen.getByLabelText('メールアドレス')).toBeInTheDocument();
    expect(screen.getByLabelText('パスワード')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'ログイン'})).toBeInTheDocument();
  });

  it('posts to its own URL so the redirectTo parameter survives', () => {
    const {container} = render(Page, {
      props: {
        params: {},
        data: {loggedIn: false, passwordSet: false},
        form: null,
      },
    });

    const form = container.querySelector('form');
    expect(form?.getAttribute('method')).toBe('POST');
    expect(form?.hasAttribute('action')).toBe(false);
  });

  it('shows the error the action reported', () => {
    renderPage({
      email: 'staff@example.com',
      error: 'メールアドレスまたはパスワードが正しくありません',
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'メールアドレスまたはパスワードが正しくありません',
    );
  });

  it('says so when the visitor has just set their password from a link', () => {
    renderPage(null, true);

    expect(screen.getByRole('status')).toHaveTextContent(
      'パスワードを設定しました',
    );
  });

  it('keeps the submitted address but never the password', () => {
    renderPage({email: 'staff@example.com', error: 'エラー'});

    expect(screen.getByLabelText('メールアドレス')).toHaveValue(
      'staff@example.com',
    );
    expect(screen.getByLabelText('パスワード')).toHaveValue('');
  });
});
