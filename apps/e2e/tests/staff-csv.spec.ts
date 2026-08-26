// 地域スタッフのログイン → 参加者一覧確認 → CSV ダウンロード

import {expect, test} from '@playwright/test';
import {
  enterAndVerify,
  loginStaff,
  newApiContext,
  submitEntry,
} from '../support/api';
import {SAIKYOI, SHINJINOU, SHINJINOU_STAFF} from '../support/fixtures';

// Excel on Windows reads a BOM-less file as the system's legacy encoding,
// so the export leads with one; every other assertion here is made against
// the text after it.
const UTF8_BOM = '﻿';

/**
 * Splits CSV text into rows of fields.
 *
 * Deliberately naive — it does not understand quoted fields containing
 * commas or newlines — so that the assertions below read the export the
 * way a spreadsheet would, without re-implementing the writer under test.
 * @param csv The CSV body, BOM already stripped.
 */
function parseSimpleCsv(csv: string): string[][] {
  return csv
    .split('\r\n')
    .filter(line => line.length > 0)
    .map(line => line.split(',').map(field => field.replace(/^"|"$/g, '')));
}

test('staff sign in, read their tournament roster, and export it as CSV', async ({
  request,
  playwright,
}) => {
  const confirmed = await enterAndVerify(request, SHINJINOU, {
    name: '出力花子',
    furigana: 'しゅつりょくはなこ',
    displayName: 'はなこ',
    customFieldValues: {shirt_size: 'L', note: '会場まで徒歩'},
  });
  expect(confirmed.status).toBe('confirmed');

  // Left unverified on purpose, so the export has to carry a
  // `pending_verification` row too.
  const pending = await submitEntry(request, SHINJINOU, {
    name: '未確認次郎',
    furigana: 'みかくにんじろう',
    displayName: 'じろう',
    customFieldValues: {shirt_size: 'S'},
  });

  // The roster carries participants' real names and addresses, so it must
  // be closed to anyone without a staff session.
  const anonymousList = await request.get(
    `/api/staff/tournaments/${SHINJINOU.id}/entries`,
  );
  expect(anonymousList.status()).toBe(401);
  const anonymousCsv = await request.get(
    `/api/staff/tournaments/${SHINJINOU.id}/entries.csv`,
  );
  expect(anonymousCsv.status()).toBe(401);

  const staffContext = await newApiContext(playwright);
  try {
    await loginStaff(staffContext, SHINJINOU_STAFF);

    const roster = await staffContext.get(
      `/api/staff/tournaments/${SHINJINOU.id}/entries`,
    );
    expect(roster.status(), await roster.text()).toBe(200);
    const entries = (await roster.json()) as Array<{
      id: string;
      name: string;
      email: string;
      status: string;
    }>;
    expect(entries).toContainEqual(
      expect.objectContaining({
        id: confirmed.entryId,
        name: confirmed.name,
        email: confirmed.email,
        status: 'confirmed',
      }),
    );
    expect(entries).toContainEqual(
      expect.objectContaining({
        id: pending.entryId,
        name: pending.name,
        email: pending.email,
        status: 'pending_verification',
      }),
    );

    // This account is scoped to 東京 × 新人王, so the neighbouring
    // tournament stays out of reach even though it is in the same region.
    const outOfScope = await staffContext.get(
      `/api/staff/tournaments/${SAIKYOI.id}/entries`,
    );
    expect(outOfScope.status()).toBe(403);

    const download = await staffContext.get(
      `/api/staff/tournaments/${SHINJINOU.id}/entries.csv`,
    );
    expect(download.status(), await download.text()).toBe(200);
    expect(download.headers()['content-type']).toContain('text/csv');
    expect(download.headers()['content-disposition']).toBe(
      `attachment; filename="entries-${SHINJINOU.id}.csv"`,
    );

    const body = await download.text();
    expect(body.startsWith(UTF8_BOM)).toBe(true);
    const rows = parseSimpleCsv(body.slice(UTF8_BOM.length));

    // The tournament's custom fields become the trailing columns, headed
    // by their labels in `display_order`.
    expect(rows[0]).toEqual([
      '氏名',
      'ふりがな',
      '掲載名',
      'ステータス',
      'Tシャツサイズ',
      '備考',
    ]);

    expect(rows).toContainEqual([
      confirmed.name,
      'しゅつりょくはなこ',
      confirmed.displayName,
      '確定',
      'L',
      '会場まで徒歩',
    ]);
    // The unanswered `note` field still gets its (empty) column, so every
    // row lines up with the header.
    expect(rows).toContainEqual([
      pending.name,
      'みかくにんじろう',
      pending.displayName,
      'メール確認待ち',
      'S',
      '',
    ]);
  } finally {
    await staffContext.dispose();
  }
});
