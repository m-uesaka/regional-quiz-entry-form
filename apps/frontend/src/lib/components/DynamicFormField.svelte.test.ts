import {render, screen} from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import type {FormFieldDefYaml} from '@regional-quiz/shared';
import DynamicFormField from './DynamicFormField.svelte';

describe('DynamicFormField', () => {
  it('calls onChange with the clicked option for a radio field', async () => {
    const user = userEvent.setup();
    const field: FormFieldDefYaml = {
      type: 'radio',
      key: 'lunch',
      label: 'お弁当',
      required: true,
      options: ['和食', '洋食'],
    };
    const onChange = vi.fn();

    render(DynamicFormField, {props: {field, value: '', onChange}});

    await user.click(screen.getByRole('radio', {name: '洋食'}));

    expect(onChange).toHaveBeenCalledExactlyOnceWith('洋食');
  });

  it('adds a checkbox option to the array when checked', async () => {
    const user = userEvent.setup();
    const field: FormFieldDefYaml = {
      type: 'checkbox',
      key: 'toppings',
      label: 'トッピング',
      required: false,
      options: ['チーズ', 'ベーコン'],
    };
    const onChange = vi.fn();

    render(DynamicFormField, {
      props: {field, value: ['チーズ'], onChange},
    });

    await user.click(screen.getByRole('checkbox', {name: 'ベーコン'}));

    expect(onChange).toHaveBeenCalledExactlyOnceWith(['チーズ', 'ベーコン']);
  });

  it('removes a checkbox option from the array when unchecked', async () => {
    const user = userEvent.setup();
    const field: FormFieldDefYaml = {
      type: 'checkbox',
      key: 'toppings',
      label: 'トッピング',
      required: false,
      options: ['チーズ', 'ベーコン'],
    };
    const onChange = vi.fn();

    render(DynamicFormField, {
      props: {field, value: ['チーズ', 'ベーコン'], onChange},
    });

    await user.click(screen.getByRole('checkbox', {name: 'チーズ'}));

    expect(onChange).toHaveBeenCalledExactlyOnceWith(['ベーコン']);
  });

  it('marks every option required when a required checkbox group has no selection', () => {
    const field: FormFieldDefYaml = {
      type: 'checkbox',
      key: 'toppings',
      label: 'トッピング',
      required: true,
      options: ['チーズ', 'ベーコン'],
    };
    const onChange = vi.fn();

    render(DynamicFormField, {props: {field, value: [], onChange}});

    expect(screen.getByRole('checkbox', {name: 'チーズ'})).toBeRequired();
    expect(screen.getByRole('checkbox', {name: 'ベーコン'})).toBeRequired();
  });

  it('drops the required constraint from a checkbox group once one option is selected', () => {
    const field: FormFieldDefYaml = {
      type: 'checkbox',
      key: 'toppings',
      label: 'トッピング',
      required: true,
      options: ['チーズ', 'ベーコン'],
    };
    const onChange = vi.fn();

    render(DynamicFormField, {props: {field, value: ['チーズ'], onChange}});

    expect(screen.getByRole('checkbox', {name: 'チーズ'})).not.toBeRequired();
    expect(screen.getByRole('checkbox', {name: 'ベーコン'})).not.toBeRequired();
  });

  it('toggles a plain boolean checkbox using the field key as the array value', async () => {
    const user = userEvent.setup();
    const field: FormFieldDefYaml = {
      type: 'checkbox',
      key: 'agree',
      label: '規約に同意する',
      required: true,
    };
    const onChange = vi.fn();

    render(DynamicFormField, {props: {field, value: [], onChange}});

    await user.click(screen.getByRole('checkbox', {name: '規約に同意する'}));

    expect(onChange).toHaveBeenCalledExactlyOnceWith(['agree']);
  });

  it('calls onChange with the new text for a textarea field', async () => {
    const user = userEvent.setup();
    const field: FormFieldDefYaml = {
      type: 'textarea',
      key: 'comment',
      label: '自由記述',
      required: false,
    };
    const onChange = vi.fn();

    render(DynamicFormField, {props: {field, value: '', onChange}});

    await user.type(screen.getByLabelText(/自由記述/), 'x');

    expect(onChange).toHaveBeenCalledWith('x');
  });
});
