import {describe, expect, it} from 'vitest';
import {EntryStatusSchema} from '@regional-quiz/shared';
import {ENTRY_STATUS_CHIP_VARIANT} from './entry-status';

describe('ENTRY_STATUS_CHIP_VARIANT', () => {
  it('gives every entry status a colour', () => {
    for (const status of EntryStatusSchema.options) {
      expect(ENTRY_STATUS_CHIP_VARIANT[status]).toBeDefined();
    }
  });

  it('tells confirmed, waitlisted and cancelled entries apart', () => {
    expect(ENTRY_STATUS_CHIP_VARIANT.confirmed).toBe('success');
    expect(ENTRY_STATUS_CHIP_VARIANT.waitlisted).toBe('warning');
    expect(ENTRY_STATUS_CHIP_VARIANT.cancelled).toBe('secondary');
  });
});
