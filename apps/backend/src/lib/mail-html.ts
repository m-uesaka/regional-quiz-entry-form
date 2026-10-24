/**
 * @fileoverview Narrows the HTML body staff write for a bulk mail down to a
 * small set of formatting tags (#122).
 *
 * The body goes out from the organization's verified sending domain to every
 * participant of a tournament, so a single compromised regional staff
 * account could otherwise mail them all arbitrary HTML -- a convincing
 * phishing page included. An allow-list is used rather than a block-list:
 * whatever isn't recognized below is removed or escaped, never passed
 * through.
 *
 * The output is rebuilt from scratch rather than edited in place. An allowed
 * tag is re-emitted in its canonical form with every attribute dropped,
 * except `href` on `<a>`, which is parsed as a URL, checked against
 * `ALLOWED_LINK_SCHEMES`, and written back from the parsed URL -- so what a
 * mail client reads is exactly what was checked. Text between tags is
 * escaped, so a `<` that doesn't open a recognized tag can't start one in
 * the client.
 */

import {escapeHtml} from './html';

/** Tags kept (without their attributes, bar `<a href>`). */
const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  'p',
  'br',
  'strong',
  'em',
  'ul',
  'ol',
  'li',
  'a',
]);

/** Tags that never get a closing tag, so a `</br>` is dropped. */
const VOID_TAGS: ReadonlySet<string> = new Set(['br']);

/**
 * Tags whose content goes with them. Their text is code, styling or a
 * document within the document rather than something the reader was meant
 * to see, so keeping it as text would only put garbage in the mail.
 */
const DROPPED_CONTENT_TAGS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'template',
  'noscript',
  'noembed',
  'noframes',
  'textarea',
  'title',
  'xmp',
  'svg',
  'math',
  'head',
]);

/** Link schemes kept on `<a href>`; any other link loses its `href`. */
const ALLOWED_LINK_SCHEMES: ReadonlySet<string> = new Set([
  'http:',
  'https:',
  'mailto:',
]);

/** One attribute in a tag's attribute section, with its optional value. */
const ATTRIBUTE_PATTERN =
  /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * A character reference the text may already contain, kept as written.
 * Sticky, so it is tried at one position without copying the rest out.
 */
const CHARACTER_REFERENCE_PATTERN =
  /&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/y;

const NAMED_REFERENCES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * Escapes text found between tags. A `&` that already starts a character
 * reference is left alone so `&amp;` written by staff still reads as `&`;
 * any other `&`, and every `<` / `>`, is escaped.
 * @param text The raw text.
 */
function escapeText(text: string): string {
  const reference = new RegExp(CHARACTER_REFERENCE_PATTERN);
  let escaped = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '<') {
      escaped += '&lt;';
    } else if (char === '>') {
      escaped += '&gt;';
    } else if (char === '&') {
      reference.lastIndex = i;
      escaped += reference.test(text) ? '&' : '&amp;';
    } else {
      escaped += char;
    }
  }
  return escaped;
}

/**
 * Decodes the character references in an attribute value, so a scheme
 * spelled with them (`jav&#97;script:`) is checked as the client would read
 * it. An unknown named reference is left as written, which leaves a value
 * that won't parse as an allowed URL rather than one that slips through.
 * @param value The attribute value as written.
 */
function decodeReferences(value: string): string {
  return value.replace(
    /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g,
    (reference, body: string) => {
      if (body.startsWith('#')) {
        const codePoint =
          body[1] === 'x' || body[1] === 'X'
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
      }
      return NAMED_REFERENCES[body.toLowerCase()] ?? reference;
    },
  );
}

/**
 * The `href` to keep for an `<a>` tag, or `null` when it has none worth
 * keeping (missing, relative, unparsable, or of a scheme that isn't
 * allowed).
 * @param attributes The tag's raw attribute section.
 */
function safeHref(attributes: string): string | null {
  for (const match of attributes.matchAll(ATTRIBUTE_PATTERN)) {
    if (match[1].toLowerCase() !== 'href') {
      continue;
    }
    const raw = match[2] ?? match[3] ?? match[4] ?? '';
    let url: URL;
    try {
      url = new URL(decodeReferences(raw).trim());
    } catch {
      return null;
    }
    return ALLOWED_LINK_SCHEMES.has(url.protocol) ? url.href : null;
  }
  return null;
}

/**
 * Re-emits one allowed tag in its canonical form.
 * @param name The tag name, lowercased.
 * @param isEnd Whether this is an end tag.
 * @param attributes The tag's raw attribute section.
 */
function renderAllowedTag(
  name: string,
  isEnd: boolean,
  attributes: string,
): string {
  if (isEnd) {
    return VOID_TAGS.has(name) ? '' : `</${name}>`;
  }
  if (name === 'a') {
    const href = safeHref(attributes);
    return href === null ? '<a>' : `<a href="${escapeHtml(href)}">`;
  }
  return `<${name}>`;
}

/** A start or end tag found by `MarkupScanner`. */
interface ScannedTag {
  /** The tag name, lowercased. */
  name: string;
  isEnd: boolean;
  /** The raw attribute section, between the name and the closing `>`. */
  attributes: string;
  /** Written as `<name ... />`. */
  selfClosing: boolean;
}

/** One piece of markup found by `MarkupScanner`. */
interface ScannedMarkup {
  /** Just past its closing `>`. */
  end: number;
  /** The tag, or `undefined` for a comment, declaration or processing instruction. */
  tag?: ScannedTag;
}

/**
 * Recognizes the markup that starts at a `<`: a comment, a declaration or
 * processing instruction (`<!...>` / `<?...>`), or a start/end tag whose
 * attribute section skips over quoted values, so a `>` inside one doesn't
 * end the tag early. A `<` that starts none of these, or one that is never
 * closed, is text.
 *
 * Written by hand rather than as one regular expression, because a pattern
 * retried from every `<` rescans the rest of the body each time it fails:
 * a body of 20 000 unclosed `<!` or `<a "` would take hundreds of millions
 * of steps, past what a Worker may spend on one request. Here every lookup
 * that can fail is answered once: a missing terminator is remembered, and
 * every position a failed tag scan passed through is marked as one that
 * leads nowhere, so a later scan stops as soon as it reaches one. The whole
 * body is scanned in linear time.
 */
class MarkupScanner {
  private readonly lastGt: number;
  /** Where a search for `-->` came up empty; any later search will too. */
  private commentEndMissingFrom = Infinity;
  /** Positions outside quotes from which a tag scan reaches no `>`. */
  private readonly deadEnds: Uint8Array;

  constructor(private readonly html: string) {
    this.lastGt = html.lastIndexOf('>');
    this.deadEnds = new Uint8Array(html.length + 1);
  }

  /**
   * @param start The index of a `<`.
   * @return The markup starting there, or `null` when the `<` is text.
   */
  scan(start: number): ScannedMarkup | null {
    if (start > this.lastGt) {
      return null;
    }
    const next = this.html[start + 1];
    if (next === '!') {
      if (this.html.startsWith('<!--', start)) {
        const commentEnd = this.findCommentEnd(start + 4);
        if (commentEnd !== -1) {
          return {end: commentEnd + 3};
        }
      }
      return {end: this.html.indexOf('>', start) + 1};
    }
    if (next === '?') {
      return {end: this.html.indexOf('>', start) + 1};
    }
    return this.scanTag(start);
  }

  private findCommentEnd(from: number): number {
    if (from >= this.commentEndMissingFrom) {
      return -1;
    }
    const index = this.html.indexOf('-->', from);
    if (index === -1) {
      this.commentEndMissingFrom = from;
    }
    return index;
  }

  private scanTag(start: number): ScannedMarkup | null {
    const html = this.html;
    let position = start + 1;
    const isEnd = html[position] === '/';
    if (isEnd) {
      position++;
    }
    const nameStart = position;
    if (!/[a-zA-Z]/.test(html[position] ?? '')) {
      return null;
    }
    while (/[a-zA-Z0-9-]/.test(html[position] ?? '')) {
      position++;
    }
    const nameEnd = position;

    const visited: number[] = [];
    while (position < html.length && this.deadEnds[position] === 0) {
      visited.push(position);
      const char = html[position];
      if (char === '>') {
        const attributes = html.slice(nameEnd, position);
        return {
          end: position + 1,
          tag: {
            name: html.slice(nameStart, nameEnd).toLowerCase(),
            isEnd,
            attributes,
            selfClosing: attributes.trimEnd().endsWith('/'),
          },
        };
      }
      if (char === '"' || char === "'") {
        const close = html.indexOf(char, position + 1);
        if (close === -1) {
          break;
        }
        position = close + 1;
      } else {
        position++;
      }
    }
    for (const index of visited) {
      this.deadEnds[index] = 1;
    }
    return null;
  }
}

/**
 * Narrows a staff-written bulk mail body down to the allowed formatting
 * tags.
 *
 * Allowed tags (`p`, `br`, `strong`, `em`, `ul`, `ol`, `li`, `a`) are kept
 * without attributes, except an `<a>`'s `href` when it is an absolute
 * `http:` / `https:` / `mailto:` URL. Any other tag is removed and its text
 * kept, except for `script`, `style` and the like, whose content goes too
 * (a self-closing `<svg ... />` has none, so only the tag goes). Comments
 * and declarations are removed. Text is escaped.
 * @param html The body as staff wrote it.
 * @return The body to store and send.
 */
export function sanitizeMailHtml(html: string): string {
  const scanner = new MarkupScanner(html);
  let output = '';
  let textStart = 0;
  for (
    let start = html.indexOf('<');
    start !== -1;
    start = html.indexOf('<', start + 1)
  ) {
    const markup = scanner.scan(start);
    if (markup === null) {
      continue;
    }
    output += escapeText(html.slice(textStart, start));
    textStart = markup.end;
    start = markup.end - 1;

    const tag = markup.tag;
    if (tag === undefined) {
      continue;
    }
    if (!tag.isEnd && !tag.selfClosing && DROPPED_CONTENT_TAGS.has(tag.name)) {
      // Skip to the matching end tag; an unterminated one takes the rest
      // of the body with it, as a browser would.
      const end = new RegExp(`</${tag.name}\\s*>`, 'ig');
      end.lastIndex = textStart;
      const endMatch = end.exec(html);
      textStart = endMatch === null ? html.length : end.lastIndex;
      start = textStart - 1;
      continue;
    }
    if (ALLOWED_TAGS.has(tag.name)) {
      output += renderAllowedTag(tag.name, tag.isEnd, tag.attributes);
    }
  }
  output += escapeText(html.slice(textStart));
  return output;
}

/**
 * Whether a body `sanitizeMailHtml()` returned has any text left to read,
 * as opposed to nothing but whitespace and empty tags (`<p></p>` from a
 * pasted image the sanitizer removed).
 * @param sanitizedHtml The sanitized body. Only its own canonical tags are
 *     recognized, so this is not for raw input.
 */
export function hasVisibleText(sanitizedHtml: string): boolean {
  return (
    sanitizedHtml
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;|&#160;|&#[xX]0*[aA]0;/g, '')
      .trim() !== ''
  );
}
