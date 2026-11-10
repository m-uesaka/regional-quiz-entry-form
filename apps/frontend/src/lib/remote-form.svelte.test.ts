import {describe, expect, it} from 'vitest';
import {
  adoptEarlyInput,
  formErrorMessage,
  remoteFormPageUrl,
} from './remote-form';

describe('formErrorMessage', () => {
  it('shows nothing for a form that was not refused', () => {
    expect(formErrorMessage(undefined)).toBeNull();
    expect(formErrorMessage([])).toBeNull();
  });

  it("shows the form's own issue as it is", () => {
    expect(
      formErrorMessage([
        {path: ['slug'], message: 'slug が違います'},
        {path: [], message: '地域の作成に失敗しました'},
      ]),
    ).toBe('地域の作成に失敗しました');
  });

  it('sums up issues that belong to controls', () => {
    expect(
      formErrorMessage([{path: ['slug'], message: 'slug が違います'}]),
    ).toBe('入力内容を確認してください');
  });
});

describe('remoteFormPageUrl', () => {
  it('drops the remote action a form posted without JavaScript carries', () => {
    const url = new URL('http://localhost/admin/regions?/remote=abc%2Fcreate');

    expect(remoteFormPageUrl(url).href).toBe('http://localhost/admin/regions');
  });

  it("keeps the page's own query", () => {
    const url = new URL('http://localhost/entries?page=2&/remote=abc');

    expect(remoteFormPageUrl(url).href).toBe('http://localhost/entries?page=2');
  });

  it('leaves the URL it was given alone', () => {
    const url = new URL('http://localhost/admin/regions?/remote=abc');

    remoteFormPageUrl(url);

    expect(url.searchParams.has('/remote')).toBe(true);
  });
});

describe('adoptEarlyInput', () => {
  /** Builds a form as the server rendered it, not yet in the document. */
  function serverRendered(html: string): HTMLFormElement {
    const form = document.createElement('form');
    form.innerHTML = html;
    return form;
  }

  /** Attaches to `form` and returns the names whose input was replayed. */
  function replayedNames(form: HTMLFormElement): string[] {
    const names: string[] = [];
    form.addEventListener('input', event => {
      names.push((event.target as HTMLInputElement).name);
    });
    adoptEarlyInput(form);
    return names;
  }

  it('replays input for the controls that were changed before it ran', () => {
    const form = serverRendered(`
      <input name="slug" value="">
      <input name="name" value="東京">
      <input name="b:allowsDualEntry" type="checkbox">
      <textarea name="note">前</textarea>
      <select name="type"><option selected>a</option><option>b</option></select>
    `);
    const [slug, , box, note, type] = Array.from(form.elements) as [
      HTMLInputElement,
      HTMLInputElement,
      HTMLInputElement,
      HTMLTextAreaElement,
      HTMLSelectElement,
    ];
    slug.value = 'typed-early';
    box.checked = true;
    note.value = '後';
    type.selectedIndex = 1;

    expect(replayedNames(form)).toEqual([
      'slug',
      'b:allowsDualEntry',
      'note',
      'type',
    ]);
  });

  it('leaves an untouched form alone', () => {
    const form = serverRendered(`
      <input name="name" value="東京">
      <input name="b:allowsDualEntry" type="checkbox" checked>
      <button>保存</button>
    `);

    expect(replayedNames(form)).toEqual([]);
  });
});
