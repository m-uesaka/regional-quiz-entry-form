// Japan Standard Time, which has no daylight saving, so a fixed offset is
// enough to convert either way.
const JST_OFFSET = '+09:00';

// What a `datetime-local` input submits: `YYYY-MM-DDTHH:mm`, with seconds
// appended when the control carries a `step` finer than a minute.
const DATETIME_LOCAL_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?$/;

const MS_PER_MINUTE = 60_000;

/**
 * Formats an instant as the `YYYY-MM-DDTHH:mm` value a `datetime-local`
 * input expects, read in JST.
 *
 * The timezone is pinned rather than taken from the runtime: these values
 * are rendered on the server (a Cloudflare Worker, whose local time is UTC)
 * but read and re-submitted by staff in Japan, so a value formatted in the
 * runtime's own zone would come back nine hours off.
 *
 * @param iso The stored instant, or null when there is none.
 * @return The input value, or an empty string when there is no instant to
 *     show or the stored one cannot be read.
 */
export function toJstDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const instant = Date.parse(iso);
  if (Number.isNaN(instant)) return '';
  const shifted = new Date(instant + 9 * 60 * MS_PER_MINUTE);
  return shifted.toISOString().slice(0, 16);
}

/**
 * Reads a `datetime-local` value back as an instant, interpreting the
 * wall-clock time it carries as JST — the counterpart of
 * `toJstDatetimeLocal`.
 *
 * @param value The submitted control value.
 * @return The instant as an ISO 8601 string, null when the control was left
 *     empty, or the value verbatim when it is not a datetime at all — the
 *     schema that receives it reports that as a rejected field, which is
 *     more use than silently dropping what was typed.
 */
export function fromJstDatetimeLocal(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const match = DATETIME_LOCAL_PATTERN.exec(trimmed);
  if (!match) return trimmed;
  const instant = Date.parse(`${trimmed}${match[2] ? '' : ':00'}${JST_OFFSET}`);
  if (Number.isNaN(instant)) return trimmed;
  return new Date(instant).toISOString();
}
