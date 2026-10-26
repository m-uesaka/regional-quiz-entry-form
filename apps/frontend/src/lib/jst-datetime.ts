// Japan Standard Time, which has no daylight saving, so a fixed offset is
// enough to convert either way.
const JST_OFFSET = '+09:00';

// What a `datetime-local` input submits: `YYYY-MM-DDTHH:mm`, with seconds
// appended when the control carries a `step` finer than a minute.
const DATETIME_LOCAL_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?$/;

const MS_PER_MINUTE = 60_000;

/**
 * Formats an instant as the value a `datetime-local` input expects, read in
 * JST: `YYYY-MM-DDTHH:mm`, or `YYYY-MM-DDTHH:mm:ss` when the instant falls
 * mid-minute.
 *
 * The timezone is pinned rather than taken from the runtime: these values
 * are rendered on the server (a Cloudflare Worker, whose local time is UTC)
 * but read and re-submitted by staff in Japan, so a value formatted in the
 * runtime's own zone would come back nine hours off.
 *
 * Seconds are carried because the form submits whatever it was shown: an
 * instant rendered at minute precision would be written back rounded down
 * the next time the form was saved, moving by up to 59 seconds a value
 * nobody had touched. Anything finer than a second is beyond what the
 * control can hold and is dropped.
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
  return shifted.toISOString().slice(0, hasSeconds(shifted) ? 19 : 16);
}

/**
 * The `step` a `datetime-local` control needs to hold the given value.
 *
 * A control left at its default step of one minute reports a value carrying
 * seconds as a step mismatch, which blocks the form from being submitted at
 * all — so the seconds field is only turned on for the rows that need it,
 * leaving every other row the simpler minute-precision control.
 *
 * @param value A value from `toJstDatetimeLocal`.
 * @return The `step` attribute, or undefined to leave the default in place.
 */
export function datetimeLocalStep(value: string): string | undefined {
  return DATETIME_LOCAL_PATTERN.exec(value)?.[2] ? '1' : undefined;
}

/**
 * Whether an instant falls mid-minute, i.e. carries seconds the
 * `datetime-local` value has to spell out.
 * @param date The instant, already shifted into JST.
 */
function hasSeconds(date: Date): boolean {
  return date.getUTCSeconds() !== 0 || date.getUTCMilliseconds() !== 0;
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

// What both display formats below share. Read once: building an
// `Intl.DateTimeFormat` is far costlier than using one, and the portal
// formats two instants per tournament.
const JST_DISPLAY_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h23',
};
const JST_DISPLAY_FORMAT = new Intl.DateTimeFormat(
  'ja-JP',
  JST_DISPLAY_OPTIONS,
);
const JST_DISPLAY_FORMAT_SECONDS = new Intl.DateTimeFormat('ja-JP', {
  ...JST_DISPLAY_OPTIONS,
  second: '2-digit',
});

/**
 * Formats an instant for people to read, in JST: `2026年11月1日(日) 9:00`.
 *
 * Pinned to JST for the same reason as `toJstDatetimeLocal`: the page is
 * rendered on a Worker whose local time is UTC, for readers in Japan.
 *
 * @param iso The instant to show.
 * @return The formatted text, or an empty string when `iso` is not a
 *     readable instant.
 */
export function formatJstDateTime(iso: string): string {
  return formatJst(iso, JST_DISPLAY_FORMAT);
}

/**
 * `formatJstDateTime`, down to the second: `2026年11月1日(日) 9:00:05`.
 *
 * For instants whose order people compare -- on the entry list, two
 * entries confirmed within the same minute would otherwise read as a tie.
 *
 * @param iso The instant to show.
 * @return The formatted text, or an empty string when `iso` is not a
 *     readable instant.
 */
export function formatJstDateTimeSeconds(iso: string): string {
  return formatJst(iso, JST_DISPLAY_FORMAT_SECONDS);
}

/**
 * Lays an instant out with one of the display formats above, appending
 * the seconds when the format carries them.
 * @param iso The instant to show.
 * @param format `JST_DISPLAY_FORMAT` or `JST_DISPLAY_FORMAT_SECONDS`.
 */
function formatJst(iso: string, format: Intl.DateTimeFormat): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return '';
  const parts = Object.fromEntries(
    format.formatToParts(instant).map(part => [part.type, part.value]),
  );
  const seconds = parts.second === undefined ? '' : `:${parts.second}`;
  return `${parts.year}年${parts.month}月${parts.day}日(${parts.weekday}) ${parts.hour}:${parts.minute}${seconds}`;
}
