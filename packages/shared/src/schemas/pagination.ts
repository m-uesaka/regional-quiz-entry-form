import {z} from 'zod';
import {EntryStatusSchema} from './entry';

/** Rows per page when a list request does not say. */
export const PAGE_SIZE_DEFAULT = 100;
/**
 * The most rows a single list request may ask for. Kept at or under the
 * backend's `SELECT_PAGE_SIZE`, so one page is always one Data API request
 * that the server's `max_rows` cannot trim.
 */
export const PAGE_SIZE_MAX = 500;

// `limit` / `offset` arrive as query-string values, hence the coercion.
export const PageQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGE_SIZE_MAX)
    .default(PAGE_SIZE_DEFAULT),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

// The staff entry list's query: a page, optionally narrowed to one status
// -- what staff actually want is "only the waitlist" or "only the
// unverified", not to scroll through everyone.
export const StaffEntryListQuerySchema = PageQuerySchema.extend({
  status: EntryStatusSchema.optional(),
});
export type StaffEntryListQuery = z.infer<typeof StaffEntryListQuerySchema>;

/**
 * One page of a list, plus the total row count the pager needs to say
 * "m–k of n" and to know whether there is a next page.
 * @param item The schema of one list item.
 */
export const PageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    limit: z.number().int(),
    offset: z.number().int(),
  });
