import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import type {StaffClaims} from '@regional-quiz/shared';
import Page from './+page.svelte';

const STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-0000000000ff',
  role: 'general',
  regionId: null,
  tournamentType: null,
  sessionsValidFrom: 1756085025678,
};

const TOURNAMENT = {
  id: '00000000-0000-0000-0000-000000000001',
  regionId: '00000000-0000-0000-0000-000000000011',
  regionName: '東京',
  type: 'saikyoi' as const,
  name: '東京最強位',
  capacity: null,
  entryOpensAt: '2026-01-01T00:00:00.000Z',
  entryClosesAt: '2026-02-01T00:00:00.000Z',
};

describe('admin tournament list +page.svelte', () => {
  it('links each tournament to its edit screen', () => {
    render(Page, {
      props: {
        params: {},
        data: {staff: STAFF, tournaments: [TOURNAMENT], deleted: false},
        form: null,
      },
    });

    expect(screen.getByRole('link', {name: /編集/})).toHaveAttribute(
      'href',
      `/admin/tournaments/${TOURNAMENT.id}/edit`,
    );
    expect(screen.getByText('最強位')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('confirms a delete and says when there are no tournaments', () => {
    render(Page, {
      props: {
        params: {},
        data: {staff: STAFF, tournaments: [], deleted: true},
        form: null,
      },
    });

    expect(screen.getByRole('status')).toHaveTextContent('大会を削除しました');
    expect(screen.getByText('大会はまだありません。')).toBeInTheDocument();
  });
});
