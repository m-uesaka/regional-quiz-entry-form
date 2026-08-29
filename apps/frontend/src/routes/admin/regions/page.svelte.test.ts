import {render, screen, within} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import type {Region, StaffClaims} from '@regional-quiz/shared';
import Page from './+page.svelte';
import type {PageProps} from './$types';

// Handed down by `routes/admin/+layout.server.ts`.
const STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-0000000000ff',
  role: 'general',
  regionId: null,
  tournamentType: null,
};

const TOKYO: Region = {
  id: '00000000-0000-0000-0000-000000000001',
  slug: 'tokyo',
  name: '東京',
  allowsDualEntry: false,
};

const OSAKA: Region = {
  id: '00000000-0000-0000-0000-000000000002',
  slug: 'osaka',
  name: '大阪',
  allowsDualEntry: true,
};

function renderPage(regions: Region[], form: PageProps['form'] = null) {
  render(Page, {
    props: {params: {}, data: {staff: STAFF, regions}, form},
  });
}

/** The row form of one region, found by the slug it is headed with. */
function rowOf(slug: string): HTMLElement {
  const row = screen.getByRole('heading', {name: slug}).closest('li');
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

describe('admin regions +page.svelte', () => {
  it('renders each region with its current name and dual-entry setting', () => {
    renderPage([TOKYO, OSAKA]);

    expect(within(rowOf('tokyo')).getByLabelText('地域名')).toHaveValue('東京');
    expect(within(rowOf('tokyo')).getByRole('checkbox')).not.toBeChecked();
    expect(within(rowOf('osaka')).getByRole('checkbox')).toBeChecked();
  });

  it('carries the region id the row form saves to', () => {
    renderPage([TOKYO]);

    expect(
      rowOf('tokyo').querySelector<HTMLInputElement>('input[name="id"]'),
    ).toHaveValue(TOKYO.id);
  });

  it('reports a duplicate slug on the create form only', () => {
    renderPage([TOKYO], {
      intent: 'create',
      regionId: null,
      saved: false,
      error: '入力内容を確認してください',
      fieldErrors: {slug: ['この slug は既に使われています']},
      values: {slug: 'tokyo', name: '東京(2)', allowsDualEntry: false},
    });

    expect(
      screen.getByText('この slug は既に使われています'),
    ).toBeInTheDocument();
    // The row form is untouched by a create failure.
    expect(within(rowOf('tokyo')).getByLabelText('地域名')).toHaveValue('東京');
  });

  it('shows an update failure beside the row it came from', () => {
    renderPage([TOKYO, OSAKA], {
      intent: 'update',
      regionId: OSAKA.id,
      saved: false,
      error: '地域が見つかりません',
      fieldErrors: {},
      values: {slug: '', name: '大阪府', allowsDualEntry: true},
    });

    expect(within(rowOf('osaka')).getByRole('alert')).toHaveTextContent(
      '地域が見つかりません',
    );
    expect(within(rowOf('osaka')).getByLabelText('地域名')).toHaveValue(
      '大阪府',
    );
    expect(within(rowOf('tokyo')).queryByRole('alert')).toBeNull();
  });

  it('tells staff when no region exists yet', () => {
    renderPage([]);

    expect(
      screen.getByText('まだ地域が登録されていません。'),
    ).toBeInTheDocument();
  });
});
