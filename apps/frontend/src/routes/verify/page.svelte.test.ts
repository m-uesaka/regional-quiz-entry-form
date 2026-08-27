import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import Page from './+page.svelte';
import type {VerifyStatus} from './+page.server';

function renderPage(status: VerifyStatus) {
  render(Page, {props: {params: {}, data: {status}, form: null}});
}

describe('verify +page.svelte', () => {
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
      screen.getByText(/あらためてエントリーしてください/),
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
