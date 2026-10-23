import type {EntryStatus} from '@regional-quiz/shared';
import type {ChipVariants} from '$lib/components/ui/atoms/Chip.svelte';

/**
 * The `Chip` colour each entry status is shown in, so the staff entry list
 * and the entry detail page agree. Keyed on every status, so adding one to
 * `EntryStatusSchema` fails the typecheck here until it is given a colour.
 */
export const ENTRY_STATUS_CHIP_VARIANT: Record<
  EntryStatus,
  NonNullable<ChipVariants['variant']>
> = {
  pending_verification: 'primary',
  confirmed: 'success',
  waitlisted: 'warning',
  cancelled: 'secondary',
};
