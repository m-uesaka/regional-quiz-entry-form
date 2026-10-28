import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import Page from './+page.svelte';
import type {VerifyPageStatus} from './+page.server';

function renderPage(
  status: VerifyPageStatus,
  form: {error: string} | null = null,
) {
  render(Page, {props: {params: {}, data: {status}, form}});
}

describe('verify +page.svelte', () => {
  // Opening the link only gets this far: nothing is confirmed until the
  // button is pressed (#190).
  it('asks for the confirm button while a token is held', () => {
    renderPage('ready');

    expect(
      screen.getByRole('button', {name: 'エントリーを確定する'}),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ボタンを押さずにこのページを閉じて/),
    ).toBeInTheDocument();
    expect(screen.queryByText('エントリーが確定しました。')).toBeNull();
    expect(screen.queryByRole('link', {name: 'マイページへ'})).toBeNull();
  });

  it('keeps the button next to the error when confirming failed', () => {
    renderPage('ready', {error: 'エントリーの確定に失敗しました'});

    expect(screen.getByRole('alert')).toHaveTextContent(
      'エントリーの確定に失敗しました',
    );
    expect(
      screen.getByRole('button', {name: 'エントリーを確定する'}),
    ).toBeInTheDocument();
  });

  it('reports a confirmed entry', () => {
    renderPage('confirmed');

    expect(screen.getByText('エントリーが確定しました。')).toBeInTheDocument();
  });

  it('reports a waitlisted entry and points at mypage for the position', () => {
    renderPage('waitlisted');

    expect(
      screen.getByText('定員に達していたため、キャンセル待ちになりました。'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/キャンセル待ちの順位はマイページから確認できます/),
    ).toBeInTheDocument();
  });

  it('guides an invalid token towards entering again', () => {
    renderPage('invalid');

    expect(screen.getByText('この確認リンクは無効です。')).toBeInTheDocument();
    expect(
      screen.getByText(
        /もう一度エントリーすると取り消され、新しい確認メールが届きます/,
      ),
    ).toBeInTheDocument();
  });

  it('tells an invalid token to log into mypage first', () => {
    renderPage('invalid');

    expect(
      screen.getByText(/まずはマイページにログインしてエントリー状況を/),
    ).toBeInTheDocument();
  });

  it('always links to mypage', () => {
    renderPage('confirmed');

    expect(screen.getByRole('link', {name: 'マイページへ'})).toHaveAttribute(
      'href',
      '/mypage',
    );
  });

  it.each(['confirmed', 'waitlisted', 'invalid'] as const)(
    'warns that the mypage link leads through a login (%s)',
    status => {
      renderPage(status);

      expect(
        screen.getByText(
          /マイページの閲覧にはログインが必要です。ログインしていない場合はログイン画面に移動します。/,
        ),
      ).toBeInTheDocument();
    },
  );
});
