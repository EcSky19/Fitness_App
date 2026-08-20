/**
 * Connect / troubleshoot card shown while the phone's health app is not wired up.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { HealthPermissionStatus } from '@/types';
import { Button, Card, useTheme } from '@/ui';

export interface HealthConnectCardProps {
  platformLabel: string;
  permissions: readonly string[];
  status: HealthPermissionStatus;
  connecting: boolean;
  error?: string | null;
  onConnect: () => void;
  onOpenSettings: () => void;
}

function statusCopy(status: HealthPermissionStatus, platformLabel: string): string {
  switch (status) {
    case 'denied':
      return `${platformLabel} access was turned down. Open your device settings and allow MacroTrack to read your activity, then come back and connect.`;
    case 'unavailable':
      return `${platformLabel} isn't available on this device. Log your workouts by hand instead — everything else works normally, and your burn still counts towards your daily target.`;
    default:
      return `Connect ${platformLabel} to pull in steps, active energy and workouts automatically. You can still log everything by hand.`;
  }
}

export function HealthConnectCard({
  platformLabel,
  permissions,
  status,
  connecting,
  error,
  onConnect,
  onOpenSettings,
}: HealthConnectCardProps): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();
  const list = Array.isArray(permissions) ? permissions : [];
  // Nothing to connect to and nothing will be read, so offering either would
  // promise something this build cannot deliver.
  const unavailable = status === 'unavailable';

  return (
    <Card testID="health-connect-card">
      <Text style={[typography.title, { color: colors.text }]}>
        {unavailable ? `${platformLabel} unavailable` : `Connect ${platformLabel}`}
      </Text>
      <Text style={[typography.body, { color: colors.textMuted, marginTop: spacing.xs }]}>
        {statusCopy(status, platformLabel)}
      </Text>

      {list.length > 0 && !unavailable ? (
        <View style={{ marginTop: spacing.md }}>
          <Text style={[typography.label, { color: colors.textMuted }]}>MacroTrack will read</Text>
          {list.map((permission) => (
            <Text
              key={permission}
              style={[typography.caption, { color: colors.textFaint, marginTop: 2 }]}
            >
              {`• ${permission}`}
            </Text>
          ))}
        </View>
      ) : null}

      {error ? (
        <Text
          style={[typography.caption, { color: colors.danger, marginTop: spacing.sm }]}
          accessibilityRole="alert"
          testID="health-connect-error"
        >
          {error}
        </Text>
      ) : null}

      {unavailable ? null : (
        <View style={[styles.actions, { marginTop: spacing.lg }]}>
          <Button
            title={status === 'denied' ? 'Try again' : 'Connect'}
            onPress={onConnect}
            loading={connecting}
            icon="heart-outline"
            accessibilityLabel={`Connect ${platformLabel}`}
            fullWidth={status !== 'denied'}
          />
          {status === 'denied' ? (
            <Button
              title="Open settings"
              variant="secondary"
              onPress={onOpenSettings}
              accessibilityLabel="Open device settings"
            />
          ) : null}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});

export default HealthConnectCard;
