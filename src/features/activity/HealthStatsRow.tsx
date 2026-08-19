/**
 * Connected-state health panel: the day's stats plus sync controls.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatDistanceToNowStrict } from 'date-fns';

import type { HealthDaySummary } from '@/types';
import { Button, Card, StatTile, useTheme } from '@/ui';

export interface HealthStatsRowProps {
  platformLabel: string;
  summary: HealthDaySummary | null;
  lastSyncedAt: string | null;
  syncing: boolean;
  error?: string | null;
  onSync: () => void;
}

function formatLastSynced(iso: string | null): string {
  if (!iso) return 'Not synced yet';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Not synced yet';
  try {
    return `Last synced ${formatDistanceToNowStrict(date, { addSuffix: true })}`;
  } catch {
    return 'Last synced just now';
  }
}

function formatDistance(meters: number): string {
  if (!meters || meters <= 0) return '0.0';
  return (meters / 1000).toFixed(1);
}

export function HealthStatsRow({
  platformLabel,
  summary,
  lastSyncedAt,
  syncing,
  error,
  onSync,
}: HealthStatsRowProps): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();

  return (
    <Card testID="health-stats-card">
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[typography.title, { color: colors.text }]}>{platformLabel}</Text>
          <Text style={[typography.caption, { color: colors.textMuted }]} testID="health-last-synced">
            {formatLastSynced(lastSyncedAt)}
          </Text>
        </View>
        <Button
          title="Sync now"
          variant="secondary"
          size="sm"
          icon="sync"
          loading={syncing}
          onPress={onSync}
          accessibilityLabel="Sync health data now"
        />
      </View>

      {error ? (
        <Text
          style={[typography.caption, { color: colors.danger, marginTop: spacing.sm }]}
          accessibilityRole="alert"
          testID="health-sync-error"
        >
          {error}
        </Text>
      ) : null}

      <View style={[styles.tiles, { marginTop: spacing.md }]}>
        <StatTile
          label="Steps"
          value={Math.round(summary?.steps ?? 0).toLocaleString()}
          icon="footsteps"
          color={colors.primary}
          style={styles.tile}
        />
        <StatTile
          label="Active energy"
          value={Math.round(summary?.activeEnergyKcal ?? 0)}
          sublabel="kcal"
          icon="flame"
          color={colors.calories}
          style={styles.tile}
        />
        <StatTile
          label="Exercise"
          value={Math.round(summary?.exerciseMinutes ?? 0)}
          sublabel="min"
          icon="timer"
          color={colors.carbs}
          style={styles.tile}
        />
        <StatTile
          label="Distance"
          value={formatDistance(summary?.distanceMeters ?? 0)}
          sublabel="km"
          icon="map"
          color={colors.fat}
          style={styles.tile}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerText: { flex: 1 },
  tile: { flexGrow: 1, flexBasis: '47%' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});

export default HealthStatsRow;
