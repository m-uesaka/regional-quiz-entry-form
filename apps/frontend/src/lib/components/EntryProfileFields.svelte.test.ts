import {render, screen} from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {createRawSnippet, flushSync, mount, unmount} from 'svelte';
import {describe, expect, it} from 'vitest';
import {
  ENTRY_FREE_TEXT_MAX_LENGTH,
  ENTRY_NAME_MAX_LENGTH,
} from '@regional-quiz/shared';
import EntryProfileFields from './EntryProfileFields.svelte';

const VALUES = {
  name: '山田太郎',
  furigana: 'やまだたろう',
  displayName: '太郎',
  freeText: 'よろしく',
};

describe('EntryProfileFields', () => {
  it('renders the four fields under the labels the forms are read by', () => {
    render(EntryProfileFields, {props: VALUES});

    for (const [label, name, value] of [
      ['氏名', 'name', '山田太郎'],
      ['ふりがな', 'furigana', 'やまだたろう'],
      ['エントリーリスト掲載名', 'displayName', '太郎'],
      ['自由記述', 'freeText', 'よろしく'],
    ]) {
      const control = screen.getByRole('textbox', {name: label});
      expect(control).toHaveAttribute('id', name);
      expect(control).toHaveAttribute('name', name);
      expect(control).toHaveValue(value);
    }
  });

  it('requires the names and leaves the free text optional', () => {
    render(EntryProfileFields, {props: VALUES});

    for (const label of ['氏名', 'ふりがな', 'エントリーリスト掲載名']) {
      const control = screen.getByRole('textbox', {name: label});
      expect(control).toBeRequired();
      expect(control).toHaveAttribute(
        'maxlength',
        String(ENTRY_NAME_MAX_LENGTH),
      );
    }

    const freeText = screen.getByRole('textbox', {name: '自由記述'});
    expect(freeText).not.toBeRequired();
    expect(freeText).toHaveAttribute(
      'maxlength',
      String(ENTRY_FREE_TEXT_MAX_LENGTH),
    );
    expect(freeText.tagName).toBe('TEXTAREA');
  });

  it('files each message under its own field', () => {
    render(EntryProfileFields, {
      props: {
        ...VALUES,
        fieldErrors: {
          name: ['氏名のエラー', '二つ目は出さない'],
          furigana: ['ふりがなのエラー'],
          displayName: ['掲載名のエラー'],
          freeText: ['自由記述のエラー'],
        },
      },
    });

    for (const [label, message] of [
      ['氏名', '氏名のエラー'],
      ['ふりがな', 'ふりがなのエラー'],
      ['エントリーリスト掲載名', '掲載名のエラー'],
      ['自由記述', '自由記述のエラー'],
    ]) {
      expect(
        screen.getByRole('textbox', {name: label}),
      ).toHaveAccessibleDescription(message);
    }
    expect(screen.queryByText('二つ目は出さない')).toBeNull();
  });

  it('puts what the form adds between the names and the free text', () => {
    render(EntryProfileFields, {
      props: {
        ...VALUES,
        children: createRawSnippet(() => ({
          render: () => '<input name="added" aria-label="追加" />',
        })),
      },
    });

    const added = screen.getByRole('textbox', {name: '追加'});
    const displayName = screen.getByRole('textbox', {
      name: 'エントリーリスト掲載名',
    });
    const freeText = screen.getByRole('textbox', {name: '自由記述'});
    expect(displayName.compareDocumentPosition(added)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(added.compareDocumentPosition(freeText)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('writes what is typed back to the bound values', async () => {
    const user = userEvent.setup();
    const bound = $state({...VALUES});
    const target = document.body.appendChild(document.createElement('div'));
    const component = mount(EntryProfileFields, {
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
        get freeText() {
          return bound.freeText;
        },
        set freeText(typed: string) {
          bound.freeText = typed;
        },
      },
    });

    await user.type(screen.getByRole('textbox', {name: '氏名'}), 'A');
    await user.type(screen.getByRole('textbox', {name: 'ふりがな'}), 'B');
    await user.type(
      screen.getByRole('textbox', {name: 'エントリーリスト掲載名'}),
      'C',
    );
    await user.type(screen.getByRole('textbox', {name: '自由記述'}), 'D');

    expect(bound).toEqual({
      name: '山田太郎A',
      furigana: 'やまだたろうB',
      displayName: '太郎C',
      freeText: 'よろしくD',
    });

    bound.freeText = '別の値';
    flushSync();
    expect(screen.getByRole('textbox', {name: '自由記述'})).toHaveValue(
      '別の値',
    );

    await unmount(component);
    target.remove();
  });
});
