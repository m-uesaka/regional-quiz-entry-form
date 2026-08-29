import {render, screen, within} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import type {Region, StaffAccount, StaffClaims} from '@regional-quiz/shared';
import Page from './+page.svelte';

const TOKYO: Region = {
  id: '00000000-0000-0000-0000-000000000001',
  slug: 'tokyo',
  name: '東京',
  allowsDualEntry: false,
};

const REGIONAL: StaffAccount = {
  id: '00000000-0000-0000-0000-000000000011',
  email: 'tokyo-staff@example.com',
  role: 'regional',
  regionId: TOKYO.id,
  regionSlug: TOKYO.slug,
  regionName: TOKYO.name,
  tournamentType: 'shinjinou',
  passwordSet: true,
};

const GENERAL: StaffAccount = {
  id: '00000000-0000-0000-0000-000000000012',
  email: 'admin@example.com',
  role: 'general',
  regionId: null,
  regionSlug: null,
  regionName: null,
  tournamentType: null,
  passwordSet: false,
};

// Handed down by `routes/admin/+layout.server.ts`, which every screen under
// `/admin` inherits.
const STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-0000000000ff',
  role: 'general',
  regionId: null,
  tournamentType: null,
};

function renderPage(accounts: StaffAccount[], regions: Region[] = [TOKYO]) {
  render(Page, {
    props: {params: {}, data: {staff: STAFF, accounts, regions}, form: null},
  });
}

describe('admin staff +page.svelte', () => {
  it('the account list renders the region and tournament type of a regional account', () => {
    renderPage([REGIONAL]);

    expect(screen.getByText('tokyo-staff@example.com')).toBeInTheDocument();
    expect(
      screen.getByText('地域スタッフ / 東京 / 新人王'),
    ).toBeInTheDocument();
  });

  it('says a general account covers every region', () => {
    renderPage([GENERAL]);

    expect(screen.getByText('統括スタッフ / 全地域')).toBeInTheDocument();
  });

  it('tells apart an account still waiting on its invite link', () => {
    renderPage([REGIONAL, GENERAL]);

    expect(screen.getByText('パスワード設定済み')).toBeInTheDocument();
    expect(
      screen.getByText('パスワード未設定(招待メールのリンク待ち)'),
    ).toBeInTheDocument();
  });

  it('offers a re-send button naming the account it belongs to', () => {
    renderPage([REGIONAL, GENERAL]);

    const row = screen
      .getByRole('heading', {name: GENERAL.email})
      .closest('li');
    expect(row).not.toBeNull();
    // The button posts the account's own id, so pressing the one beside a
    // row cannot mail the link to the account listed above it.
    expect(
      within(row as HTMLElement).getByRole('button', {
        name: 'パスワード設定メールを再送',
      }),
    ).toBeInTheDocument();
    expect(
      (row as HTMLElement).querySelector<HTMLInputElement>('input[name="id"]'),
    ).toHaveValue(GENERAL.id);
  });

  it('offers every region as a scope for a new regional account', () => {
    renderPage([], [TOKYO]);

    expect(
      within(screen.getByLabelText(/担当地域/)).getByRole('option', {
        name: '東京',
      }),
    ).toHaveValue(TOKYO.id);
  });

  it('tells staff when no account exists yet', () => {
    renderPage([]);

    expect(
      screen.getByText('まだスタッフアカウントが登録されていません。'),
    ).toBeInTheDocument();
  });
});
