import {parse as parseYaml} from 'yaml';
import {z} from 'zod';
import {TournamentTypeSchema} from './tournament';

export const FormFieldTypeSchema = z.enum(['checkbox', 'radio', 'textarea']);

const BaseFormFieldDefYamlSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string(),
  required: z.boolean().default(false),
});

export const FormFieldDefYamlSchema = z.discriminatedUnion('type', [
  // A plain boolean checkbox (e.g. "agree to the rules") has no options.
  BaseFormFieldDefYamlSchema.extend({
    type: z.literal('checkbox'),
    options: z.array(z.string()).optional(),
  }),
  // A radio group needs at least one option to be selectable.
  BaseFormFieldDefYamlSchema.extend({
    type: z.literal('radio'),
    options: z.array(z.string()).min(1),
  }),
  BaseFormFieldDefYamlSchema.extend({
    type: z.literal('textarea'),
    options: z.array(z.string()).optional(),
  }),
]);
export type FormFieldDefYaml = z.infer<typeof FormFieldDefYamlSchema>;

export const FormDefinitionYamlSchema = z
  .object({
    // The slug identifies the *tournament type* (`saikyoi` / `shinjinou`),
    // matching the `:tournamentSlug` URL segment and `tournaments.type` —
    // not a per-tournament identifier. It's checked against the type of the
    // tournament the upload targets, so a definition can't be saved to a
    // tournament of the wrong *type*; it can still land on the wrong
    // tournament of the same type (e.g. another region's)
    // (see `syncFormFieldDefs()` in the backend).
    tournamentSlug: TournamentTypeSchema,
    fields: z.array(FormFieldDefYamlSchema),
  })
  .refine(
    data =>
      new Set(data.fields.map(field => field.key)).size === data.fields.length,
    {message: 'フィールドキーが重複しています', path: ['fields']},
  );
export type FormDefinitionYaml = z.infer<typeof FormDefinitionYamlSchema>;

export function parseFormDefinitionYaml(yamlText: string): FormDefinitionYaml {
  return FormDefinitionYamlSchema.parse(parseYaml(yamlText));
}

/**
 * Request body for the form-definition upload API: the raw YAML text, still
 * unparsed. Shared so the frontend and backend validate the same shape;
 * `parseFormDefinitionYaml()` handles parsing/validating the YAML contents
 * themselves.
 */
export const FormDefinitionUploadSchema = z.object({yaml: z.string()});
export type FormDefinitionUpload = z.infer<typeof FormDefinitionUploadSchema>;

/**
 * Request body for the sheet-import preview API: the spreadsheet to read
 * and the tournament slug to embed in the generated YAML. Shared so the
 * frontend and backend validate the same shape.
 */
export const SheetImportRequestSchema = z.object({
  spreadsheetId: z.string(),
  tournamentSlug: TournamentTypeSchema,
});
export type SheetImportRequest = z.infer<typeof SheetImportRequestSchema>;

export interface FormFieldDefRow {
  tournamentId: string;
  fieldKey: string;
  label: string;
  fieldType: z.infer<typeof FormFieldTypeSchema>;
  required: boolean;
  options: string[] | null;
  displayOrder: number;
}

/**
 * A tournament's custom form field definition as exposed to API clients:
 * the metadata needed to render an answer stored in an entry's
 * `customFieldValues` under its human-readable label rather than its raw
 * storage key (e.g. `t_shirt_size`), in the tournament's configured display
 * order.
 */
export const FormFieldDefSchema = z.object({
  fieldKey: z.string(),
  label: z.string(),
  fieldType: FormFieldTypeSchema,
  required: z.boolean(),
  options: z.array(z.string()).nullable(),
  displayOrder: z.number().int(),
});
export type FormFieldDef = z.infer<typeof FormFieldDefSchema>;

/**
 * Converts a stored form field definition back into the shape
 * `DynamicFormField.svelte` renders (the same shape the definition was
 * authored in), so an existing entry can be re-rendered as an editable form.
 * @param fieldDef The definition as returned by the API.
 */
export function toFormFieldDefYaml(fieldDef: FormFieldDef): FormFieldDefYaml {
  const base = {
    key: fieldDef.fieldKey,
    label: fieldDef.label,
    required: fieldDef.required,
  };
  // `radio` is the one variant whose options are non-optional; a stored
  // definition with none can't happen through `FormDefinitionYamlSchema`,
  // but the database column is nullable, so fall back to an empty list
  // rather than asserting.
  if (fieldDef.fieldType === 'radio') {
    return {...base, type: 'radio', options: fieldDef.options ?? []};
  }
  return {
    ...base,
    type: fieldDef.fieldType,
    options: fieldDef.options ?? undefined,
  };
}

/**
 * Converts a parsed form definition into rows shaped like the
 * `form_field_defs` table, for a given tournament ID resolved separately
 * from `tournamentSlug`.
 * @param definition The parsed form definition.
 * @param tournamentId The tournament ID to associate the rows with.
 */
export function toFormFieldDefRows(
  definition: FormDefinitionYaml,
  tournamentId: string,
): FormFieldDefRow[] {
  return definition.fields.map((field, index) => ({
    tournamentId,
    fieldKey: field.key,
    label: field.label,
    fieldType: field.type,
    required: field.required,
    options: field.options ?? null,
    displayOrder: index,
  }));
}
