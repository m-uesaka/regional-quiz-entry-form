import {render, screen} from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import type {FormFieldDefYaml} from '@regional-quiz/shared';
import DynamicFormField from './DynamicFormField.svelte';

describe('DynamicFormField', () => {
  it('checks the clicked option for a radio field', async () => {
    const user = userEvent.setup();
    const field: FormFieldDefYaml = {
      type: 'radio',
      key: 'lunch',
      label: 'お弁当',
      required: true,
      options: ['和食', '洋食'],
    };

    render(DynamicFormField, {props: {field, value: ''}});

    await user.click(screen.getByRole('radio', {name: '洋食'}));

    expect(screen.getByRole('radio', {name: '洋食'})).toBeChecked();
    expect(screen.getByRole('radio', {name: '和食'})).not.toBeChecked();
  });

  it('preselects the answer a radio field was given', () => {
    const field: FormFieldDefYaml = {
      type: 'radio',
      key: 'lunch',
      label: 'お弁当',
      required: true,
      options: ['和食', '洋食'],
    };

    render(DynamicFormField, {props: {field, value: '和食'}});

    expect(screen.getByRole('radio', {name: '和食'})).toBeChecked();
  });

  it('submits a checkbox group under one name, one value per checked box', async () => {
    const user = userEvent.setup();
    const field: FormFieldDefYaml = {
      type: 'checkbox',
      key: 'toppings',
      label: 'トッピング',
      required: false,
      options: ['チーズ', 'ベーコン'],
    };

    render(DynamicFormField, {props: {field, value: ['チーズ']}});

    await user.click(screen.getByRole('checkbox', {name: 'ベーコン'}));

    const checked = screen
      .getAllByRole('checkbox')
      .filter(box => (box as HTMLInputElement).checked);
    expect(checked.map(box => (box as HTMLInputElement).value)).toEqual([
      'チーズ',
      'ベーコン',
    ]);
    expect(
      checked.every(
        box => (box as HTMLInputElement).name === 'custom.toppings',
      ),
    ).toBe(true);
  });

  it('unchecks a checkbox option when it is clicked again', async () => {
    const user = userEvent.setup();
    const field: FormFieldDefYaml = {
      type: 'checkbox',
      key: 'toppings',
      label: 'トッピング',
      required: false,
      options: ['チーズ', 'ベーコン'],
    };

    render(DynamicFormField, {props: {field, value: ['チーズ', 'ベーコン']}});

    await user.click(screen.getByRole('checkbox', {name: 'チーズ'}));

    expect(screen.getByRole('checkbox', {name: 'チーズ'})).not.toBeChecked();
    expect(screen.getByRole('checkbox', {name: 'ベーコン'})).toBeChecked();
  });

  it('marks every option required when a required checkbox group has no selection', () => {
    const field: FormFieldDefYaml = {
      type: 'checkbox',
      key: 'toppings',
      label: 'トッピング',
      required: true,
      options: ['チーズ', 'ベーコン'],
    };

    render(DynamicFormField, {props: {field, value: []}});

    expect(screen.getByRole('checkbox', {name: 'チーズ'})).toBeRequired();
    expect(screen.getByRole('checkbox', {name: 'ベーコン'})).toBeRequired();
  });

  it('drops the required constraint from a checkbox group once one option is selected', async () => {
    const user = userEvent.setup();
    const field: FormFieldDefYaml = {
      type: 'checkbox',
      key: 'toppings',
      label: 'トッピング',
      required: true,
      options: ['チーズ', 'ベーコン'],
    };

    render(DynamicFormField, {props: {field, value: []}});

    await user.click(screen.getByRole('checkbox', {name: 'チーズ'}));

    expect(screen.getByRole('checkbox', {name: 'チーズ'})).not.toBeRequired();
    expect(screen.getByRole('checkbox', {name: 'ベーコン'})).not.toBeRequired();
  });

  it('submits a plain boolean checkbox under the field key', async () => {
    const user = userEvent.setup();
    const field: FormFieldDefYaml = {
      type: 'checkbox',
      key: 'agree',
      label: '規約に同意する',
      required: true,
    };

    render(DynamicFormField, {props: {field, value: []}});

    const box = screen.getByRole('checkbox', {name: '規約に同意する'});
    await user.click(box);

    expect(box).toBeChecked();
    expect(box).toHaveAttribute('value', 'agree');
  });

  it('checks a plain boolean checkbox the field key was given for', () => {
    const field: FormFieldDefYaml = {
      type: 'checkbox',
      key: 'agree',
      label: '規約に同意する',
      required: true,
    };

    render(DynamicFormField, {props: {field, value: ['agree']}});

    expect(
      screen.getByRole('checkbox', {name: '規約に同意する'}),
    ).toBeChecked();
  });

  it('keeps what is typed into a textarea field', async () => {
    const user = userEvent.setup();
    const field: FormFieldDefYaml = {
      type: 'textarea',
      key: 'comment',
      label: '自由記述',
      required: false,
    };

    render(DynamicFormField, {props: {field, value: ''}});

    await user.type(screen.getByLabelText(/自由記述/), 'よろしく');

    expect(screen.getByLabelText(/自由記述/)).toHaveValue('よろしく');
  });

  it('renders a textfield field as a one-line input', async () => {
    const user = userEvent.setup();
    const field: FormFieldDefYaml = {
      type: 'textfield',
      key: 'affiliation',
      label: '所属',
      required: true,
    };

    render(DynamicFormField, {props: {field, value: ''}});

    const input = screen.getByRole('textbox', {name: /所属/});
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('name', 'custom.affiliation');
    expect(input).toBeRequired();
    await user.type(input, '東京大学');
    expect(input).toHaveValue('東京大学');
  });

  describe.each([
    {type: 'textarea', tagName: 'TEXTAREA'},
    {type: 'textfield', tagName: 'INPUT'},
  ] as const)('as a $type field', ({type, tagName}) => {
    const field: FormFieldDefYaml = {
      type,
      key: 'note',
      label: '備考',
      required: true,
    };

    it('keeps the control the form and the action address it by', () => {
      render(DynamicFormField, {props: {field, value: '既存'}});

      const control = screen.getByRole('textbox', {name: '備考'});
      expect(control.tagName).toBe(tagName);
      expect(control).toHaveAttribute('id', 'custom.note');
      expect(control).toHaveAttribute('name', 'custom.note');
      expect(control).toHaveAttribute('maxlength', '2000');
      expect(control).toBeRequired();
      expect(control).toHaveValue('既存');
    });

    it('marks a required field without changing its name', () => {
      render(DynamicFormField, {props: {field, value: ''}});

      const star = screen.getByText('*');
      expect(star).toHaveAttribute('aria-hidden', 'true');
      expect(star.closest('label')).toHaveAttribute('for', 'custom.note');
    });

    it('describes the control with the message', () => {
      render(DynamicFormField, {
        props: {field, value: '', error: '「備考」は必須です'},
      });

      const control = screen.getByRole('textbox', {name: '備考'});
      expect(control).toHaveAttribute('aria-describedby', 'custom.note-error');
      expect(control).toHaveAccessibleDescription('「備考」は必須です');
      expect(control).toBeInvalid();
    });

    it('carries no error attributes while there is no message', () => {
      render(DynamicFormField, {props: {field, value: ''}});

      const control = screen.getByRole('textbox', {name: '備考'});
      expect(control).not.toHaveAttribute('aria-describedby');
      expect(control).not.toHaveAttribute('aria-invalid');
    });

    it('renders an <a> in the label as a link', () => {
      render(DynamicFormField, {
        props: {
          field: {
            ...field,
            label: '<a href="https://example.com/note">備考</a>欄',
          },
          value: '',
        },
      });

      expect(screen.getByRole('link', {name: '備考'})).toHaveAttribute(
        'href',
        'https://example.com/note',
      );
      expect(screen.getByRole('textbox', {name: /備考\s*欄/})).toHaveAttribute(
        'id',
        'custom.note',
      );
    });
  });

  it('renders an <a> in a checkbox label as a link opening in a new tab', () => {
    const field: FormFieldDefYaml = {
      type: 'checkbox',
      key: 'agree',
      label: '<a href="https://example.com/rules">規約</a>に同意する',
      required: true,
    };

    render(DynamicFormField, {props: {field, value: []}});

    const link = screen.getByRole('link', {name: /規約/});
    expect(link).toHaveAttribute('href', 'https://example.com/rules');
    expect(link).toHaveAttribute('target', '_blank');
    // The label's segments stay in one element, so the checkbox row's flex
    // layout sees the input and one run of text rather than spacing each
    // segment apart.
    const checkbox = screen.getByRole('checkbox', {name: /規約\s*に同意する/});
    const row = checkbox.closest('label');
    expect(Array.from(row?.children ?? [], child => child.tagName)).toEqual([
      'INPUT',
      'SPAN',
    ]);
    expect(link.parentElement).toBe(row?.children[1]);
  });

  it('renders an <a> in a choice as a link, keeping the raw value', () => {
    const field: FormFieldDefYaml = {
      type: 'radio',
      key: 'event',
      label: '<a href="https://example.com/events">企画</a>の希望',
      required: true,
      options: ['<a href="https://example.com/a">A</a>企画', 'B企画'],
    };

    render(DynamicFormField, {props: {field, value: ''}});

    expect(screen.getByRole('link', {name: /^企画/})).toHaveAttribute(
      'href',
      'https://example.com/events',
    );
    expect(screen.getByRole('link', {name: /^A/})).toHaveAttribute(
      'href',
      'https://example.com/a',
    );
    expect(screen.getByRole('radio', {name: /A\s*企画/})).toHaveAttribute(
      'value',
      '<a href="https://example.com/a">A</a>企画',
    );
  });

  it('shows markup other than an http(s) link as text', () => {
    const field: FormFieldDefYaml = {
      type: 'checkbox',
      key: 'agree',
      label: '<a href="javascript:alert(1)">規約</a>に同意する',
      required: true,
    };

    render(DynamicFormField, {props: {field, value: []}});

    expect(screen.queryByRole('link')).toBeNull();
    expect(
      screen.getByText('<a href="javascript:alert(1)">規約</a>に同意する'),
    ).toBeInTheDocument();
  });
});
