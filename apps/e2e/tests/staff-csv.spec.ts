// スタッフログイン → 参加者一覧確認 → CSV ダウンロード

import {readFile} from 'node:fs/promises';
import {expect, test, type Download} from '@playwright/test';
import {enterAndVerify, submitEntry} from '../support/api';
import {BACKEND_URL} from '../support/env';
import {SAIKYOI, SHINJINOU, SHINJINOU_STAFF} from '../support/fixtures';
import {loginStaffThroughForm, staffEntriesPath} from '../support/ui';

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

/**
 * Reads what the browser saved.
 * @param download The download event the click produced.
 */
async function readDownload(download: Download): Promise<string> {
  return readFile(await download.path(), 'utf8');
}

test('staff sign in, read their tournament roster, and export it as CSV', async ({
  page,
  request,
}) => {
  // Arranged through the API rather than through the entry form: this spec
  // is about the staff screens, and `entry-flow.spec.ts` already drives the
  // participant side of it end to end.
  const confirmed = await enterAndVerify(request, SHINJINOU, {
    name: '出力花子',
    furigana: 'しゅつりょくはなこ',
    displayName: 'はなこ',
    customFieldValues: {
      shirt_size: 'L',
      note: '会場まで徒歩',
      workshops: ['早押し', 'ボードクイズ'],
    },
  });
  expect(confirmed.status).toBe('confirmed');

  // Left unverified on purpose, so the roster and the export have to carry
  // a `pending_verification` row too.
  const pending = await submitEntry(request, SHINJINOU, {
    name: '未確認次郎',
    furigana: 'みかくにんじろう',
    displayName: 'じろう',
    customFieldValues: {shirt_size: 'S', workshops: ['筆記']},
  });

  // The roster carries participants' real names and addresses, so both
  // endpoints behind it are closed to a caller without a staff session.
  //
  // Asked directly rather than through the page, because the route's `load`
  // redirects on `!locals.staff` before it ever calls the API: driving this
  // through the browser alone would leave the backend's own guard
  // unexercised, and a roster that lost it would still look fine from here.
  for (const path of [
    `/api/staff/tournaments/${SHINJINOU.id}/entries`,
    `/api/staff/tournaments/${SHINJINOU.id}/entries.csv`,
  ]) {
    const anonymous = await request.get(`${BACKEND_URL}${path}`);
    expect(anonymous.status(), `${path}: ${await anonymous.text()}`).toBe(401);
  }

  // The screen itself sends such a visitor to the login form, carrying where
  // they were headed so the login can hand it back.
  await page.goto(staffEntriesPath(SHINJINOU));
  await expect(page).toHaveURL(
    `/staff/login?redirectTo=${encodeURIComponent(staffEntriesPath(SHINJINOU))}`,
  );

  await loginStaffThroughForm(page, SHINJINOU_STAFF);
  await expect(page).toHaveURL(staffEntriesPath(SHINJINOU));
  await expect(
    page.getByRole('heading', {name: `${SHINJINOU.name} エントリー一覧`}),
  ).toBeVisible();

  const confirmedRow = page.getByRole('row').filter({hasText: confirmed.email});
  await expect(confirmedRow.getByRole('cell')).toHaveText([
    confirmed.name,
    'しゅつりょくはなこ',
    confirmed.displayName,
    confirmed.email,
    '確定',
    '詳細',
  ]);

  const pendingRow = page.getByRole('row').filter({hasText: pending.email});
  await expect(pendingRow.getByRole('cell')).toHaveText([
    pending.name,
    'みかくにんじろう',
    pending.displayName,
    pending.email,
    'メール確認待ち',
    '詳細',
  ]);

  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', {name: 'CSV をダウンロード'}).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe(`entries-${SHINJINOU.id}.csv`);

  const body = await readDownload(download);
  expect(body.startsWith(UTF8_BOM)).toBe(true);
  const rows = parseSimpleCsv(body.slice(UTF8_BOM.length));

  // The tournament's custom fields become the trailing columns, headed by
  // their labels in `display_order`.
  expect(rows[0]).toEqual([
    '氏名',
    'ふりがな',
    '掲載名',
    'ステータス',
    'Tシャツサイズ',
    '備考',
    '参加したい企画',
  ]);

  expect(rows).toContainEqual([
    confirmed.name,
    'しゅつりょくはなこ',
    confirmed.displayName,
    '確定',
    'L',
    '会場まで徒歩',
    // A checkbox group's selections share one cell, joined by `;`.
    '早押し;ボードクイズ',
  ]);
  // The unanswered `note` field still gets its (empty) column, so every row
  // lines up with the header.
  expect(rows).toContainEqual([
    pending.name,
    'みかくにんじろう',
    pending.displayName,
    'メール確認待ち',
    'S',
    '',
    '筆記',
  ]);

  // This account is scoped to 東京 × 新人王, so the neighbouring tournament
  // stays out of reach even though it is in the same region — and the page
  // says so rather than bouncing back to the login form.
  await page.goto(staffEntriesPath(SAIKYOI));
  await expect(
    page.getByText('この大会のエントリーを閲覧する権限がありません'),
  ).toBeVisible();
});
