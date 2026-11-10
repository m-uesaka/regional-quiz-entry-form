import {render, screen, within} from '@testing-library/svelte';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {Region, StaffClaims} from '@regional-quiz/shared';
import type {FakeRemoteForm} from '../../../test-support/fake-remote-form';
import Page from './+page.svelte';
import {createRegion, updateRegion} from './regions.remote';

// The page's two forms are remote functions, which only a running app can
// serve; see `test-support/fake-remote-form.ts`.
vi.mock('./regions.remote', async () => {
  const {fakeRemoteForm} =
    await import('../../../test-support/fake-remote-form');
  return {
    createRegion: fakeRemoteForm('?/remote=create'),
    updateRegion: fakeRemoteForm('?/remote=update'),
  };
});

const createForm = createRegion as unknown as FakeRemoteForm;
const updateForm = updateRegion as unknown as FakeRemoteForm;

// Handed down by `routes/admin/+layout.server.ts`.
const STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-0000000000ff',
  role: 'general',
  regionId: null,
  tournamentType: null,
  sessionsValidFrom: 1756085025678,
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

function renderPage(regions: Region[]) {
  render(Page, {
    props: {params: {}, data: {staff: STAFF, regions}, form: null},
  });
}

/** The row form of one region, found by the slug it is headed with. */
function rowOf(slug: string): HTMLElement {
  const row = screen.getByRole('heading', {name: slug}).closest('li');
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

describe('admin regions +page.svelte', () => {
  beforeEach(() => {
    createForm.reset();
    updateForm.reset();
  });

  it('renders each region with its current name and dual-entry setting', () => {
    renderPage([TOKYO, OSAKA]);

    expect(within(rowOf('tokyo')).getByLabelText('地域名')).toHaveValue('東京');
    expect(within(rowOf('tokyo')).getByRole('checkbox')).not.toBeChecked();
    expect(within(rowOf('osaka')).getByRole('checkbox')).toBeChecked();
  });

  it('explains the question set rule next to the dual-entry box', () => {
    renderPage([TOKYO]);

    expect(
      within(rowOf('tokyo')).getByRole('checkbox'),
    ).toHaveAccessibleDescription(/同じ問題セットが設定されていると/);
  });

  it('carries the region id the row form saves to', () => {
    renderPage([TOKYO]);

    expect(
      rowOf('tokyo').querySelector<HTMLInputElement>('input[name="id"]'),
    ).toHaveValue(TOKYO.id);
  });

  it('gives each row a form of its own to post to', () => {
    renderPage([TOKYO, OSAKA]);

    const actionOf = (slug: string) =>
      rowOf(slug).querySelector('form')?.getAttribute('action');
    expect(actionOf('tokyo')).toBe(`?/remote=update/${TOKYO.id}`);
    expect(actionOf('osaka')).toBe(`?/remote=update/${OSAKA.id}`);
  });

  it('reports a duplicate slug on the create form only', () => {
    createForm.setState({
      issues: [{path: ['slug'], message: 'この slug は既に使われています'}],
      values: {slug: 'tokyo', name: '東京(2)'},
    });
    renderPage([TOKYO]);

    expect(screen.getByLabelText('slug')).toHaveValue('tokyo');
    expect(screen.getByLabelText('slug')).toHaveAccessibleDescription(
      'この slug は既に使われています',
    );
    // Above the form, issues that belong to controls are summed up.
    expect(screen.getByText('入力内容を確認してください')).toBeInTheDocument();
    // The row form is untouched by a create failure.
    expect(within(rowOf('tokyo')).getByLabelText('地域名')).toHaveValue('東京');
  });

  it('tells staff the region was added', () => {
    createForm.setState({result: {saved: true}});
    renderPage([TOKYO]);

    expect(screen.getByText('地域を追加しました')).toBeInTheDocument();
  });

  it('shows an update failure beside the row it came from', () => {
    updateForm.for(OSAKA.id).setState({
      issues: [{path: [], message: '地域が見つかりません'}],
      values: {name: '大阪府', allowsDualEntry: true},
    });
    renderPage([TOKYO, OSAKA]);

    expect(within(rowOf('osaka')).getByRole('alert')).toHaveTextContent(
      '地域が見つかりません',
    );
    expect(within(rowOf('osaka')).getByLabelText('地域名')).toHaveValue(
      '大阪府',
    );
    expect(within(rowOf('tokyo')).queryByRole('alert')).toBeNull();
  });

  it('shows a save on the row it was made on', () => {
    updateForm.for(OSAKA.id).setState({result: {saved: true}});
    renderPage([TOKYO, OSAKA]);

    expect(
      within(rowOf('osaka')).getByText('保存しました'),
    ).toBeInTheDocument();
    expect(within(rowOf('tokyo')).queryByText('保存しました')).toBeNull();
  });

  it('tells staff when no region exists yet', () => {
    renderPage([]);

    expect(
      screen.getByText('まだ地域が登録されていません。'),
    ).toBeInTheDocument();
  });
});
