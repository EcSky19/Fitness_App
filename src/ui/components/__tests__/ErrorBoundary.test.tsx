import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import { ErrorBoundary } from '../ErrorBoundary';

function ThrowingChild(): React.JSX.Element {
  throw new Error('Render failed');
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy: jest.SpyInstance<void, Parameters<typeof console.error>>;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Text>Healthy screen</Text>
      </ErrorBoundary>
    );

    expect(screen.getByText('Healthy screen')).toBeTruthy();
    expect(screen.queryByTestId('error-boundary-fallback')).toBeNull();
  });

  it('renders the fallback instead of crashing when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    );

    expect(screen.getByTestId('error-boundary-fallback')).toBeTruthy();
    expect(screen.getByText('Sorry, something went wrong.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('shows selectable technical details after expanding them', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    );

    expect(screen.queryByTestId('error-boundary-details')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Show technical details' }));

    expect(screen.getByTestId('error-boundary-details')).toBeTruthy();
    expect(screen.getByText(/Render failed/).props.selectable).toBe(true);
  });

  it('pressing Try again clears the error and re-renders children', () => {
    let shouldThrow = true;

    function RecoverableChild(): React.JSX.Element {
      if (shouldThrow) {
        throw new Error('Temporary render failure');
      }

      return <Text>Recovered screen</Text>;
    }

    render(
      <ErrorBoundary>
        <RecoverableChild />
      </ErrorBoundary>
    );

    expect(screen.getByTestId('error-boundary-fallback')).toBeTruthy();

    shouldThrow = false;
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('Recovered screen')).toBeTruthy();
    expect(screen.queryByTestId('error-boundary-fallback')).toBeNull();
  });

  it('uses a custom fallback when provided', () => {
    render(
      <ErrorBoundary
        fallback={(error, reset) => (
          <>
            <Text>Custom fallback: {error.message}</Text>
            <Text onPress={reset}>Custom reset</Text>
          </>
        )}
      >
        <ThrowingChild />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom fallback: Render failed')).toBeTruthy();
    expect(screen.queryByTestId('error-boundary-fallback')).toBeNull();
  });

  it('invokes onReset when reset is pressed', () => {
    const onReset = jest.fn();
    let shouldThrow = true;

    function RecoverableChild(): React.JSX.Element {
      if (shouldThrow) {
        throw new Error('Temporary render failure');
      }

      return <Text>Reset child</Text>;
    }

    render(
      <ErrorBoundary onReset={onReset}>
        <RecoverableChild />
      </ErrorBoundary>
    );

    shouldThrow = false;
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Reset child')).toBeTruthy();
  });
});
