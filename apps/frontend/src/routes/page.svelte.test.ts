import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import Page from './+page.svelte';

describe('top +page.svelte', () => {
  it('leads participants to the entry portal and to their mypage', () => {
    render(Page);

    expect(
      screen.getByRole('link', {name: 'エントリーポータル'}),
    ).toHaveAttribute('href', '/portal');
    expect(screen.getByRole('link', {name: 'マイページ'})).toHaveAttribute(
      'href',
      '/mypage',
    );
  });

  it('leads staff to their login screen', () => {
    render(Page);

    expect(
      screen.getByRole('link', {name: 'スタッフログイン'}),
    ).toHaveAttribute('href', '/staff/login');
  });
});
