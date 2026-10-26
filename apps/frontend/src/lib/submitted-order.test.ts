import {describe, expect, it} from 'vitest';
import {sortBySubmittedOrder} from './submitted-order';

/** Rows `a`, `b`, `c`... with the given "表示順" values, in rendered order. */
function rows(...orders: string[]) {
  return orders.map((order, index) => ({
    index,
    order,
    value: String.fromCharCode(97 + index),
  }));
}

describe('sortBySubmittedOrder', () => {
  it('keeps the rendered order when no number was changed', () => {
    expect(sortBySubmittedOrder(rows('1', '2', '3'))).toEqual(['a', 'b', 'c']);
  });

  it('moves a row to the front when 1 is typed into it', () => {
    expect(sortBySubmittedOrder(rows('1', '2', '1'))).toEqual(['c', 'a', 'b']);
  });

  it('moves a row to the end when a larger number is typed into it', () => {
    expect(sortBySubmittedOrder(rows('9', '2', '3'))).toEqual(['b', 'c', 'a']);
  });

  it('puts a row at exactly the position typed into it', () => {
    // Every move of one row among three, from the numbers 1, 2, 3.
    const cases: Array<[string[], string[]]> = [
      [
        ['2', '2', '3'],
        ['b', 'a', 'c'],
      ],
      [
        ['3', '2', '3'],
        ['b', 'c', 'a'],
      ],
      [
        ['1', '1', '3'],
        ['b', 'a', 'c'],
      ],
      [
        ['1', '3', '3'],
        ['a', 'c', 'b'],
      ],
      [
        ['1', '2', '1'],
        ['c', 'a', 'b'],
      ],
      [
        ['1', '2', '2'],
        ['a', 'c', 'b'],
      ],
    ];
    for (const [orders, expected] of cases) {
      expect(sortBySubmittedOrder(rows(...orders))).toEqual(expected);
    }
  });

  it('keeps a row in place when its number is blank or not a number', () => {
    expect(sortBySubmittedOrder(rows('', 'x', '3'))).toEqual(['a', 'b', 'c']);
  });

  it('does not depend on the order the rows were read in', () => {
    expect(sortBySubmittedOrder(rows('1', '2', '1').reverse())).toEqual([
      'c',
      'a',
      'b',
    ]);
  });
});
