import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { Button } from '@/ui';

describe('Button', () => {
  it('renders its title and fires onPress', () => {
    const onPress = jest.fn();
    render(<Button title="Save entry" onPress={onPress} />);

    expect(screen.getByText('Save entry')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Save entry' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire while loading', () => {
    const onPress = jest.fn();
    render(<Button title="Save entry" onPress={onPress} loading />);

    fireEvent.press(screen.getByRole('button', { name: 'Save entry' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('does not fire while disabled', () => {
    const onPress = jest.fn();
    render(<Button title="Save entry" onPress={onPress} disabled />);

    fireEvent.press(screen.getByRole('button', { name: 'Save entry' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('marks the accessibility state as busy while loading', () => {
    render(<Button title="Save entry" onPress={jest.fn()} loading />);
    const button = screen.getByRole('button', { name: 'Save entry' });
    expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  });

  it('renders every variant and size without crashing', () => {
    const variants = ['primary', 'secondary', 'ghost', 'danger'] as const;
    const sizes = ['sm', 'md', 'lg'] as const;

    for (const variant of variants) {
      for (const size of sizes) {
        const view = render(
          <Button
            title={`${variant}-${size}`}
            onPress={jest.fn()}
            variant={variant}
            size={size}
            icon="add"
            fullWidth
          />
        );
        expect(view.getByText(`${variant}-${size}`)).toBeTruthy();
        view.unmount();
      }
    }
  });
});
