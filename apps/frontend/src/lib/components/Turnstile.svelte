<script lang="ts">
  import {onMount} from 'svelte';
  import {env} from '$env/dynamic/public';

  // Cloudflare's widget, which the two endpoints that mail an address of the
  // caller's choosing are behind (#116). It writes its token into a hidden
  // control named `cf-turnstile-response` inside the enclosing form, which is
  // what the page's action forwards to the API.
  //
  // Read at render time rather than through `$env/static/public` so that one
  // build can be deployed to staging and production with different site keys.
  const siteKey = env.PUBLIC_TURNSTILE_SITE_KEY;

  let container: HTMLDivElement | undefined = $state();
  // What `reset()` names the widget by. Only the explicit render below hands
  // one back; after an implicit render there is none, and the container
  // element identifies the widget instead -- Turnstile takes either.
  let widgetId: string | undefined;

  onMount(() => {
    // Two ways in, because neither covers the other. On a full page load the
    // API script finds this container by its class and renders into it on its
    // own ("implicit rendering") -- which is also what makes the form
    // submittable before the client bundle has taken over, the way the rest
    // of it is (#95). But that scan happens once, when the script loads, so a
    // client-side navigation onto this page arrives with the script long
    // since loaded and this container never seen. Rendering it by hand is
    // what covers that case; a container the scan already filled is left
    // alone.
    if (!siteKey || !container || container.childElementCount > 0) return;
    widgetId = window.turnstile?.render(container, {sitekey: siteKey});
  });

  /**
   * Puts a fresh, unspent challenge in front of the participant.
   *
   * A token is single-use: the API redeems it at siteverify, and sending the
   * same one again is answered `timeout-or-duplicate`. Every form this widget
   * sits in submits with `use:enhance` and reports its refusals with
   * `fail()`, which re-renders the page in place rather than reloading it --
   * so after a rejected submission the hidden control still holds the token
   * that was just spent, and nothing else would clear it. Retrying with it
   * fails the challenge instead of failing on whatever the participant
   * actually has to fix, and the 429 message that invites a retry could
   * never be acted on at all. Callers reset from their `enhance` callback.
   */
  export function reset() {
    const widget = widgetId ?? container;
    if (!widget) return;
    window.turnstile?.reset(widget);
  }
</script>

<!-- Without a site key there is nothing to render, and no token is sent. The
     API refuses such a submission (it verifies every token server-side and
     fails closed), so this is a missing-configuration failure, not a way
     around the challenge. -->
<svelte:head>
  {#if siteKey}
    <script
      src="https://challenges.cloudflare.com/turnstile/v0/api.js"
      async
      defer
    ></script>
  {/if}
</svelte:head>

{#if siteKey}
  <div class="cf-turnstile" data-sitekey={siteKey} bind:this={container}></div>
{/if}
