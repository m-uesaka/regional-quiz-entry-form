import {describe, expect, it} from 'bun:test';
import {RegulationSyncInputSchema, RegulationUpsertSchema} from './regulation';

describe('RegulationUpsertSchema', () => {
  it('accepts a new regulation without an id or a priority window', () => {
    const result = RegulationUpsertSchema.safeParse({label: '一般の部'});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        label: '一般の部',
        priorityStartsAt: null,
        priorityEndsAt: null,
      });
    }
  });

  it('rejects a priority window with only one endpoint', () => {
    const result = RegulationUpsertSchema.safeParse({
      label: '優先の部',
      priorityStartsAt: '2026-01-01T00:00:00Z',
      priorityEndsAt: null,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['priorityEndsAt']);
    }
  });

  it('rejects a priority window that ends before it starts', () => {
    const result = RegulationUpsertSchema.safeParse({
      label: '優先の部',
      priorityStartsAt: '2026-01-08T00:00:00Z',
      priorityEndsAt: '2026-01-01T00:00:00Z',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['priorityEndsAt']);
    }
  });

  it('rejects a zero-length priority window', () => {
    const result = RegulationUpsertSchema.safeParse({
      label: '優先の部',
      priorityStartsAt: '2026-01-01T00:00:00Z',
      priorityEndsAt: '2026-01-01T00:00:00Z',
    });

    expect(result.success).toBe(false);
  });
});

describe('RegulationSyncInputSchema', () => {
  it('rejects an empty regulation list', () => {
    const result = RegulationSyncInputSchema.safeParse({regulations: []});

    expect(result.success).toBe(false);
  });

  it('rejects the same id twice', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const result = RegulationSyncInputSchema.safeParse({
      regulations: [
        {id, label: '一般の部'},
        {id, label: '学生の部'},
      ],
    });

    expect(result.success).toBe(false);
  });

  it('accepts several new regulations, which carry no ids at all', () => {
    const result = RegulationSyncInputSchema.safeParse({
      regulations: [{label: '一般の部'}, {label: '学生の部'}],
    });

    expect(result.success).toBe(true);
  });
});
