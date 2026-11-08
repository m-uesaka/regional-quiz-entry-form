import {render, screen} from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import NewPasswordFields from './NewPasswordFields.svelte';

const LABELS = {
  passwordLabel: '新しいパスワード',
  confirmationLabel: '新しいパスワード(確認用)',
};

describe('NewPasswordFields', () => {
  // The actions read the two controls by these names.
  it('renders both controls under the names the actions read', () => {
    render(NewPasswordFields, {props: LABELS});

    const password = screen.getByLabelText('新しいパスワード');
    const confirmation = screen.getByLabelText('新しいパスワード(確認用)');
    expect(password).toHaveAttribute('name', 'newPassword');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'new-password');
    expect(password).toBeRequired();
    expect(confirmation).toHaveAttribute('name', 'newPasswordConfirm');
    expect(confirmation).toHaveAttribute('type', 'password');
    expect(confirmation).toBeRequired();
  });

  it('points the password control at the requirements', () => {
    render(NewPasswordFields, {props: LABELS});

    const password = screen.getByLabelText('新しいパスワード');
    expect(password).toHaveAttribute(
      'aria-describedby',
      'password-requirements',
    );
    expect(document.getElementById('password-requirements')).toHaveTextContent(
      /8文字以上で設定してください/,
    );
  });

  it('checks what is typed into both controls', async () => {
    const user = userEvent.setup();
    render(NewPasswordFields, {props: LABELS});

    await user.type(
      screen.getByLabelText('新しいパスワード'),
      'violet-harbor-lantern',
    );
    await user.type(screen.getByLabelText('新しいパスワード(確認用)'), 'viox');
    expect(screen.getByText('確認用と一致していません')).toBeInTheDocument();
  });
});
