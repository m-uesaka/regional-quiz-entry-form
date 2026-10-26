import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {dragReorder, dropIndex, moveItem} from './drag-reorder';

/** Each test row is this tall, stacked from the top of the viewport. */
const ROW_HEIGHT = 40;

/**
 * Dispatches a pointer event. jsdom has no `PointerEvent`, so it is a mouse
 * event carrying the pointer's properties.
 */
function pointer(
  target: EventTarget,
  type: string,
  {clientY, pointerId = 1}: {clientY: number; pointerId?: number},
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientY,
  });
  Object.defineProperties(event, {
    pointerId: {value: pointerId},
    isPrimary: {value: true},
  });
  target.dispatchEvent(event);
  return event;
}

describe('moveItem', () => {
  it('moves an item down, the rest closing up', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('moves an item up', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('leaves the original alone', () => {
    const items = ['a', 'b'];
    moveItem(items, 0, 1);
    expect(items).toEqual(['a', 'b']);
  });
});

describe('dropIndex', () => {
  it('counts the rows whose middle is above the pointer', () => {
    expect(dropIndex([20, 60], 10)).toBe(0);
    expect(dropIndex([20, 60], 40)).toBe(1);
    expect(dropIndex([20, 60], 80)).toBe(2);
  });
});

describe('dragReorder', () => {
  let list: HTMLElement;
  let detach: () => void;
  const moves: Array<[number, number]> = [];

  /** The rows' names, top to bottom. */
  const order = () =>
    Array.from(list.children).map(row => row.textContent?.trim());
  const handleOf = (name: string) =>
    Array.from(list.querySelectorAll('[data-drag-handle]')).find(
      handle => handle.parentElement?.textContent?.trim() === name,
    )!;
  const rowOf = (name: string) => handleOf(name).parentElement!;

  beforeEach(() => {
    moves.length = 0;
    list = document.createElement('ul');
    for (const name of ['a', 'b', 'c']) {
      const row = document.createElement('li');
      row.dataset.dragItem = '';
      row.innerHTML = `<span data-drag-handle></span><span>${name}</span>`;
      // Laid out by where the row now is, as a browser would.
      row.getBoundingClientRect = () => {
        const top = Array.from(list.children).indexOf(row) * ROW_HEIGHT;
        return {top, height: ROW_HEIGHT} as DOMRect;
      };
      list.appendChild(row);
    }
    document.body.appendChild(list);
    // Re-renders the way a keyed `{#each}` would.
    const attachment = dragReorder((from, to) => {
      moves.push([from, to]);
      const row = list.children[from];
      row.remove();
      list.insertBefore(row, list.children[to] ?? null);
    });
    detach = attachment(list) as () => void;
  });

  afterEach(() => {
    detach();
    list.remove();
  });

  it('moves a row as it is dragged past the others', () => {
    pointer(handleOf('a'), 'pointerdown', {clientY: 20});
    pointer(window, 'pointermove', {clientY: 70});
    expect(order()).toEqual(['b', 'a', 'c']);

    pointer(window, 'pointermove', {clientY: 110});
    expect(order()).toEqual(['b', 'c', 'a']);

    pointer(window, 'pointermove', {clientY: 5});
    pointer(window, 'pointerup', {clientY: 5});
    expect(order()).toEqual(['a', 'b', 'c']);
  });

  it('marks the dragged row while it is held', () => {
    pointer(handleOf('b'), 'pointerdown', {clientY: 60});
    expect(rowOf('b').dataset.dragging).toBe('');

    pointer(window, 'pointerup', {clientY: 60});
    expect(rowOf('b').dataset.dragging).toBeUndefined();
  });

  it('stops following the pointer once it is released', () => {
    pointer(handleOf('a'), 'pointerdown', {clientY: 20});
    pointer(window, 'pointercancel', {clientY: 20});
    pointer(window, 'pointermove', {clientY: 110});

    expect(moves).toEqual([]);
  });

  it('ignores a second finger', () => {
    pointer(handleOf('a'), 'pointerdown', {clientY: 20});
    pointer(window, 'pointermove', {clientY: 110, pointerId: 2});

    expect(moves).toEqual([]);
  });

  it('starts a drag only from a handle', () => {
    const label = rowOf('a').lastElementChild!;
    const event = pointer(label, 'pointerdown', {clientY: 20});
    pointer(window, 'pointermove', {clientY: 110});

    expect(moves).toEqual([]);
    // Text and inputs in the row keep working as before.
    expect(event.defaultPrevented).toBe(false);
  });

  it('scrolls while a row is held near the bottom of the viewport', () => {
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    // Runs the first frame only; the loop would otherwise never return.
    let frames = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      if (frames++ === 0) callback(0);
      return frames;
    });

    pointer(handleOf('a'), 'pointerdown', {clientY: window.innerHeight - 4});

    expect(scrollBy).toHaveBeenCalledWith(0, expect.any(Number));
    expect(scrollBy.mock.calls[0][1]).toBeGreaterThan(0);
    vi.restoreAllMocks();
  });
});
