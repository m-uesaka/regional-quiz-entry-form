import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import type {EntryListItem} from '@regional-quiz/shared';
import Page from './+page.svelte';

const ENTRIES: EntryListItem[] = [
  {displayName: '参加者A', status: 'confirmed', waitlistPosition: null},
  {displayName: '参加者B', status: 'waitlisted', waitlistPosition: 2},
];

describe('list +page.svelte', () => {
  it('shows the waitlist position for a waitlisted entry', () => {
    render(Page, {
      props: {
        params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
        data: {entries: ENTRIES},
        form: null,
      },
    });

    expect(screen.getByText(/参加者B/)).toHaveTextContent(
      '参加者B (キャンセル待ち 2)',
    );
    expect(screen.getByText('参加者A')).toBeInTheDocument();
  });
});
