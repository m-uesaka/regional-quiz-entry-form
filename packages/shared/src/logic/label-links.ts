/** A run of a form field label: plain text, or a link with its own text. */
export type LabelSegment =
  {kind: 'text'; text: string} | {kind: 'link'; text: string; href: string};

/**
 * One `<a href="...">text</a>` in a label. Only this exact shape is a link:
 * a lone `href` attribute, quoted either way, pointing at an `http(s)` URL,
 * and text without tags of its own. Anything else stays as written, so a
 * label never carries markup through to the page -- the form renders each
 * segment as text or as an `<a>` it builds itself, never as HTML.
 */
const LINK_PATTERN =
  /<a\s+href\s*=\s*(?:"(https?:\/\/[^"<>\s]+)"|'(https?:\/\/[^'<>\s]+)')\s*>([^<]+)<\/a\s*>/gi;

/**
 * Splits a form field label into text and the links staff wrote into it
 * with `<a>` tags (#173), e.g. a terms checkbox labelled
 * `<a href="https://example.com/rules">規約</a>に同意する`.
 * @param label The label as staff wrote it.
 * @return The label's segments in order; a single text segment when it
 *     has no links. Empty text between links is left out.
 */
export function parseLabelLinks(label: string): LabelSegment[] {
  const segments: LabelSegment[] = [];
  let last = 0;
  for (const match of label.matchAll(LINK_PATTERN)) {
    if (match.index > last) {
      segments.push({kind: 'text', text: label.slice(last, match.index)});
    }
    segments.push({
      kind: 'link',
      text: match[3],
      href: match[1] ?? match[2],
    });
    last = match.index + match[0].length;
  }
  if (last < label.length) {
    segments.push({kind: 'text', text: label.slice(last)});
  }
  return segments;
}

/**
 * A form field label as plain text, each link replaced by its text -- for
 * the places a label is read rather than clicked (the staff entry detail,
 * the CSV header, an error message).
 * @param label The label as staff wrote it.
 */
export function labelPlainText(label: string): string {
  return parseLabelLinks(label)
    .map(segment => segment.text)
    .join('');
}
