import {render, screen} from '@testing-library/svelte';
import {describe, expect, it, vi} from 'vitest';
import PasswordRequirements from './PasswordRequirements.svelte';

// The list's chunk failing to load: a deploy replaced it while the page was
// open, or the connection dropped. Kept to a file of its own, since the mock
// applies to the whole file.
vi.mock('@regional-quiz/shared/common-passwords', () => {
  throw new Error('failed to fetch dynamically imported module');
});

describe('PasswordRequirements without the common-password list', () => {
  it('leaves that rule to the server instead of checking forever', async () => {
    render(PasswordRequirements, {props: {password: 'violet-harbor-lantern'}});

    expect(
      await screen.findByText(
        'よく使われているパスワードかどうかは、送信時に確認されます',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('8文字以上').closest('li')).toHaveTextContent(
      '満たしています',
    );
  });
});
