import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import FieldError from './FieldError.svelte';

describe('FieldError', () => {
  it('renders nothing while there is no message', () => {
    const {container} = render(FieldError, {props: {id: 'name-error'}});

    expect(container.querySelector('p')).toBeNull();
  });

  it('shows the message under the id it was given', () => {
    render(FieldError, {props: {error: '入力してください', id: 'name-error'}});

    const message = screen.getByText('入力してください');
    expect(message).toHaveAttribute('id', 'name-error');
    expect(message).toHaveClass('text-sm', 'text-destructive');
  });

  it('is not an alert unless asked to be', () => {
    render(FieldError, {props: {error: '入力してください'}});

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('can be an alert', () => {
    render(FieldError, {props: {error: '入力してください', role: 'alert'}});

    expect(screen.getByRole('alert')).toHaveTextContent('入力してください');
  });
});
