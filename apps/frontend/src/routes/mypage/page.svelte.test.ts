import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import type {MypageEntry} from '@regional-quiz/shared';
import Page from './+page.svelte';

const ENTRIES: MypageEntry[] = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    tournamentId: '00000000-0000-0000-0000-000000000002',
    status: 'confirmed',
    waitlistPosition: null,
    tournament: {
      name: 'テスト地域大会',
      type: 'saikyoi',
      regionId: '00000000-0000-0000-0000-000000000003',
    },
  },
  {
    id: '00000000-0000-0000-0000-000000000004',
    tournamentId: '00000000-0000-0000-0000-000000000005',
    status: 'waitlisted',
    waitlistPosition: 2,
    tournament: {
      name: 'テスト地域大会',
      type: 'shinjinou',
      regionId: '00000000-0000-0000-0000-000000000003',
    },
  },
];

describe('mypage +page.svelte', () => {
  it('shows an entry for both the saikyoi and shinjinou tournament in the region', () => {
    render(Page, {
      props: {
        params: {},
        data: {entries: ENTRIES},
        form: null,
      },
    });

    expect(screen.getByText(/最強位/)).toBeInTheDocument();
    expect(screen.getByText(/新人王/)).toBeInTheDocument();
  });

  it('links each entry to its own edit page', () => {
    render(Page, {
      props: {
        params: {},
        data: {entries: ENTRIES},
        form: null,
      },
    });

    expect(screen.getAllByRole('link', {name: '編集する'})[0]).toHaveAttribute(
      'href',
      `/mypage/${ENTRIES[0].tournamentId}/edit`,
    );
  });
});
