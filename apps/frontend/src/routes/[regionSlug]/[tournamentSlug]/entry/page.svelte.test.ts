import {render, screen} from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import type {FormFieldDef, Regulation, Tournament} from '@regional-quiz/shared';
import type {PriorityEntryNotice} from '$lib/priority-entry';
import Page from './+page.svelte';

const TOURNAMENT: Tournament = {
  id: '00000000-0000-0000-0000-000000000001',
  regionId: '00000000-0000-0000-0000-000000000002',
  type: 'saikyoi',
  name: 'テスト大会',
  capacity: null,
  entryOpensAt: '2020-01-01T00:00:00.000Z',
  entryClosesAt: '2099-01-01T00:00:00.000Z',
  entriesPaused: false,
};

/** A second tournament, reached by a link that only changes the slug. */
const OTHER_TOURNAMENT_ID = '00000000-0000-0000-0000-0000000000ff';

const REGULATIONS: Regulation[] = [
  {
    id: '00000000-0000-0000-0000-0000000000a1',
    tournamentId: TOURNAMENT.id,
    label: '一般の部',
    priorityStartsAt: null,
    priorityEndsAt: null,
    displayOrder: 0,
  },
  {
    id: '00000000-0000-0000-0000-0000000000a2',
    tournamentId: TOURNAMENT.id,
    label: '学生の部',
    priorityStartsAt: null,
    priorityEndsAt: null,
    displayOrder: 1,
  },
];

const FORM_FIELD_DEFS: FormFieldDef[] = [
  {
    fieldKey: 't_shirt_size',
    label: 'Tシャツサイズ',
    plainLabel: 'Tシャツサイズ',
    fieldType: 'radio',
    required: true,
    options: ['S', 'M', 'L'],
    displayOrder: 0,
  },
  {
    fieldKey: 'agree_rules',
    label: '規約に同意する',
    plainLabel: '規約に同意する',
    fieldType: 'checkbox',
    required: true,
    options: null,
    displayOrder: 1,
  },
];

type ActionResult = Parameters<typeof Page>[1]['form'];

const LOGIN_PATH = '/mypage/login?redirectTo=%2Ftokyo%2Fsaikyoi%2Fentry';

function renderPage(
  form: ActionResult = null,
  options: {
    loggedIn?: boolean;
    priorityNotices?: PriorityEntryNotice[];
    waitlistOpen?: boolean;
    staffPreview?: boolean;
    staffPreviewReason?: 'paused' | 'closed' | null;
  } = {},
) {
  return render(Page, {
    props: {
      params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
      data: {
        tournament: TOURNAMENT,
        now: new Date(),
        regulations: REGULATIONS,
        formFieldDefs: FORM_FIELD_DEFS,
        staffPreview: options.staffPreview ?? false,
        staffPreviewReason:
          options.staffPreviewReason ??
          (options.staffPreview ? 'closed' : null),
        priorityNotices: options.priorityNotices ?? [],
        waitlistOpen: options.waitlistOpen ?? false,
        loggedIn: options.loggedIn ?? false,
        loginPath: LOGIN_PATH,
      },
      form,
    },
  });
}

const SUBMITTED_VALUES = {
  name: '山田太郎',
  furigana: 'ヤマダタロウ',
  displayName: '太郎',
  email: 'taro@example.com',
  regulationIds: [REGULATIONS[1].id],
  freeText: 'よろしくお願いします',
  customFieldValues: {t_shirt_size: 'M', agree_rules: ['agree_rules']},
};

describe('entry +page.svelte', () => {
  it('opens with the 優先エントリー and the waitlist when there are any', () => {
    renderPage(null, {
      priorityNotices: [
        {
          labels: ['一般の部'],
          startsAtLabel: '2026年11月1日(日) 9:00',
          endsAtLabel: '2026年11月5日(木) 9:00',
        },
      ],
      waitlistOpen: true,
    });

    expect(
      screen.getByText(
        '現在優先エントリー実施中です。該当レギュレーション: 「一般の部」、2026年11月1日(日) 9:00〜2026年11月5日(木) 9:00まで',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/キャンセル待ちが発生しています/),
    ).toBeInTheDocument();
  });

  it('says nothing of either when there is neither', () => {
    renderPage();

    expect(screen.queryByText(/優先エントリー実施中/)).not.toBeInTheDocument();
    expect(screen.queryByText(/キャンセル待ち/)).not.toBeInTheDocument();
  });

  it('tells staff previewing a form outside its period that it cannot be sent', () => {
    renderPage(null, {staffPreview: true});

    expect(
      screen.getByText(
        /エントリー期間外のため、スタッフ向けに確認用として表示しています/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('氏名')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'エントリーする'})).toBeDisabled();
  });

  it('tells staff previewing a paused form why it cannot be sent', () => {
    renderPage(null, {staffPreview: true, staffPreviewReason: 'paused'});

    expect(
      screen.getByText(
        /エントリー受付を一時中断しているため、スタッフ向けに確認用として表示しています/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'エントリーする'})).toBeDisabled();
  });

  it('says nothing of a preview while the form is open', () => {
    renderPage();

    expect(screen.queryByText(/スタッフ向けに確認用/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'エントリーする'})).toBeEnabled();
  });

  it('renders the entry form fields', () => {
    renderPage();

    expect(screen.getByLabelText('氏名')).toBeInTheDocument();
    expect(screen.getByLabelText('ふりがな')).toBeInTheDocument();
    expect(screen.getByLabelText('エントリーリスト掲載名')).toBeInTheDocument();
    expect(screen.getByLabelText('メールアドレス')).toBeInTheDocument();
    expect(screen.getByLabelText('パスワード')).toBeInTheDocument();
    expect(screen.getByLabelText('パスワード(確認)')).toBeInTheDocument();
    expect(screen.getByLabelText('自由記述')).toBeInTheDocument();
  });

  it('renders the regulation choices and the custom form fields', () => {
    renderPage();

    expect(
      screen.getByRole('checkbox', {name: /一般の部/}),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', {name: /学生の部/}),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', {name: 'M'})).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', {name: /規約に同意する/}),
    ).toBeInTheDocument();
  });

  it('re-renders what was typed after a rejected submission', () => {
    renderPage({
      error: 'この大会には既にエントリー済みです',
      fieldErrors: {},
      values: SUBMITTED_VALUES,
      loginPath: null,
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'この大会には既にエントリー済みです',
    );
    expect(screen.getByLabelText('氏名')).toHaveValue('山田太郎');
    expect(screen.getByLabelText('メールアドレス')).toHaveValue(
      'taro@example.com',
    );
    expect(screen.getByLabelText('自由記述')).toHaveValue(
      'よろしくお願いします',
    );
    expect(screen.getByRole('checkbox', {name: /学生の部/})).toBeChecked();
    expect(screen.getByRole('radio', {name: 'M'})).toBeChecked();
    expect(
      screen.getByRole('checkbox', {name: /規約に同意する/}),
    ).toBeChecked();
  });

  it('leaves the password fields blank after a rejected submission', () => {
    renderPage({
      error: '入力内容を確認してください',
      fieldErrors: {},
      values: SUBMITTED_VALUES,
      loginPath: null,
    });

    expect(screen.getByLabelText('パスワード')).toHaveValue('');
    expect(screen.getByLabelText('パスワード(確認)')).toHaveValue('');
  });

  it('shows a per-field message for a mismatched password confirmation', () => {
    renderPage({
      error: '入力内容を確認してください',
      fieldErrors: {passwordConfirm: ['パスワードが一致しません']},
      values: SUBMITTED_VALUES,
      loginPath: null,
    });

    expect(screen.getByText('パスワードが一致しません')).toBeInTheDocument();
  });

  it("shows a custom field's message under its own control", () => {
    // Filed under the namespaced control name, which is also what the
    // page looks the message up by — so a custom field keyed `name` can't
    // land under the real 氏名 field.
    renderPage({
      error: '入力内容を確認してください',
      fieldErrors: {'custom.agree_rules': ['「規約に同意する」は必須です']},
      values: SUBMITTED_VALUES,
      loginPath: null,
    });

    expect(
      screen.getByText('「規約に同意する」は必須です'),
    ).toBeInTheDocument();
  });

  it('replaces the form with a confirmation once the entry is accepted', () => {
    renderPage({submitted: true, email: 'taro@example.com'});

    expect(screen.getByRole('heading', {level: 2})).toHaveAccessibleDescription(
      /taro@example\.com/,
    );
    expect(screen.queryByLabelText('氏名')).not.toBeInTheDocument();
  });

  // An anonymous submission is answered the same whatever the address
  // (#117), so the page must not claim the entry was taken: the mail may be
  // the reason there is no entry.
  it('only says a mail was sent after an anonymous submission', () => {
    renderPage({submitted: true, email: 'taro@example.com'});

    const heading = screen.getByRole('heading', {level: 2});
    expect(heading).toHaveAccessibleDescription(
      /taro@example\.com 宛にメールを送信しました/,
    );
    expect(heading).not.toHaveAccessibleDescription(/受け付けました/);
  });

  // The mail may be the reason there is no entry, with no link in it, so the
  // page must not send the reader looking for one or tell them to re-enter
  // once it lapses -- a refusal re-entered is only refused again.
  it('does not promise an anonymous submitter a confirmation link', () => {
    renderPage({submitted: true, email: 'taro@example.com'});

    expect(
      screen.queryByText(/「エントリーを確定する」のリンクを開く/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/「エントリーが確定しました」と表示されれば完了/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/リンクの有効期限が切れた場合/),
    ).not.toBeInTheDocument();
  });

  // Which form was submitted decides the wording, not whether an address
  // came back: an anonymous result without one must still not read as an
  // accepted entry.
  it('keeps the anonymous wording when no address came back', () => {
    renderPage({submitted: true, email: ''});

    expect(
      screen.getByRole('heading', {name: 'メールを送信しました'}),
    ).toHaveAccessibleDescription(/入力されたメールアドレス宛に/);
    expect(
      screen.queryByRole('link', {
        name: 'マイページでエントリー状況を確認する',
      }),
    ).not.toBeInTheDocument();
  });

  // The submit button the participant just pressed is gone, so focus is
  // moved to the notice rather than left on the document.
  it('moves focus to the notice heading once it appears', () => {
    renderPage({submitted: true, email: 'taro@example.com'});

    expect(screen.getByRole('heading', {level: 2})).toHaveFocus();
  });

  it('the form links to the login page for participants who already have an account', () => {
    renderPage();

    expect(
      screen.getByRole('link', {name: 'ログインしてエントリーする'}),
    ).toHaveAttribute('href', LOGIN_PATH);
  });

  it('the form hides the credential fields for a logged-in participant', () => {
    renderPage(null, {loggedIn: true});

    expect(screen.queryByLabelText('メールアドレス')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('パスワード')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('パスワード(確認)')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', {name: 'ログインしてエントリーする'}),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('氏名')).toBeInTheDocument();
  });

  it('confirms a logged-in entry without naming an address', () => {
    renderPage({submitted: true, loggedIn: true}, {loggedIn: true});

    expect(screen.getByRole('heading', {level: 2})).toHaveAccessibleDescription(
      /エントリーを受け付けました/,
    );
  });

  // The entry only counts once the link is followed, which a one-line
  // "sent" message left easy to miss.
  it('tells the participant the entry is not done until the mail link is opened', () => {
    renderPage({submitted: true, loggedIn: true}, {loggedIn: true});

    expect(
      screen.getByRole('heading', {name: '確認メールを送信しました'}),
    ).toHaveAccessibleDescription(/エントリーはまだ確定していません/);
    expect(
      screen.getByText(/「エントリーを確定する」のリンクを開く/),
    ).toHaveTextContent('有効期限はメールの送信から24時間');
    expect(screen.getByText('メールが届かない場合')).toBeInTheDocument();
  });

  it('points a logged-in participant at their entries on the my page', () => {
    renderPage({submitted: true, loggedIn: true}, {loggedIn: true});

    expect(
      screen.getByRole('link', {name: 'マイページでエントリー状況を確認する'}),
    ).toHaveAttribute('href', '/mypage');
  });

  // No account may exist behind an anonymous submission (#117), so there is
  // no my page to send it to; a mistyped address is what it can still fix.
  it('offers an anonymous participant a retry for a mistyped address instead', () => {
    renderPage({submitted: true, email: 'taro@example.com'});

    expect(
      screen.getByRole('heading', {name: 'メールを送信しました'}),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', {
        name: 'マイページでエントリー状況を確認する',
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/メールアドレスに誤りがある場合/),
    ).toBeInTheDocument();
  });

  it('offers the login screen when the session lapsed', () => {
    renderPage(
      {
        error:
          'ログインの有効期限が切れました。もう一度ログインしてからエントリーしてください',
        fieldErrors: {},
        values: SUBMITTED_VALUES,
        loginPath: LOGIN_PATH,
      },
      {loggedIn: true},
    );

    expect(screen.getByRole('link', {name: 'ログイン画面へ'})).toHaveAttribute(
      'href',
      LOGIN_PATH,
    );
  });

  // SvelteKit re-uses this page component across a navigation that only
  // changes the route parameters, so a move to another tournament's form has
  // to build the controls afresh rather than leave the previous tournament's
  // answers standing in them. See #94.
  it('starts over when the route moves to another tournament', async () => {
    const {rerender} = renderPage();
    await userEvent.type(screen.getByLabelText('氏名'), '山田太郎');
    await userEvent.click(screen.getByRole('radio', {name: 'M'}));

    await rerender({
      params: {regionSlug: 'tokyo', tournamentSlug: 'shinjinou'},
      data: {
        tournament: {...TOURNAMENT, id: OTHER_TOURNAMENT_ID, type: 'shinjinou'},
        now: new Date(),
        regulations: REGULATIONS,
        formFieldDefs: FORM_FIELD_DEFS,
        staffPreview: false,
        staffPreviewReason: null,
        priorityNotices: [],
        waitlistOpen: false,
        loggedIn: false,
        loginPath: LOGIN_PATH,
      },
      form: null,
    });

    expect(screen.getByLabelText('氏名')).toHaveValue('');
    expect(screen.getByRole('radio', {name: 'M'})).not.toBeChecked();
  });
});
