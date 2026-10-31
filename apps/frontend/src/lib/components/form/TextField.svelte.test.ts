import {render, screen} from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {createRawSnippet, flushSync, mount, unmount} from 'svelte';
import {describe, expect, it} from 'vitest';
import TextField from './TextField.svelte';

const FIELD = {id: 'name', name: 'name', label: '氏名'};
const MESSAGE = '入力してください';
const SNIPPET_LABEL = createRawSnippet(() => ({
  render: () => '<em>氏名</em>',
}));

describe('TextField', () => {
  describe.each([
    {control: 'an input', multiline: false},
    {control: 'a textarea', multiline: true},
  ] as const)('as $control', ({multiline}) => {
    it('names the control with the label', () => {
      render(TextField, {props: {...FIELD, multiline}});

      expect(screen.getByRole('textbox', {name: '氏名'})).toHaveAttribute(
        'name',
        'name',
      );
    });

    it('describes the control with the message and marks it invalid', () => {
      render(TextField, {props: {...FIELD, multiline, error: MESSAGE}});

      const control = screen.getByRole('textbox', {name: '氏名'});
      expect(control).toHaveAccessibleDescription(MESSAGE);
      expect(control).toBeInvalid();
      expect(control).toHaveClass('border-destructive');
    });

    it('carries no error attributes while there is no message', () => {
      render(TextField, {props: {...FIELD, multiline}});

      const control = screen.getByRole('textbox', {name: '氏名'});
      expect(control).not.toHaveAttribute('aria-describedby');
      expect(control).not.toHaveAttribute('aria-invalid');
      expect(control).toHaveClass('border-input');
      expect(screen.queryByText(MESSAGE)).toBeNull();
    });

    it('drops the wiring when the message goes away', async () => {
      const {rerender} = render(TextField, {
        props: {...FIELD, multiline, error: MESSAGE},
      });

      await rerender({error: undefined});

      const control = screen.getByRole('textbox', {name: '氏名'});
      expect(control).not.toHaveAttribute('aria-describedby');
      expect(control).not.toHaveAttribute('aria-invalid');
    });

    it('passes the other attributes on to the control', () => {
      render(TextField, {props: {...FIELD, multiline, maxlength: 10}});

      const control = screen.getByRole('textbox', {name: '氏名'});
      expect(control).toHaveAttribute('maxlength', '10');
      expect(control).not.toHaveAttribute('multiline');
    });

    it('writes what is typed back to a bound value', async () => {
      const user = userEvent.setup();
      const bound = $state({value: '山田'});
      const target = document.body.appendChild(document.createElement('div'));
      const component = mount(TextField, {
        target,
        props: {
          ...FIELD,
          multiline,
          get value() {
            return bound.value;
          },
          set value(typed: string) {
            bound.value = typed;
          },
        },
      });

      await user.type(screen.getByRole('textbox', {name: '氏名'}), '太郎');
      expect(bound.value).toBe('山田太郎');

      bound.value = '別の値';
      flushSync();
      expect(screen.getByRole('textbox', {name: '氏名'})).toHaveValue('別の値');

      await unmount(component);
      target.remove();
    });
  });

  it.each([
    {control: 'an input', multiline: false},
    {control: 'a textarea', multiline: true},
  ] as const)('labels $control with a snippet', ({multiline}) => {
    render(TextField, {
      props: {...FIELD, multiline, label: SNIPPET_LABEL, error: MESSAGE},
    });

    const control = screen.getByRole('textbox', {name: '氏名'});
    expect(control).toHaveAttribute('id', 'name');
    expect(control).toHaveAttribute('aria-describedby', 'name-error');
    expect(control).toHaveAccessibleDescription(MESSAGE);
    expect(control).toBeInvalid();
    expect(screen.getByText('氏名').tagName).toBe('EM');
  });

  it('reads the message ahead of what else describes the control', () => {
    render(TextField, {
      props: {...FIELD, error: MESSAGE, 'aria-describedby': 'requirements'},
    });

    expect(screen.getByRole('textbox', {name: '氏名'})).toHaveAttribute(
      'aria-describedby',
      'name-error requirements',
    );
  });

  it('keeps what else describes the control while there is no message', () => {
    render(TextField, {
      props: {...FIELD, 'aria-describedby': 'requirements'},
    });

    expect(screen.getByRole('textbox', {name: '氏名'})).toHaveAttribute(
      'aria-describedby',
      'requirements',
    );
  });

  it('gives each field a message id of its own', () => {
    render(TextField, {
      props: {id: 'region-1-name', name: 'name', label: '地域名', error: 'a'},
    });

    expect(screen.getByText('a')).toHaveAttribute('id', 'region-1-name-error');
  });

  it('announces the message only when asked to', async () => {
    const {rerender} = render(TextField, {props: {...FIELD, error: MESSAGE}});
    expect(screen.queryByRole('alert')).toBeNull();

    await rerender({errorRole: 'alert'});

    expect(screen.getByRole('alert')).toHaveTextContent(MESSAGE);
  });
});
