import {describe, expect, it} from 'bun:test';
import {
  NO_LASTING_REGULATION_MESSAGE,
  REGULATION_LABEL_MAX_LENGTH,
  RegulationSyncInputSchema,
  RegulationUpsertSchema,
} from './regulation';

describe('RegulationUpsertSchema', () => {
  // Some regions' conditions run long (the limit was 200 before).
  it('accepts a label of up to 400 characters and refuses a longer one', () => {
    expect(REGULATION_LABEL_MAX_LENGTH).toBe(400);
    expect(
      RegulationUpsertSchema.safeParse({label: 'あ'.repeat(400)}).success,
    ).toBe(true);
    expect(
      RegulationUpsertSchema.safeParse({label: 'あ'.repeat(401)}).success,
    ).toBe(false);
  });

  // Trimmed as the regulation sheet's cells are (#300).
  it('trims the label and refuses one that is only spaces', () => {
    expect(RegulationUpsertSchema.parse({label: ' 一般の部\u3000'}).label).toBe(
      '一般の部',
    );
    expect(RegulationUpsertSchema.safeParse({label: '  '}).success).toBe(false);
  });

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

  // "As stored", which `sync_regulations()` is what keeps: a default here
  // would overwrite the value 0042 worked out.
  it('leaves closesWithPriority undefined when it is omitted', () => {
    const result = RegulationSyncInputSchema.parse({
      regulations: [{label: '一般の部'}],
    });

    expect(result.regulations[0].closesWithPriority).toBeUndefined();
  });

  it('rejects closesWithPriority on a regulation with no window', () => {
    const result = RegulationSyncInputSchema.safeParse({
      regulations: [{label: '一般の部', closesWithPriority: true}],
    });

    expect(result.success).toBe(false);
  });

  // Once the marked phases are over, nothing would be left to choose.
  it('rejects a set where every regulation closes', () => {
    const window = {
      priorityStartsAt: '2026-11-01T00:00:00Z',
      priorityEndsAt: '2026-11-05T00:00:00Z',
    };
    const result = RegulationSyncInputSchema.safeParse({
      regulations: [
        {label: '第1次優先', ...window, closesWithPriority: true},
        {label: '第2次優先', ...window, closesWithPriority: true},
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      NO_LASTING_REGULATION_MESSAGE,
    );
  });

  // An omitted value may be a stored true, which `sync_regulations()`
  // checks; the schema can only refuse what it is sent.
  it('accepts a set whose only other regulation omits the setting', () => {
    const result = RegulationSyncInputSchema.safeParse({
      regulations: [
        {
          label: '優先',
          priorityStartsAt: '2026-11-01T00:00:00Z',
          priorityEndsAt: '2026-11-05T00:00:00Z',
          closesWithPriority: true,
        },
        {label: '一般の部'},
      ],
    });

    expect(result.success).toBe(true);
  });

  it('accepts several new regulations, which carry no ids at all', () => {
    const result = RegulationSyncInputSchema.safeParse({
      regulations: [{label: '一般の部'}, {label: '学生の部'}],
    });

    expect(result.success).toBe(true);
  });
});
