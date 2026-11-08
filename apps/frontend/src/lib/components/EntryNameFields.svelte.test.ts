import {render, screen} from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {flushSync, mount, unmount} from 'svelte';
import {describe, expect, it} from 'vitest';
import {ENTRY_NAME_MAX_LENGTH} from '@regional-quiz/shared';
import EntryNameFields from './EntryNameFields.svelte';

const VALUES = {
  name: '山田太郎',
  furigana: 'やまだたろう',
  displayName: '太郎',
};

const FIELDS = [
  ['氏名', 'name', '山田太郎'],
  ['ふりがな', 'furigana', 'やまだたろう'],
  ['エントリーリスト掲載名', 'displayName', '太郎'],
] as const;

describe('EntryNameFields', () => {
  it('renders the three names under the labels the forms are read by', () => {
    render(EntryNameFields, {props: VALUES});

    for (const [label, name, value] of FIELDS) {
      const control = screen.getByRole('textbox', {name: label});
      expect(control).toHaveAttribute('id', name);
      expect(control).toHaveAttribute('name', name);
      expect(control).toHaveValue(value);
      expect(control).toBeRequired();
      expect(control).toHaveAttribute(
        'maxlength',
        String(ENTRY_NAME_MAX_LENGTH),
      );
    }
    expect(screen.getAllByRole('textbox')).toHaveLength(3);
  });

  it('files each message under its own field', () => {
    render(EntryNameFields, {
      props: {
        ...VALUES,
        fieldErrors: {
          name: ['氏名のエラー', '二つ目は出さない'],
          furigana: ['ふりがなのエラー'],
          displayName: ['掲載名のエラー'],
        },
      },
    });

    for (const [label, message] of [
      ['氏名', '氏名のエラー'],
      ['ふりがな', 'ふりがなのエラー'],
      ['エントリーリスト掲載名', '掲載名のエラー'],
    ]) {
      expect(
        screen.getByRole('textbox', {name: label}),
      ).toHaveAccessibleDescription(message);
    }
    expect(screen.queryByText('二つ目は出さない')).toBeNull();
  });

  it('writes what is typed back to the bound values', async () => {
    const user = userEvent.setup();
    const bound = $state({...VALUES});
    const target = document.body.appendChild(document.createElement('div'));
    const component = mount(EntryNameFields, {
      target,
      props: {
        get name() {
          return bound.name;
        },
        set name(typed: string) {
          bound.name = typed;
        },
        get furigana() {
          return bound.furigana;
        },
        set furigana(typed: string) {
          bound.furigana = typed;
        },
        get displayName() {
          return bound.displayName;
        },
        set displayName(typed: string) {
          bound.displayName = typed;
        },
      },
    });

    await user.type(screen.getByRole('textbox', {name: '氏名'}), 'A');
    await user.type(screen.getByRole('textbox', {name: 'ふりがな'}), 'B');
    await user.type(
      screen.getByRole('textbox', {name: 'エントリーリスト掲載名'}),
      'C',
    );

    expect(bound).toEqual({
      name: '山田太郎A',
      furigana: 'やまだたろうB',
      displayName: '太郎C',
    });

    bound.name = '別の値';
    flushSync();
    expect(screen.getByRole('textbox', {name: '氏名'})).toHaveValue('別の値');

    await unmount(component);
    target.remove();
  });
});
