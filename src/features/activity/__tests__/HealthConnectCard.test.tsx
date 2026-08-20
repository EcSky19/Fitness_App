/**
 * The unavailable state is the one a shipped build without a native health
 * library actually shows, so it has to be honest: no Connect button that
 * cannot connect, and no list of data the app will never read.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { HealthConnectCard } from '../HealthConnectCard';

const PERMISSIONS = ['Steps', 'Active energy burned', 'Workouts'];

function renderCard(
  overrides: Partial<React.ComponentProps<typeof HealthConnectCard>> = {}
): { onConnect: jest.Mock; onOpenSettings: jest.Mock } {
  const onConnect = jest.fn();
  const onOpenSettings = jest.fn();
  render(
    <HealthConnectCard
      platformLabel="Health sync"
      permissions={PERMISSIONS}
      status="unavailable"
      connecting={false}
      onConnect={onConnect}
      onOpenSettings={onOpenSettings}
      {...overrides}
    />
  );
  return { onConnect, onOpenSettings };
}

describe('HealthConnectCard — unavailable', () => {
  it('does not offer a Connect button there is nothing to connect to', () => {
    renderCard();

    expect(screen.queryByText('Connect')).toBeNull();
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('does not list data it will never read', () => {
    renderCard();

    expect(screen.queryByText('MacroTrack will read')).toBeNull();
    expect(screen.queryByText('• Steps')).toBeNull();
  });

  it('never promises simulated data to the user', () => {
    renderCard();

    expect(screen.queryByText(/simulated/i)).toBeNull();
  });

  it('points the user at manual logging instead', () => {
    renderCard();

    expect(screen.getByText(/log your workouts by hand/i)).toBeTruthy();
    expect(screen.getByText('Health sync unavailable')).toBeTruthy();
  });
});

describe('HealthConnectCard — connectable states', () => {
  it('still offers Connect when a real platform is present', () => {
    renderCard({ platformLabel: 'Apple Health', status: 'undetermined' });

    expect(screen.getByText('Connect Apple Health')).toBeTruthy();
    expect(screen.getByText('MacroTrack will read')).toBeTruthy();
    expect(screen.getByText('• Steps')).toBeTruthy();
  });

  it('offers a retry and a settings shortcut when permission was denied', () => {
    renderCard({ platformLabel: 'Apple Health', status: 'denied' });

    expect(screen.getByText('Try again')).toBeTruthy();
    expect(screen.getByText('Open settings')).toBeTruthy();
  });
});
