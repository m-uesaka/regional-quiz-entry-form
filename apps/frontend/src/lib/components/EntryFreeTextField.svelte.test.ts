import {render, screen} from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {flushSync, mount, unmount} from 'svelte';
import {describe, expect, it} from 'vitest';
import {ENTRY_FREE_TEXT_MAX_LENGTH} from '@regional-quiz/shared';
import EntryFreeTextField from './EntryFreeTextField.svelte';

describe('EntryFreeTextField', () => {
  it('renders an optional text area under the label the forms are read by', () => {
    render(EntryFreeTextField, {props: {freeText: 'よろしく'}});

    const control = screen.getByRole('textbox', {name: '自由記述'});
    expect(control.tagName).toBe('TEXTAREA');
    expect(control).toHaveAttribute('id', 'freeText');
    expect(control).toHaveAttribute('name', 'freeText');
    expect(control).toHaveValue('よろしく');
    expect(control).not.toBeRequired();
    expect(control).toHaveAttribute(
      'maxlength',
      // The browser counts UTF-16 units, the schema code points (#302).
      String(ENTRY_FREE_TEXT_MAX_LENGTH * 2),
    );
  });

  it('shows its own message under it', () => {
    render(EntryFreeTextField, {
      props: {
        freeText: '',
        fieldErrors: {freeText: ['自由記述のエラー'], name: ['氏名のエラー']},
      },
    });

    expect(
      screen.getByRole('textbox', {name: '自由記述'}),
    ).toHaveAccessibleDescription('自由記述のエラー');
    expect(screen.queryByText('氏名のエラー')).toBeNull();
  });

  it('writes what is typed back to the bound value', async () => {
    const user = userEvent.setup();
    const bound = $state({freeText: 'よろしく'});
    const target = document.body.appendChild(document.createElement('div'));
    const component = mount(EntryFreeTextField, {
      target,
      props: {
        get freeText() {
          return bound.freeText;
        },
        set freeText(typed: string) {
          bound.freeText = typed;
        },
      },
    });

    await user.type(screen.getByRole('textbox', {name: '自由記述'}), 'D');
    expect(bound.freeText).toBe('よろしくD');

    bound.freeText = '別の値';
    flushSync();
    expect(screen.getByRole('textbox', {name: '自由記述'})).toHaveValue(
      '別の値',
    );

    await unmount(component);
    target.remove();
  });
});
