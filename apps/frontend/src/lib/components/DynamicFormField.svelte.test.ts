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
});
