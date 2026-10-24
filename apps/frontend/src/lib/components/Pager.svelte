<!--
@component
Previous / next links and the "n 件中 m〜k 件" range for one page of a
paginated backend list. Plain links, so paging works without JavaScript and
each page has its own URL; the page's `load` reads the offset back off it.
-->
<script lang="ts">
  import Link from '$lib/components/ui/atoms/Link.svelte';

  interface Props {
    /** Rows the whole list has. */
    total: number;
    /** Rows per page. */
    limit: number;
    /** Rows before this page. */
    offset: number;
    /** The `href` of the page starting at the given offset. */
    hrefFor: (offset: number) => string;
  }

  let {total, limit, offset, hrefFor}: Props = $props();

  const hasPrevious = $derived(offset > 0);
  const hasNext = $derived(offset + limit < total);
  // Past the last row (a stale link) the page is empty; say so instead of
  // a backwards range such as "301〜300".
  const rangeLabel = $derived(
    offset < total
      ? `${total} 件中 ${offset + 1}〜${Math.min(offset + limit, total)} 件`
      : `${total} 件`,
  );
</script>

<nav aria-label="ページ送り" class="flex items-center justify-between gap-4 text-sm">
  <Link
    href={hrefFor(Math.max(offset - limit, 0))}
    disabled={!hasPrevious}
    rel="prev"
  >
    前へ
  </Link>
  <span class="text-muted-foreground">{rangeLabel}</span>
  <Link
    href={hrefFor(offset + limit)}
    disabled={!hasNext}
    rel="next"
  >
    次へ
  </Link>
</nav>
