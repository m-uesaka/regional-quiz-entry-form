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

/**
 * One piece of markup: a comment, a declaration or processing instruction
 * (`<!...>` / `<?...>`), or a start/end tag. A tag's attribute section
 * skips over quoted values, so a `>` inside one doesn't end the tag early.
 */
const MARKUP_PATTERN =
  /<!--[\s\S]*?-->|<![^>]*>|<\?[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;

/** One attribute in a tag's attribute section, with its optional value. */
const ATTRIBUTE_PATTERN =
  /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** A character reference the text may already contain, kept as written. */
const CHARACTER_REFERENCE_PATTERN =
  /^&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/;

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
  let escaped = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '<') {
      escaped += '&lt;';
    } else if (char === '>') {
      escaped += '&gt;';
    } else if (
      char === '&' &&
      !CHARACTER_REFERENCE_PATTERN.test(text.slice(i))
    ) {
      escaped += '&amp;';
    } else {
      escaped += char;
    }
  }
  return escaped;
}

/**
 * Escapes a value for a double-quoted attribute.
 * @param value The raw value.
 */
function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
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
    return href === null ? '<a>' : `<a href="${escapeAttribute(href)}">`;
  }
  return `<${name}>`;
}

/**
 * Narrows a staff-written bulk mail body down to the allowed formatting
 * tags.
 *
 * Allowed tags (`p`, `br`, `strong`, `em`, `ul`, `ol`, `li`, `a`) are kept
 * without attributes, except an `<a>`'s `href` when it is an absolute
 * `http:` / `https:` / `mailto:` URL. Any other tag is removed and its text
 * kept, except for `script`, `style` and the like, whose content goes too.
 * Comments and declarations are removed. Text is escaped.
 * @param html The body as staff wrote it.
 * @return The body to store and send.
 */
export function sanitizeMailHtml(html: string): string {
  // A fresh copy, since a global pattern carries its position in
  // `lastIndex` and the loop below moves it by hand.
  const markup = new RegExp(MARKUP_PATTERN.source, 'g');
  let output = '';
  let position = 0;
  for (
    let match = markup.exec(html);
    match !== null;
    match = markup.exec(html)
  ) {
    output += escapeText(html.slice(position, match.index));
    position = markup.lastIndex;

    const [, endSlash, rawName, attributes] = match;
    if (rawName === undefined) {
      // A comment, declaration or processing instruction.
      continue;
    }
    const name = rawName.toLowerCase();
    const isEnd = endSlash === '/';

    if (!isEnd && DROPPED_CONTENT_TAGS.has(name)) {
      // Skip to the matching end tag; an unterminated one takes the rest
      // of the body with it, as a browser would.
      const end = new RegExp(`</${name}\\s*>`, 'ig');
      end.lastIndex = position;
      const endMatch = end.exec(html);
      position = endMatch === null ? html.length : end.lastIndex;
      markup.lastIndex = position;
      continue;
    }
    if (ALLOWED_TAGS.has(name)) {
      output += renderAllowedTag(name, isEnd, attributes);
    }
  }
  output += escapeText(html.slice(position));
  return output;
}
