import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import PasswordRequirements from './PasswordRequirements.svelte';

describe('PasswordRequirements', () => {
  it('describes the rules, with examples, before anything is typed', () => {
    render(PasswordRequirements, {props: {password: ''}});

    expect(screen.getByText(/8文字以上で設定してください/)).toHaveTextContent(
      '「testtest」',
    );
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  // #177: the password the request was about.
  it('says a common password will be refused, once the list has loaded', async () => {
    render(PasswordRequirements, {props: {password: 'TestTest'}});

    expect(
      await screen.findByText('よく使われているパスワードのため使えません'),
    ).toBeInTheDocument();
    expect(screen.getByText('8文字以上(現在8文字)')).toBeInTheDocument();
  });

  it('accepts a long enough password that is not a common one', async () => {
    render(PasswordRequirements, {
      props: {password: 'violet-harbor-lantern'},
    });

    expect(
      await screen.findByText('よく使われているパスワードではない'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/満たしていません/)).not.toBeInTheDocument();
  });

  it('flags a password that is too short', () => {
    render(PasswordRequirements, {props: {password: 'short'}});

    expect(screen.getByText('8文字以上(現在5文字)')).toHaveTextContent(
      '満たしていません',
    );
  });

  it('reports whether the confirmation matches once it is typed', async () => {
    const {rerender} = render(PasswordRequirements, {
      props: {password: 'violet-harbor-lantern', confirmation: ''},
    });
    expect(screen.queryByText(/確認用と一致/)).not.toBeInTheDocument();

    await rerender({password: 'violet-harbor-lantern', confirmation: 'violet'});
    expect(screen.getByText('確認用と一致していません')).toBeInTheDocument();

    await rerender({
      password: 'violet-harbor-lantern',
      confirmation: 'violet-harbor-lantern',
    });
    expect(screen.getByText('確認用と一致している')).toBeInTheDocument();
  });

  it('says on the entry form that the rules are for a new account only', async () => {
    render(PasswordRequirements, {
      props: {password: 'password', newAccountOnly: true},
    });

    expect(
      screen.getByText(/登録済みのパスワードをそのまま入力してください/),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        'よく使われているパスワードのため、新規登録では使えません',
      ),
    ).toBeInTheDocument();
  });
});
