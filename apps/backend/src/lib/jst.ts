// Japan Standard Time, which every date and time on the site is read and
// written in. It has no daylight saving, so a fixed offset converts between
// a wall-clock time in Japan and an instant.

/** UTC+9, in milliseconds. */
export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * Writes an instant as the Japan-time `YYYY-MM-DD HH:mm` staff read times
 * in, and a spreadsheet takes for a date-time.
 * @param iso The instant, as stored (ISO 8601).
 * @return The formatted time, or `iso` itself if it doesn't parse: one odd
 *     value is better shown as it is than allowed to fail everything it is
 *     written into.
 */
export function formatJstDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return iso;
  }
  const jst = new Date(ms + JST_OFFSET_MS).toISOString();
  return `${jst.slice(0, 10)} ${jst.slice(11, 16)}`;
}
