/**
 * Robustness of the shared UI kit against real-world input and real-world
 * users: overlong content from a food/barcode database, and screen-reader
 * feedback for form validation.
 */
import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';

import { ListRow, NumberField, StatTile, TextField } from '@/ui';

function flatStyle(node: { props: { style?: unknown } }): Record<string, unknown> {
  return (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* StatTile                                                                    */
/* -------------------------------------------------------------------------- */

describe('StatTile', () => {
  it('lets a long label shrink instead of overflowing the tile', () => {
    // "Active energy" already ships in HealthStatsRow; at 150%+ font scale the
    // caption is wider than the tile. Without flexShrink the icon+label row
    // keeps the label at its full intrinsic width and it spills past the tile
    // onto the neighbour — ListRow's text column avoids this the same way.
    render(<StatTile label="Active energy burned" value="487" icon="flame" testID="tile" />);

    const label = screen.getByText('Active energy burned');
    expect(label.props.numberOfLines).toBe(1);
    expect(flatStyle(label as never).flexShrink).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Field error announcements                                                   */
/* -------------------------------------------------------------------------- */

describe('field error announcements', () => {
  it('TextField announces its validation error to screen readers', () => {
    render(<TextField label="Name" value="" onChangeText={jest.fn()} error="Name is required" />);

    // The error otherwise reaches a sighted user only as a red border + text,
    // which a blind user never gets. HealthStatsRow already flags its errors
    // with accessibilityRole="alert"; form fields must do the same.
    expect(screen.getByText('Name is required').props.accessibilityRole).toBe('alert');
  });

  it('NumberField announces its validation error to screen readers', () => {
    render(<NumberField label="Grams" value={null} onChange={jest.fn()} error="Too high" />);

    expect(screen.getByText('Too high').props.accessibilityRole).toBe('alert');
  });
});

/* -------------------------------------------------------------------------- */
/* Composed accessibility labels                                               */
/* -------------------------------------------------------------------------- */

describe('non-pressable rows and tiles', () => {
  // Both build a combined label ("Greek yogurt, 200 g, 180 kcal"). iOS only
  // reads it when the container is a single accessibility element; otherwise
  // the label is ignored and the children are announced one by one.
  it('StatTile exposes its composed label as one element', () => {
    render(<StatTile label="Active energy" value="487 kcal" testID="tile" />);

    const tile = screen.getByTestId('tile');
    expect(tile.props.accessible).toBe(true);
    expect(tile.props.accessibilityLabel).toBe('Active energy, 487 kcal');
  });

  it('ListRow exposes its composed label as one element', () => {
    render(<ListRow title="Greek yogurt" subtitle="200 g" meta="180 kcal" testID="row" />);

    const row = screen.getByTestId('row');
    expect(row.props.accessible).toBe(true);
    expect(row.props.accessibilityLabel).toBe('Greek yogurt, 200 g, 180 kcal');
  });
});
