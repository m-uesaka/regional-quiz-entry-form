import type {Attachment} from 'svelte/attachments';

/**
 * How close to the top or bottom of the viewport, in CSS pixels, a dragged
 * row has to be held for the page to scroll -- the only way to drag a row
 * past the screen's edge on a phone, where there is no wheel to scroll with.
 */
const AUTOSCROLL_EDGE_PX = 64;

/**
 * Returns a copy of `items` with the item at `from` moved to `to`, the rest
 * closing up around it.
 * @param items The items, in their current order.
 * @param from The index of the item to move.
 * @param to The index it should end up at.
 */
export function moveItem<T>(
  items: readonly T[],
  from: number,
  to: number,
): T[] {
  const moved = [...items];
  const [item] = moved.splice(from, 1);
  moved.splice(to, 0, item);
  return moved;
}

/**
 * Where a dragged row belongs: after every other row whose middle is above
 * the pointer.
 * @param midpoints The vertical middles of the rows other than the dragged
 *     one, top to bottom, in the same coordinates as `y`.
 * @param y Where the pointer is.
 * @return The index the dragged row should be at.
 */
export function dropIndex(midpoints: readonly number[], y: number): number {
  return midpoints.filter(midpoint => midpoint < y).length;
}

/**
 * Lets the rows of a list be reordered by dragging, with a mouse, a pen or a
 * finger alike: Pointer Events cover all three, where the HTML drag-and-drop
 * API does nothing on most phones.
 *
 * The rows are the element's children marked `data-drag-item`, and a drag
 * starts only from an element marked `data-drag-handle` inside one, so the
 * rest of a row (its inputs, its text) works as before. The handle needs
 * `touch-action: none`, or a phone scrolls the page instead of dragging.
 *
 * The rows are reordered while the drag goes on -- `onmove` is called each
 * time the dragged row passes another, and the list is expected to re-render
 * in the new order -- so what is on screen is always what will be saved.
 * The dragged row carries `data-dragging` for as long as it is held.
 *
 * @param onmove Moves the row at `from` to `to`.
 */
export function dragReorder(
  onmove: (from: number, to: number) => void,
): Attachment<HTMLElement> {
  return list => {
    let drag: {pointerId: number; row: HTMLElement; y: number} | null = null;
    let frame = 0;

    const rows = () =>
      Array.from(list.children).filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement && child.dataset.dragItem !== undefined,
      );

    /** Moves the dragged row to wherever the pointer now is. */
    function follow() {
      if (!drag) return;
      const all = rows();
      const from = all.indexOf(drag.row);
      if (from < 0) return;
      const midpoints = all
        .filter(row => row !== drag?.row)
        .map(row => {
          const rect = row.getBoundingClientRect();
          return rect.top + rect.height / 2;
        });
      const to = dropIndex(midpoints, drag.y);
      if (to !== from) onmove(from, to);
    }

    /** Scrolls while the dragged row is held near the viewport's edge. */
    function autoscroll() {
      if (!drag) return;
      const bottomEdge = window.innerHeight - AUTOSCROLL_EDGE_PX;
      let step = 0;
      if (drag.y < AUTOSCROLL_EDGE_PX) {
        step = -Math.ceil((AUTOSCROLL_EDGE_PX - drag.y) / 4);
      } else if (drag.y > bottomEdge) {
        step = Math.ceil((drag.y - bottomEdge) / 4);
      }
      if (step !== 0) {
        window.scrollBy(0, step);
        follow();
      }
      frame = requestAnimationFrame(autoscroll);
    }

    function onpointermove(event: PointerEvent) {
      if (event.pointerId !== drag?.pointerId) return;
      drag.y = event.clientY;
      follow();
    }

    function stop(event: PointerEvent) {
      if (event.pointerId !== drag?.pointerId) return;
      end();
    }

    function end() {
      if (!drag) return;
      delete drag.row.dataset.dragging;
      drag = null;
      cancelAnimationFrame(frame);
      // The moves are listened for on the window rather than through pointer
      // capture: re-rendering the list moves the rows around the document,
      // which would release a capture held by the handle mid-drag.
      window.removeEventListener('pointermove', onpointermove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    }

    function onpointerdown(event: PointerEvent) {
      if (drag || !event.isPrimary || event.button !== 0) return;
      const handle =
        event.target instanceof Element
          ? event.target.closest('[data-drag-handle]')
          : null;
      const row = handle?.closest<HTMLElement>('[data-drag-item]');
      if (!row || row.parentElement !== list) return;
      // Keeps a mouse drag from selecting the text it passes over.
      event.preventDefault();
      drag = {pointerId: event.pointerId, row, y: event.clientY};
      row.dataset.dragging = '';
      window.addEventListener('pointermove', onpointermove);
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
      frame = requestAnimationFrame(autoscroll);
    }

    list.addEventListener('pointerdown', onpointerdown);
    return () => {
      list.removeEventListener('pointerdown', onpointerdown);
      end();
    };
  };
}
