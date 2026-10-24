import {describe, expect, it} from 'bun:test';
import {hasVisibleText, sanitizeMailHtml} from './mail-html';

describe('sanitizeMailHtml', () => {
  it('sanitizeMailHtml strips a script tag', () => {
    expect(
      sanitizeMailHtml('<p>お知らせ</p><script>alert(1)</script><p>以上</p>'),
    ).toBe('<p>お知らせ</p><p>以上</p>');
  });

  it('drops the rest of the body after an unterminated script tag', () => {
    expect(sanitizeMailHtml('<p>本文</p><SCRIPT>alert(1)')).toBe('<p>本文</p>');
  });

  it('sanitizeMailHtml strips an event handler attribute', () => {
    expect(
      sanitizeMailHtml(
        '<p onclick="steal()">本文</p><img src="x" onerror="steal()">',
      ),
    ).toBe('<p>本文</p>');
  });

  it('sanitizeMailHtml drops a javascript: link but keeps an https: one', () => {
    expect(
      sanitizeMailHtml(
        '<a href="javascript:alert(1)">悪</a>' +
          '<a href="https://example.com/rules?a=1&amp;b=2">要項</a>',
      ),
    ).toBe('<a>悪</a><a href="https://example.com/rules?a=1&amp;b=2">要項</a>');
  });

  it('drops a javascript: link spelled with character references or whitespace', () => {
    expect(
      sanitizeMailHtml(
        '<a href="jav&#97;script:alert(1)">1</a>' +
          '<a href=" java\tscript:alert(1)">2</a>' +
          "<a href='data:text/html,x'>3</a>",
      ),
    ).toBe('<a>1</a><a>2</a><a>3</a>');
  });

  it('keeps a mailto: link and drops a relative one', () => {
    expect(
      sanitizeMailHtml(
        '<a href="mailto:staff@example.com">連絡先</a>' +
          '<a href="/mypage">マイページ</a>',
      ),
    ).toBe('<a href="mailto:staff@example.com">連絡先</a><a>マイページ</a>');
  });

  it('sanitizeMailHtml keeps the allowed formatting tags', () => {
    const html =
      '<p>こんにちは<br><strong>重要</strong>と<em>強調</em></p>' +
      '<ul><li>一</li></ul><ol><li>二</li></ol>';

    expect(sanitizeMailHtml(html)).toBe(html);
  });

  it('drops attributes and normalizes the case of allowed tags', () => {
    expect(
      sanitizeMailHtml('<P style="color:red" class="x">本文<BR/></P></br>'),
    ).toBe('<p>本文<br></p>');
  });

  it('removes a tag that is not allowed but keeps its text', () => {
    expect(
      sanitizeMailHtml(
        '<div><span>本文</span></div><!-- メモ --><h1>見出し</h1>',
      ),
    ).toBe('本文見出し');
  });

  it('escapes a stray angle bracket and ampersand in text', () => {
    expect(sanitizeMailHtml('1 < 2 > 0 & A&amp;B <a')).toBe(
      '1 &lt; 2 &gt; 0 &amp; A&amp;B &lt;a',
    );
  });

  it('does not let a quoted > end a tag early', () => {
    expect(sanitizeMailHtml('<p title="a>b" onclick="x()">本文</p>')).toBe(
      '<p>本文</p>',
    );
  });

  it('drops only the tag of a self-closing svg, keeping the rest of the body', () => {
    expect(
      sanitizeMailHtml('<p><svg viewBox="0 0 1 1"/>集合時間</p><p>以上</p>'),
    ).toBe('<p>集合時間</p><p>以上</p>');
  });

  it('still drops the content of an svg that is not self-closing', () => {
    expect(sanitizeMailHtml('<svg><text>x</text></svg><p>本文</p>')).toBe(
      '<p>本文</p>',
    );
  });

  it('keeps a < that never closes as text', () => {
    expect(sanitizeMailHtml('A<B の場合')).toBe('A&lt;B の場合');
    expect(sanitizeMailHtml('<a title="x>本文')).toBe('&lt;a title="x&gt;本文');
  });

  // Each of these used to send a regular expression back over the rest of
  // the body from every `<`, which on a 20 000-character body ran to
  // hundreds of millions of steps.
  it('handles a body of unclosed markup in linear time', () => {
    for (const unit of ['<!', '<?', '<a"', "<a'", '<a "x', '<!--', '<a']) {
      const html = unit.repeat(Math.ceil(20000 / unit.length)) + '>';
      const started = performance.now();

      sanitizeMailHtml(html);

      expect(performance.now() - started, unit).toBeLessThan(200);
    }
  });
});

describe('hasVisibleText', () => {
  it('is false for nothing but empty tags and whitespace', () => {
    expect(hasVisibleText('<p></p>\n<p>&nbsp;<br></p>')).toBe(false);
  });

  it('is true once any text is left', () => {
    expect(
      hasVisibleText('<p><a href="https://example.com/">詳細</a></p>'),
    ).toBe(true);
  });
});
