import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import {cancelOwnEntry, updateOwnEntry} from './own-entries';
import {testBindings} from '../test-support/bindings';
import {
  DB_URL,
  isDbReachable,
  SUPABASE_SECRET_KEY,
  SUPABASE_URL,
} from '../test-support/db';
import {
  createEntryRow,
  createTournamentAndRegulation,
  deleteTestRegionRows,
  type EntryRowFixture,
  type EntryRowStatus,
  type TournamentFixture,
} from '../test-support/db-fixtures';

const env = testBindings({
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
});

// Probed once for the whole file, so a run without a database pays for one
// failed connection rather than one per block.
const dbReachable = await isDbReachable();

describe.skipIf(!dbReachable)(
  'updateOwnEntry (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'entries-update-test-region';
    const testEmailDomain = 'entries-update-test.example.com';

    afterAll(async () => {
      await deleteTestRegionRows(sql, testRegionSlug, testEmailDomain);
      await sql.close();
    });

    interface EntryFixture {
      participantId: string;
      entryId: string;
    }

    /**
     * Creates a region, tournament (with one `t_shirt_size` custom field),
     * regulation, participant and entry, and returns the ids needed to
     * exercise `updateOwnEntry()` against them.
     */
    async function createEntryFixture(
      suffix: string,
      options: {
        entryOpensAt?: string;
        entryClosesAt?: string;
        status?: string;
      } = {},
    ): Promise<EntryFixture> {
      const [region] = await sql`
        insert into regions (slug, name)
        values (${testRegionSlug + '-' + suffix}, 'テスト地域')
        returning id
      `;
      const [tournament] = await sql`
        insert into tournaments (
          region_id, type, name, entry_opens_at, entry_closes_at
        ) values (
          ${region.id}, 'saikyoi', 'テスト大会',
          ${options.entryOpensAt ?? '2020-01-01T00:00:00Z'},
          ${options.entryClosesAt ?? '2099-01-01T00:00:00Z'}
        )
        returning id
      `;
      const [regulation] = await sql`
        insert into regulations (tournament_id, label)
        values (${tournament.id}, 'テストレギュレーション')
        returning id
      `;
      await sql`
        insert into form_field_defs (
          tournament_id, field_key, label, field_type, required, options,
          display_order
        ) values (
          ${tournament.id}, 't_shirt_size', 'Tシャツサイズ', 'radio', false,
          ${['S', 'M', 'L']}::jsonb, 0
        )
      `;
      const [participant] = await sql`
        insert into participants (region_id, email, password_hash)
        values (
          ${region.id},
          ${`update-${crypto.randomUUID()}@${testEmailDomain}`},
          'hash'
        )
        returning id
      `;
      const [entry] = await sql`
        insert into entries (
          participant_id, tournament_id, name, furigana, display_name,
          free_text, custom_field_values, status
        ) values (
          ${participant.id}, ${tournament.id}, '山田太郎', 'ヤマダタロウ', '太郎',
          '元の自由記述', ${{t_shirt_size: 'M'}},
          ${options.status ?? 'confirmed'}
        )
        returning id
      `;
      await sql`
        insert into entry_regulations (entry_id, regulation_id, tournament_id)
        values (${entry.id}, ${regulation.id}, ${tournament.id})
      `;
      return {
        participantId: participant.id as string,
        entryId: entry.id as string,
      };
    }

    const patch = {
      name: '山田花子',
      furigana: 'ヤマダハナコ',
      displayName: '花子',
      freeText: '更新後の自由記述',
      customFieldValues: {t_shirt_size: 'L'},
    };

    it('updates the entry within the entry period', async () => {
      const fixture = await createEntryFixture('open');

      const result = await updateOwnEntry(
        env,
        fixture.participantId,
        fixture.entryId,
        patch,
      );

      expect(result.ok).toBe(true);
      const [row] = await sql`
        select name, furigana, display_name, free_text, custom_field_values
        from entries where id = ${fixture.entryId}
      `;
      expect(row.name).toBe('山田花子');
      expect(row.furigana).toBe('ヤマダハナコ');
      expect(row.display_name).toBe('花子');
      expect(row.free_text).toBe('更新後の自由記述');
      expect(row.custom_field_values).toEqual({t_shirt_size: 'L'});
    });

    it('rejects updates outside the entry period', async () => {
      const fixture = await createEntryFixture('closed', {
        entryOpensAt: '2020-01-01T00:00:00Z',
        entryClosesAt: '2020-01-02T00:00:00Z',
      });

      const result = await updateOwnEntry(
        env,
        fixture.participantId,
        fixture.entryId,
        patch,
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(403);
      const [row] = await sql`
        select name from entries where id = ${fixture.entryId}
      `;
      expect(row.name).toBe('山田太郎');
    });

    it("rejects updating another participant's entry", async () => {
      const fixture = await createEntryFixture('owner');
      const other = await createEntryFixture('other');

      const result = await updateOwnEntry(
        env,
        other.participantId,
        fixture.entryId,
        patch,
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(404);
      const [row] = await sql`
        select name from entries where id = ${fixture.entryId}
      `;
      expect(row.name).toBe('山田太郎');
    });

    it('rejects updating a cancelled entry', async () => {
      const fixture = await createEntryFixture('cancelled', {
        status: 'cancelled',
      });

      const result = await updateOwnEntry(
        env,
        fixture.participantId,
        fixture.entryId,
        patch,
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(403);
      expect(!result.ok && result.error).toBe('entry is cancelled');
      const [row] = await sql`
        select name from entries where id = ${fixture.entryId}
      `;
      expect(row.name).toBe('山田太郎');
    });

    /**
     * Resolves once some backend is waiting on a lock `holderPid` holds, so
     * the holder commits only after the UPDATE under test has reached the
     * row. The UPDATE runs in PostgREST's own connection, whose pid isn't
     * known here.
     */
    async function waitUntilBlockedBy(holderPid: number): Promise<void> {
      const deadline = Date.now() + 5_000;
      for (;;) {
        const [row] = await sql`
          select exists (
            select 1 from pg_stat_activity
            where ${holderPid} = any(pg_blocking_pids(pid))
          ) as waiting
        `;
        if ((row as {waiting: boolean}).waiting) {
          return;
        }
        if (Date.now() > deadline) {
          throw new Error(`nothing ever waited on backend ${holderPid}`);
        }
        await Bun.sleep(10);
      }
    }

    it('leaves an entry cancelled between the check and the update alone', async () => {
      const fixture = await createEntryFixture('cancel-race');
      const canceller = await sql.reserve();
      try {
        // An uncommitted cancellation: the edit's unlocked check still reads
        // the entry as confirmed, and its UPDATE then waits on the row.
        await canceller`begin`;
        await canceller`
          update entries set status = 'cancelled', cancelled_at = now()
          where id = ${fixture.entryId}
        `;
        const [{pid}] = await canceller`select pg_backend_pid() as pid`;

        const updating = updateOwnEntry(
          env,
          fixture.participantId,
          fixture.entryId,
          patch,
        );
        await waitUntilBlockedBy(pid as number);
        await canceller`commit`;
        const result = await updating;

        expect(result.ok).toBe(false);
        expect(!result.ok && result.status).toBe(403);
        expect(!result.ok && result.error).toBe('entry is cancelled');
        const [row] = await sql`
          select status, name, custom_field_values
          from entries where id = ${fixture.entryId}
        `;
        expect(row.status).toBe('cancelled');
        expect(row.name).toBe('山田太郎');
        expect(row.custom_field_values).toEqual({t_shirt_size: 'M'});
      } finally {
        canceller.release();
      }
    });

    it('rejects custom field answers the tournament does not define', async () => {
      const fixture = await createEntryFixture('unknown-field');

      const result = await updateOwnEntry(
        env,
        fixture.participantId,
        fixture.entryId,
        {...patch, customFieldValues: {...patch.customFieldValues, junk: 'x'}},
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(400);
      const [row] = await sql`
        select name from entries where id = ${fixture.entryId}
      `;
      expect(row.name).toBe('山田太郎');
    });

    it('rejects an answer outside the field definition options', async () => {
      const fixture = await createEntryFixture('unknown-option');

      const result = await updateOwnEntry(
        env,
        fixture.participantId,
        fixture.entryId,
        {...patch, customFieldValues: {t_shirt_size: 'XXL'}},
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(400);
    });
  },
);

describe.skipIf(!dbReachable)(
  'cancelOwnEntry (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'entries-cancel-test-region';
    const testEmailDomain = 'entries-cancel-test.example.com';
    const originalFetch = globalThis.fetch;
    let mailSendCount = 0;

    beforeAll(() => {
      // The Supabase client also runs on `fetch`, so only intercept the
      // outbound Resend call and pass everything else through untouched.
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith('https://api.resend.com/')) {
          mailSendCount++;
          return new Response(null, {status: 200});
        }
        return originalFetch(input, init);
      }) as typeof fetch;
    });

    afterAll(async () => {
      globalThis.fetch = originalFetch;
      await deleteTestRegionRows(sql, testRegionSlug, testEmailDomain);
      await sql.close();
    });

    // Capacity 1, so a cancelled confirmed entry frees the one seat.
    async function createFixture(suffix: string): Promise<TournamentFixture> {
      return createTournamentAndRegulation(sql, `${testRegionSlug}-${suffix}`, {
        capacity: 1,
      });
    }

    async function addEntry(
      fixture: TournamentFixture,
      status: EntryRowStatus,
      waitlistPosition: number | null = null,
    ): Promise<EntryRowFixture> {
      return createEntryRow(sql, fixture, testEmailDomain, {
        status,
        waitlistPosition,
      });
    }

    it('cancels a confirmed entry and promotes the next waitlisted entry', async () => {
      const fixture = await createFixture('confirmed');
      const confirmed = await addEntry(fixture, 'confirmed');
      const firstWaiting = await addEntry(fixture, 'waitlisted', 1);
      const secondWaiting = await addEntry(fixture, 'waitlisted', 2);
      mailSendCount = 0;

      const result = await cancelOwnEntry(
        env,
        confirmed.participantId,
        confirmed.entryId,
      );

      expect(result.ok).toBe(true);
      const [cancelledRow] = await sql`
        select status, cancelled_at, waitlist_position
        from entries where id = ${confirmed.entryId}
      `;
      expect(cancelledRow.status).toBe('cancelled');
      expect(cancelledRow.cancelled_at).not.toBeNull();
      const [promotedRow] = await sql`
        select status from entries where id = ${firstWaiting.entryId}
      `;
      expect(promotedRow.status).toBe('confirmed');
      const [stillWaitingRow] = await sql`
        select status from entries where id = ${secondWaiting.entryId}
      `;
      expect(stillWaitingRow.status).toBe('waitlisted');
      expect(mailSendCount).toBe(1);
    });

    it('cancels a waitlisted entry without promoting anyone', async () => {
      const fixture = await createFixture('waitlisted');
      const confirmed = await addEntry(fixture, 'confirmed');
      const firstWaiting = await addEntry(fixture, 'waitlisted', 1);
      const secondWaiting = await addEntry(fixture, 'waitlisted', 2);
      mailSendCount = 0;

      const result = await cancelOwnEntry(
        env,
        firstWaiting.participantId,
        firstWaiting.entryId,
      );

      expect(result.ok).toBe(true);
      const [cancelledRow] = await sql`
        select status, waitlist_position
        from entries where id = ${firstWaiting.entryId}
      `;
      expect(cancelledRow.status).toBe('cancelled');
      expect(cancelledRow.waitlist_position).toBeNull();
      const [confirmedRow] = await sql`
        select status from entries where id = ${confirmed.entryId}
      `;
      expect(confirmedRow.status).toBe('confirmed');
      // Nobody was promoted, and the entry behind the cancelled one moved up
      // one place instead of being left with a gap in front of it.
      const [stillWaitingRow] = await sql`
        select status, waitlist_position
        from entries where id = ${secondWaiting.entryId}
      `;
      expect(stillWaitingRow.status).toBe('waitlisted');
      expect(stillWaitingRow.waitlist_position).toBe(1);
      expect(mailSendCount).toBe(0);
    });

    // A seat an earlier, failed promotion left empty: cancelling from the
    // queue retries the promotion, which fills it in order.
    it('promotes into a seat left empty when a waitlisted entry is cancelled', async () => {
      const fixture = await createFixture('waitlisted-free-seat');
      const firstWaiting = await addEntry(fixture, 'waitlisted', 1);
      const secondWaiting = await addEntry(fixture, 'waitlisted', 2);
      const thirdWaiting = await addEntry(fixture, 'waitlisted', 3);
      mailSendCount = 0;

      const result = await cancelOwnEntry(
        env,
        secondWaiting.participantId,
        secondWaiting.entryId,
      );

      expect(result.ok).toBe(true);
      const rows = await sql`
        select id, status, waitlist_position from entries
        where tournament_id = ${fixture.tournamentId}
        order by status, waitlist_position
      `;
      expect(rows).toEqual([
        {
          id: firstWaiting.entryId,
          status: 'confirmed',
          waitlist_position: null,
        },
        {id: thirdWaiting.entryId, status: 'waitlisted', waitlist_position: 1},
        {
          id: secondWaiting.entryId,
          status: 'cancelled',
          waitlist_position: null,
        },
      ]);
      expect(mailSendCount).toBe(1);
    });

    it("returns 404 for another participant's entry", async () => {
      const fixture = await createFixture('other-participant');
      const owner = await addEntry(fixture, 'confirmed');
      const intruder = await addEntry(fixture, 'waitlisted', 1);

      const result = await cancelOwnEntry(
        env,
        intruder.participantId,
        owner.entryId,
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(404);
      const [row] = await sql`
        select status from entries where id = ${owner.entryId}
      `;
      expect(row.status).toBe('confirmed');
    });

    it('burns the verification token of an entry cancelled before it was verified', async () => {
      const fixture = await createFixture('unverified');
      const unverified = await addEntry(fixture, 'pending_verification');
      await sql`
        insert into email_verification_tokens (
          entry_id, token_hash, expires_at
        ) values (
          ${unverified.entryId},
          ${`cancel-token-${crypto.randomUUID()}`},
          '2099-01-01T00:00:00Z'
        )
      `;

      const result = await cancelOwnEntry(
        env,
        unverified.participantId,
        unverified.entryId,
      );

      expect(result.ok).toBe(true);
      // The verification link mailed out before the cancellation must not
      // still be able to confirm the entry afterwards.
      const [tokenRow] = await sql`
        select used_at from email_verification_tokens
        where entry_id = ${unverified.entryId}
      `;
      expect(tokenRow.used_at).not.toBeNull();
    });

    it('leaves an already-cancelled entry alone without promoting anyone', async () => {
      const fixture = await createFixture('already-cancelled');
      const confirmed = await addEntry(fixture, 'confirmed');
      const waiting = await addEntry(fixture, 'waitlisted', 1);
      await cancelOwnEntry(env, confirmed.participantId, confirmed.entryId);
      const [promotedRow] = await sql`
        select status from entries where id = ${waiting.entryId}
      `;
      expect(promotedRow.status).toBe('confirmed');
      mailSendCount = 0;

      const result = await cancelOwnEntry(
        env,
        confirmed.participantId,
        confirmed.entryId,
      );

      expect(result.ok).toBe(true);
      const [stillConfirmedRow] = await sql`
        select status from entries where id = ${waiting.entryId}
      `;
      expect(stillConfirmedRow.status).toBe('confirmed');
      expect(mailSendCount).toBe(0);
    });
  },
);
