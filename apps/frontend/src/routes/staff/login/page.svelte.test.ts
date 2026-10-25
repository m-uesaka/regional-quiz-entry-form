import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import Page from './+page.svelte';

/** Renders the login screen with the given action result, if any. */
function renderPage(
  form: {email: string; scope: string; error: string} | null = null,
  passwordSet = false,
) {
  render(Page, {
    props: {
      params: {},
      data: {loggedIn: false, isGeneralStaff: false, passwordSet},
      form,
    },
  });
}

describe('staff login +page.svelte', () => {
  it('asks for an email address, a 区分 and a password', () => {
    renderPage();

    expect(screen.getByLabelText('メールアドレス')).toBeInTheDocument();
    expect(screen.getByLabelText('パスワード')).toBeInTheDocument();
    // #166: one address may hold a 最強位 and a 新人王 account.
    const scope = screen.getByLabelText('区分');
    expect(scope).toBeRequired();
    expect(scope).toHaveValue('');
    expect(
      screen.getAllByRole('option').map(option => option.getAttribute('value')),
    ).toEqual(['', 'saikyoi', 'shinjinou', 'general']);
    expect(screen.getByRole('button', {name: 'ログイン'})).toBeInTheDocument();
  });

  // #175: a staff member who forgot their password can ask for a link.
  it('links to the password reset request form', () => {
    renderPage();

    expect(
      screen.getByRole('link', {name: 'パスワードを忘れた場合'}),
    ).toHaveAttribute('href', '/staff/password-reset');
  });

  it('posts to its own URL so the redirectTo parameter survives', () => {
    const {container} = render(Page, {
      props: {
        params: {},
        data: {loggedIn: false, isGeneralStaff: false, passwordSet: false},
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
      scope: 'saikyoi',
      error: 'メールアドレス・区分・パスワードのいずれかが正しくありません',
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'メールアドレス・区分・パスワードのいずれかが正しくありません',
    );
  });

  it('says so when the visitor has just set their password from a link', () => {
    renderPage(null, true);

    expect(screen.getByRole('status')).toHaveTextContent(
      'パスワードを設定しました',
    );
  });

  it('keeps the submitted address and 区分 but never the password', () => {
    renderPage({
      email: 'staff@example.com',
      scope: 'shinjinou',
      error: 'エラー',
    });

    expect(screen.getByLabelText('メールアドレス')).toHaveValue(
      'staff@example.com',
    );
    expect(screen.getByLabelText('区分')).toHaveValue('shinjinou');
    expect(screen.getByLabelText('パスワード')).toHaveValue('');
  });
});
