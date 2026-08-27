<script lang="ts">
  import type {PageProps} from './$types';
  let {data}: PageProps = $props();
</script>

<h1>エントリーの確認</h1>

{#if data.status === 'confirmed'}
  <p>エントリーが確定しました。</p>
  <p>大会当日の詳細は、後日あらためてご連絡します。</p>
{:else if data.status === 'waitlisted'}
  <p>定員に達していたため、キャンセル待ちになりました。</p>
  <!-- The position isn't in this endpoint's response; mypage lists it
       alongside the entry, so that's where the participant is sent for it. -->
  <p>キャンセル待ちの順位はマイページから確認できます。</p>
  <p>空きが出た場合は、順番に繰り上げのうえご連絡します。</p>
{:else}
  <p>この確認リンクは無効です。</p>
  <p>
    リンクの有効期限(24時間)が切れているか、すでに使用済みの可能性があります。
  </p>
  <!-- Which tournament the token belonged to isn't recoverable from an
       invalid token, so re-entry is guided through mypage rather than a
       direct link to the entry form. -->
  <p>
    すでにエントリーが確定している場合もあるため、まずはマイページ(閲覧にはログインが必要です)でエントリー状況をご確認ください。エントリーが残っていない場合は、大会のエントリーフォームからあらためてエントリーしてください。
  </p>
{/if}

<p><a href="/mypage">マイページへ</a></p>
<!-- Entry creation doesn't start a participant session, so a participant
     arriving from the confirmation mail is usually logged out and will be
     sent to /mypage/login first. -->
<p>
  マイページの閲覧にはログインが必要です。ログインしていない場合はログイン画面に移動します。
</p>
