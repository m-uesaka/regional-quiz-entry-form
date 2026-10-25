import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import PasswordRequirements from './PasswordRequirements.svelte';

describe('PasswordRequirements', () => {
  it('describes the rules, with examples, before anything is typed', () => {
    render(PasswordRequirements, {props: {password: ''}});

    expect(screen.getByText(/8文字以上で設定してください/)).toHaveTextContent(
      '「testtest」',
    );
    expect(screen.queryAllByRole('listitem')).toEqual([]);
  });

  // Most screen readers skip a live region that arrives already filled, so
  // it must be there before the first character is typed.
  it('keeps the live region in the page while the field is empty', () => {
    render(PasswordRequirements, {props: {password: ''}});

    expect(screen.getByRole('list')).toHaveAttribute('aria-live', 'polite');
  });

  // #177: the password the request was about.
  it('says a common password will be refused, once the list has loaded', async () => {
    render(PasswordRequirements, {props: {password: 'TestTest'}});

    expect(
      await screen.findByText('よく使われているパスワードのため使えません'),
    ).toBeInTheDocument();
    expect(screen.getByText('8文字以上')).toBeInTheDocument();
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

  it('flags a password that is too short, without a running count', () => {
    render(PasswordRequirements, {props: {password: 'short'}});

    const rule = screen.getByText('8文字以上').closest('li');
    expect(rule).toHaveTextContent('満たしていません');
    expect(rule).not.toHaveTextContent(/現在/);
  });

  it('only reports a mismatch once the confirmation stops being a prefix', async () => {
    const {rerender} = render(PasswordRequirements, {
      props: {password: 'violet-harbor-lantern', confirmation: ''},
    });
    expect(screen.queryByText(/確認用と一致/)).not.toBeInTheDocument();

    // Still on its way to matching.
    await rerender({password: 'violet-harbor-lantern', confirmation: 'viol'});
    expect(screen.queryByText(/確認用と一致/)).not.toBeInTheDocument();

    await rerender({password: 'violet-harbor-lantern', confirmation: 'viox'});
    expect(screen.getByText('確認用と一致していません')).toBeInTheDocument();

    await rerender({
      password: 'violet-harbor-lantern',
      confirmation: 'violet-harbor-lantern',
    });
    expect(screen.getByText('確認用と一致している')).toBeInTheDocument();
  });

  // A registered participant may still use a common password they chose
  // before the rule existed, so on the entry form it is a caution.
  it('cautions rather than fails on the entry form', async () => {
    render(PasswordRequirements, {
      props: {password: 'password', newAccountOnly: true},
    });

    expect(
      screen.getByText(/登録済みのパスワードをそのまま入力してください/),
    ).toBeInTheDocument();
    const rule = (await screen.findByText(/新規登録では使えません/)).closest(
      'li',
    );
    expect(rule).toHaveTextContent('注意:');
    expect(rule).not.toHaveTextContent('満たしていません');
    expect(rule).toHaveClass('text-warning');
  });
});
