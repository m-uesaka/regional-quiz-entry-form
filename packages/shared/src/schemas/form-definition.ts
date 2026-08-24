import {parse as parseYaml} from 'yaml';
import {z} from 'zod';

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
    tournamentSlug: z.string(),
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
  tournamentSlug: z.string(),
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
