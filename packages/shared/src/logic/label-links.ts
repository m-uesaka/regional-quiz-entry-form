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

/** The named character references a label may use, decoded to text. */
const NAMED_REFERENCES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

/** A named or numeric character reference, e.g. `&amp;` or `&#38;`. */
const CHARACTER_REFERENCE_PATTERN =
  /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-z]+));/g;

/**
 * Decodes the character references in a run of a label, so a link pasted
 * in its HTML-escaped form (`?a=1&amp;b=2`) points where it reads. A
 * reference this doesn't know, or one naming no valid code point, is kept
 * as written.
 *
 * Decoding happens after `LINK_PATTERN` has matched, so an escaped `&lt;a&gt;`
 * comes out as the text `<a>`, never as a link, and a decoded `href` still
 * starts with the `http(s)://` the pattern saw.
 * @param text The run as staff wrote it.
 */
function decodeCharacterReferences(text: string): string {
  return text.replace(
    CHARACTER_REFERENCE_PATTERN,
    (reference, decimal?: string, hex?: string, name?: string) => {
      if (name !== undefined) {
        return NAMED_REFERENCES[name] ?? reference;
      }
      const codePoint = parseInt(decimal ?? hex ?? '', decimal ? 10 : 16);
      return codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : reference;
    },
  );
}

/**
 * Splits a form field label into text and the links staff wrote into it
 * with `<a>` tags (#173), e.g. a terms checkbox labelled
 * `<a href="https://example.com/rules">規約</a>に同意する`.
 * @param label The label as staff wrote it.
 * @return The label's segments in order, character references decoded; a
 *     single text segment when it has no links. Empty text between links
 *     is left out.
 */
export function parseLabelLinks(label: string): LabelSegment[] {
  const segments: LabelSegment[] = [];
  let last = 0;
  for (const match of label.matchAll(LINK_PATTERN)) {
    if (match.index > last) {
      segments.push({
        kind: 'text',
        text: decodeCharacterReferences(label.slice(last, match.index)),
      });
    }
    segments.push({
      kind: 'link',
      text: decodeCharacterReferences(match[3]),
      href: decodeCharacterReferences(match[1] ?? match[2]),
    });
    last = match.index + match[0].length;
  }
  if (last < label.length) {
    segments.push({
      kind: 'text',
      text: decodeCharacterReferences(label.slice(last)),
    });
  }
  return segments;
}

/**
 * A form field label (or a choice's label) as plain text, each link
 * replaced by its text -- for the places a label is read rather than
 * clicked. A field definition carries its label this way as `plainLabel`
 * (`toFormFieldDef()` in the backend), so a screen showing a label as text
 * uses that rather than calling this itself.
 * @param label The label as staff wrote it.
 */
export function labelPlainText(label: string): string {
  return parseLabelLinks(label)
    .map(segment => segment.text)
    .join('');
}
