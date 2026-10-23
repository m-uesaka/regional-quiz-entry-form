<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>地域クイズ最強位・新人王 エントリー</title>
</svelte:head>

<div class="flex min-h-screen flex-col">
	<header class="border-b border-border bg-surface">
		<div class="mx-auto flex h-14 max-w-5xl items-center px-4">
			<a href="/" class="text-base font-bold text-foreground hover:opacity-80">
				地域クイズ最強位・新人王 エントリー
			</a>
		</div>
	</header>

	<div class="flex-1">
		{@render children()}
	</div>

	<footer class="border-t border-border bg-surface">
		<div class="mx-auto max-w-5xl px-4 py-4 text-xs text-muted-foreground">
			地域クイズ最強位・新人王
		</div>
	</footer>
</div>
