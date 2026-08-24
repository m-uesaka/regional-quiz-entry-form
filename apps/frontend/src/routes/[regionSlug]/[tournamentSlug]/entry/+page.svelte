<script lang="ts">
  import type {PageProps} from './$types';

  // Placeholder only — the actual entry form (dynamic fields, regulation
  // picker, submission flow) is out of scope for this issue. This page
  // exists so the route resolves and its `load` function's access control
  // can be exercised.
  const {data}: PageProps = $props();
</script>

<h1>{data.tournament.name}</h1>
