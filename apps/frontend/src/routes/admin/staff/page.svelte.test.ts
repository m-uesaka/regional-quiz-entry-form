import type {ComponentProps} from 'svelte';
import {fireEvent, render, screen, within} from '@testing-library/svelte';
import {afterEach, describe, expect, it, vi} from 'vitest';
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
  disabledAt: null,
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
  disabledAt: null,
};

// Handed down by `routes/admin/+layout.server.ts`, which every screen under
// `/admin` inherits.
const STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-0000000000ff',
  role: 'general',
  regionId: null,
  tournamentType: null,
  sessionsValidFrom: 1756085025678,
};

type PageForm = ComponentProps<typeof Page>['form'];

function renderPage(
  accounts: StaffAccount[],
  regions: Region[] = [TOKYO],
  form: PageForm = null,
) {
  render(Page, {
    props: {params: {}, data: {staff: STAFF, accounts, regions}, form},
  });
}

/** What the revoke action hands back for `accountId`. */
function revokeResult(
  accountId: string,
  outcome: {saved: true} | {saved: false; error: string},
): PageForm {
  return {
    intent: 'revoke',
    accountId,
    saved: outcome.saved,
    error: outcome.saved ? null : outcome.error,
    fieldErrors: {},
    values: {email: '', role: 'regional', regionId: '', tournamentType: ''},
  } as PageForm;
}

/** The `<li>` of the account listed under `email`. */
function rowOf(email: string): HTMLElement {
  const row = screen.getByRole('heading', {name: email}).closest('li');
  expect(row).not.toBeNull();
  return row as HTMLElement;
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

  it('offers to revoke the sessions of each account, posting its own id', () => {
    renderPage([REGIONAL, GENERAL]);

    const row = rowOf(REGIONAL.email);
    const button = within(row).getByRole('button', {
      name: 'セッションを無効化',
    });
    const form = button.closest('form');
    expect(form).toHaveAttribute('action', '?/revoke');
    expect(
      (form as HTMLFormElement).querySelector<HTMLInputElement>(
        'input[name="id"]',
      ),
    ).toHaveValue(REGIONAL.id);
  });

  it('confirms a revocation beside the account it was for', () => {
    renderPage(
      [REGIONAL, GENERAL],
      [TOKYO],
      revokeResult(REGIONAL.id, {saved: true}),
    );

    expect(within(rowOf(REGIONAL.email)).getByRole('status')).toHaveTextContent(
      'このアカウントのログイン中のセッションをすべて無効化しました',
    );
    expect(within(rowOf(GENERAL.email)).queryByRole('status')).toBeNull();
  });

  it('reports a failed revocation beside the account it was for', () => {
    renderPage(
      [REGIONAL, GENERAL],
      [TOKYO],
      revokeResult(GENERAL.id, {
        saved: false,
        error: 'セッションを無効化できませんでした',
      }),
    );

    expect(within(rowOf(GENERAL.email)).getByRole('alert')).toHaveTextContent(
      'セッションを無効化できませんでした',
    );
    expect(within(rowOf(REGIONAL.email)).queryByRole('alert')).toBeNull();
  });

  it("warns that revoking one's own sessions logs this screen out too", () => {
    const self: StaffAccount = {...GENERAL, id: STAFF.sub};
    renderPage([self, REGIONAL]);

    expect(
      within(rowOf(self.email)).getByText(
        'セッションを無効化すると、この画面を含むすべての端末からログアウトします。',
      ),
    ).toBeInTheDocument();
    expect(
      within(rowOf(REGIONAL.email)).queryByText(/この画面を含む/),
    ).toBeNull();
  });
  // #156
  it("offers to disable every account but the caller's own", () => {
    const self: StaffAccount = {...GENERAL, id: STAFF.sub};
    renderPage([self, REGIONAL]);

    const form = within(rowOf(REGIONAL.email))
      .getByRole('button', {name: 'アカウントを無効化'})
      .closest('form');
    expect(form).toHaveAttribute('action', '?/disable');
    expect(
      (form as HTMLFormElement).querySelector<HTMLInputElement>(
        'input[name="id"]',
      ),
    ).toHaveValue(REGIONAL.id);
    expect(
      within(rowOf(self.email)).queryByRole('button', {
        name: 'アカウントを無効化',
      }),
    ).toBeNull();
  });

  it('marks a disabled account and offers only to enable it', () => {
    const disabled: StaffAccount = {
      ...REGIONAL,
      disabledAt: '2026-10-25T00:00:00.000+00:00',
    };
    renderPage([disabled]);

    const row = rowOf(disabled.email);
    expect(within(row).getByText('無効化済み')).toBeInTheDocument();
    const form = within(row)
      .getByRole('button', {name: '有効化'})
      .closest('form');
    expect(form).toHaveAttribute('action', '?/enable');
    for (const name of [
      'パスワード設定メールを再送',
      'セッションを無効化',
      'アカウントを無効化',
    ]) {
      expect(within(row).queryByRole('button', {name})).toBeNull();
    }
  });

  describe('confirming a disable', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('names the account and does not submit when cancelled', async () => {
      const confirm = vi.fn(() => false);
      vi.stubGlobal('confirm', confirm);
      renderPage([REGIONAL, GENERAL]);

      const form = within(rowOf(REGIONAL.email))
        .getByRole('button', {name: 'アカウントを無効化'})
        .closest('form') as HTMLFormElement;

      expect(await fireEvent.submit(form)).toBe(false);
      expect(confirm).toHaveBeenCalledWith(
        expect.stringContaining(REGIONAL.email),
      );
    });
  });

  describe('confirming a revocation', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    /** Submits the revoke form of `email`'s row; whether it went through. */
    async function submitRevoke(email: string): Promise<boolean> {
      const form = within(rowOf(email))
        .getByRole('button', {name: 'セッションを無効化'})
        .closest('form') as HTMLFormElement;
      // `fireEvent` answers whether the event was left un-cancelled.
      return fireEvent.submit(form);
    }

    it('names the account and submits once confirmed', async () => {
      const confirm = vi.fn(() => true);
      vi.stubGlobal('confirm', confirm);
      renderPage([REGIONAL, GENERAL]);

      expect(await submitRevoke(REGIONAL.email)).toBe(true);
      expect(confirm).toHaveBeenCalledWith(
        expect.stringContaining(REGIONAL.email),
      );
    });

    it('does not submit when cancelled', async () => {
      vi.stubGlobal(
        'confirm',
        vi.fn(() => false),
      );
      renderPage([REGIONAL, GENERAL]);

      expect(await submitRevoke(REGIONAL.email)).toBe(false);
    });

    it("warns on the caller's own row that this screen logs out too", async () => {
      const confirm = vi.fn(() => false);
      vi.stubGlobal('confirm', confirm);
      const self: StaffAccount = {...GENERAL, id: STAFF.sub};
      renderPage([self, REGIONAL]);

      await submitRevoke(self.email);

      expect(confirm).toHaveBeenCalledWith(
        expect.stringContaining('この画面を含むすべての端末からログアウト'),
      );
    });
  });
});
