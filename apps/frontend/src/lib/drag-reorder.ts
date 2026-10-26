import type {Attachment} from 'svelte/attachments';

/**
 * How close to the top or bottom of the viewport, in CSS pixels, a dragged
 * row has to be held for the page to scroll -- the only way to drag a row
 * past the screen's edge on a phone, where there is no wheel to scroll with.
 */
const AUTOSCROLL_EDGE_PX = 64;

/**
 * How far, in CSS pixels, a pointer has to travel before a press on a handle
 * becomes a drag, so a tap that wobbles a little moves nothing.
 */
const DRAG_THRESHOLD_PX = 4;

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
    let drag: {
      pointerId: number;
      row: HTMLElement;
      startY: number;
      y: number;
      // Whether the pointer has gone further than a tap's wobble yet.
      moving: boolean;
    } | null = null;
    let frame = 0;

    const rows = () => childRows(list);

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

    /**
     * How far to scroll this frame: towards the edge the dragged row is
     * held at, faster the closer it is, or 0 away from both edges.
     */
    function scrollStep(): number {
      if (!drag?.moving) return 0;
      const bottomEdge = window.innerHeight - AUTOSCROLL_EDGE_PX;
      if (drag.y < AUTOSCROLL_EDGE_PX) {
        return -Math.ceil((AUTOSCROLL_EDGE_PX - drag.y) / 4);
      }
      if (drag.y > bottomEdge) {
        return Math.ceil((drag.y - bottomEdge) / 4);
      }
      return 0;
    }

    /**
     * Scrolls a frame at a time while the dragged row is held near the
     * viewport's edge, and stops as soon as it isn't.
     */
    function autoscroll() {
      const step = scrollStep();
      if (step === 0) {
        frame = 0;
        return;
      }
      window.scrollBy(0, step);
      follow();
      frame = requestAnimationFrame(autoscroll);
    }

    function onpointermove(event: PointerEvent) {
      if (event.pointerId !== drag?.pointerId) return;
      drag.y = event.clientY;
      // Nothing moves, and nothing scrolls, until the pointer does: a handle
      // that is only touched -- one near the bottom of a phone's screen,
      // say -- leaves the list as it was.
      if (!drag.moving) {
        if (Math.abs(drag.y - drag.startY) < DRAG_THRESHOLD_PX) return;
        drag.moving = true;
      }
      follow();
      if (frame === 0 && scrollStep() !== 0) {
        frame = requestAnimationFrame(autoscroll);
      }
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
      frame = 0;
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
      // Keeps a mouse drag from selecting the text it passes over -- which
      // also keeps focus where it was, so it is let go of here instead: a
      // field still being typed in would keep a phone's keyboard over half
      // the screen the row is dragged across.
      event.preventDefault();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      drag = {
        pointerId: event.pointerId,
        row,
        startY: event.clientY,
        y: event.clientY,
        moving: false,
      };
      row.dataset.dragging = '';
      window.addEventListener('pointermove', onpointermove);
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
    }

    list.addEventListener('pointerdown', onpointerdown);
    return () => {
      list.removeEventListener('pointerdown', onpointerdown);
      end();
    };
  };
}

/**
 * Sets every row's "表示順" control to the row's position on screen, 1 for
 * the first. Called after a row is moved by dragging or by its buttons, so
 * the numbers submitted are always the order shown: a number typed in by
 * hand would otherwise survive on a row the move left where it was -- and
 * be saved as typed -- while being dropped on one it shifted.
 *
 * The controls are found by `data-reorder-position` within each of the
 * list's `data-drag-item` children.
 *
 * @param list The element the rows are the children of.
 */
export function renumberRows(list: HTMLElement): void {
  const rows = childRows(list);
  for (const [index, row] of rows.entries()) {
    const control = row.querySelector<HTMLInputElement>(
      'input[data-reorder-position]',
    );
    if (control) control.value = String(index + 1);
  }
}

/**
 * The rows of a reorderable list: its children marked `data-drag-item`.
 * @param list The element the rows are the children of.
 */
function childRows(list: HTMLElement): HTMLElement[] {
  return Array.from(list.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.dataset.dragItem !== undefined,
  );
}
