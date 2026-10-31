import {render, screen} from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {mount, unmount} from 'svelte';
import {describe, expect, it} from 'vitest';
import type {CustomFieldValues, FormFieldDef} from '@regional-quiz/shared';
import CustomFieldsSection from './CustomFieldsSection.svelte';

const BASE_FIELD_DEF = {required: false, options: null, displayOrder: 0};

const FORM_FIELD_DEFS: FormFieldDef[] = [
  {
    ...BASE_FIELD_DEF,
    fieldKey: 'lunch',
    label: 'お弁当',
    plainLabel: 'お弁当',
    fieldType: 'radio',
    options: ['和食', '洋食'],
  },
  {
    ...BASE_FIELD_DEF,
    fieldKey: 'toppings',
    label: 'トッピング',
    plainLabel: 'トッピング',
    fieldType: 'checkbox',
    options: ['チーズ', 'ベーコン'],
  },
  {
    ...BASE_FIELD_DEF,
    // Collides with one of the form's own inputs, which is what the
    // namespaced control name is there for.
    fieldKey: 'name',
    label: '所属',
    plainLabel: '所属',
    fieldType: 'textfield',
  },
];

const VALUES: CustomFieldValues = {lunch: '和食', toppings: [], name: ''};

describe('CustomFieldsSection', () => {
  it('renders every field from its stored definition', () => {
    render(CustomFieldsSection, {
      props: {formFieldDefs: FORM_FIELD_DEFS, values: VALUES},
    });

    expect(screen.getByRole('radio', {name: '和食'})).toBeChecked();
    expect(screen.getByRole('checkbox', {name: 'チーズ'})).not.toBeChecked();
    expect(screen.getByRole('textbox', {name: '所属'})).toHaveAttribute(
      'name',
      'custom.name',
    );
  });

  it("finds a field's message under the namespaced control name", () => {
    render(CustomFieldsSection, {
      props: {
        formFieldDefs: FORM_FIELD_DEFS,
        values: VALUES,
        fieldErrors: {
          // The entry form's own 氏名 field, which must not land here.
          name: ['氏名のエラー'],
          'custom.name': ['所属のエラー'],
          'custom.lunch': ['お弁当のエラー'],
        },
      },
    });

    expect(
      screen.getByRole('textbox', {name: '所属'}),
    ).toHaveAccessibleDescription('所属のエラー');
    expect(screen.getByText('お弁当のエラー')).toBeInTheDocument();
    expect(screen.queryByText('氏名のエラー')).toBeNull();
  });

  it('shows the message about the answers as a whole under them', () => {
    const {container} = render(CustomFieldsSection, {
      props: {
        formFieldDefs: FORM_FIELD_DEFS,
        values: VALUES,
        fieldErrors: {customFieldValues: ['回答が長すぎます']},
      },
    });

    expect(container.querySelector('p:last-of-type')).toHaveTextContent(
      '回答が長すぎます',
    );
  });

  it('writes every kind of answer back to the bound values', async () => {
    const user = userEvent.setup();
    const bound = $state({values: {...VALUES}});
    const target = document.body.appendChild(document.createElement('div'));
    const component = mount(CustomFieldsSection, {
      target,
      props: {
        formFieldDefs: FORM_FIELD_DEFS,
        get values() {
          return bound.values;
        },
        set values(answers: CustomFieldValues) {
          bound.values = answers;
        },
      },
    });

    await user.click(screen.getByRole('radio', {name: '洋食'}));
    await user.click(screen.getByRole('checkbox', {name: 'ベーコン'}));
    await user.type(screen.getByRole('textbox', {name: '所属'}), '東京大学');

    expect(bound.values).toEqual({
      lunch: '洋食',
      toppings: ['ベーコン'],
      name: '東京大学',
    });

    await unmount(component);
    target.remove();
  });
});
