import {parse as parseYaml} from 'yaml';
import {z} from 'zod';

export const FormFieldTypeSchema = z.enum(['checkbox', 'radio', 'textarea']);

export const FormFieldDefYamlSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string(),
  type: FormFieldTypeSchema,
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
});

export const FormDefinitionYamlSchema = z.object({
  tournamentSlug: z.string(),
  fields: z.array(FormFieldDefYamlSchema),
});
export type FormDefinitionYaml = z.infer<typeof FormDefinitionYamlSchema>;

export function parseFormDefinitionYaml(yamlText: string): FormDefinitionYaml {
  return FormDefinitionYamlSchema.parse(parseYaml(yamlText));
}

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
