import {describe, expect, it} from 'bun:test';
import {labelPlainText, parseLabelLinks} from './label-links';

describe('parseLabelLinks', () => {
  it('returns a label without links as one text segment', () => {
    expect(parseLabelLinks('規約に同意する')).toEqual([
      {kind: 'text', text: '規約に同意する'},
    ]);
  });

  it('splits out an <a> link with its text and href', () => {
    expect(
      parseLabelLinks('<a href="https://example.com/rules">規約</a>に同意する'),
    ).toEqual([
      {kind: 'link', text: '規約', href: 'https://example.com/rules'},
      {kind: 'text', text: 'に同意する'},
    ]);
  });

  it('reads several links, single-quoted hrefs and upper-case tags', () => {
    expect(
      parseLabelLinks(
        '<A HREF=\'http://a.example\'>A</A>と<a href="https://b.example">B</a>',
      ),
    ).toEqual([
      {kind: 'link', text: 'A', href: 'http://a.example'},
      {kind: 'text', text: 'と'},
      {kind: 'link', text: 'B', href: 'https://b.example'},
    ]);
  });

  it.each([
    ['a javascript: URL', '<a href="javascript:alert(1)">x</a>'],
    ['a relative URL', '<a href="/rules">x</a>'],
    ['an extra attribute', '<a href="https://e.example" onclick="x()">x</a>'],
    ['an unquoted href', '<a href=https://e.example>x</a>'],
    ['markup inside the link', '<a href="https://e.example"><b>x</b></a>'],
    ['another tag', '<img src="https://e.example/x.png">'],
  ])('leaves %s as plain text', (_, label) => {
    expect(parseLabelLinks(label)).toEqual([{kind: 'text', text: label}]);
  });
});

describe('parseLabelLinks character references', () => {
  it('decodes references in an href and in text', () => {
    expect(
      parseLabelLinks(
        '<a href="https://e.example/r?a=1&amp;b=2">A&amp;B</a>&lt;必須&gt;&#x3042;&#12354;',
      ),
    ).toEqual([
      {kind: 'link', text: 'A&B', href: 'https://e.example/r?a=1&b=2'},
      {kind: 'text', text: '<必須>ああ'},
    ]);
  });

  it('shows an escaped <a> as text rather than a link', () => {
    expect(
      parseLabelLinks('&lt;a href="https://e.example"&gt;x&lt;/a&gt;'),
    ).toEqual([{kind: 'text', text: '<a href="https://e.example">x</a>'}]);
  });

  it('keeps unknown or invalid references as written', () => {
    expect(parseLabelLinks('R&D &foo; &#0; &#x110000;')).toEqual([
      {kind: 'text', text: 'R&D &foo; &#0; &#x110000;'},
    ]);
  });
});

describe('labelPlainText', () => {
  it('replaces each link with its text', () => {
    expect(
      labelPlainText('<a href="https://example.com/rules">規約</a>に同意する'),
    ).toBe('規約に同意する');
  });

  it('returns a label without links unchanged', () => {
    expect(labelPlainText('備考')).toBe('備考');
  });
});
