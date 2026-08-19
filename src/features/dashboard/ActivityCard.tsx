import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button, Card, SectionHeader, StatTile, useTheme } from '@/ui';
import { healthPlatformLabel, type HealthDaySyncResult } from '@/services/health';
import type { ExerciseEntry } from '@/types';

import { DashText } from './dashboardText';
import { formatNumber } from './useDashboardData';

/** Latest `syncHealthDay` payload rendered by the activity card. */
export type HealthSnapshot = HealthDaySyncResult;

interface ActivityCardProps {
  exercises: ExerciseEntry[];
  /** Calories burned for the day, taken straight from the domain summary. */
  exerciseBurned: number;
  health: HealthSnapshot | null;
  healthEnabled: boolean;
  syncing: boolean;
  syncError: string | null;
  onSync: () => void;
  onOpenSettings: () => void;
  onOpenActivity: () => void;
}

export function ActivityCard({
  exercises,
  exerciseBurned,
  health,
  healthEnabled,
  syncing,
  syncError,
  onSync,
  onOpenSettings,
  onOpenActivity,
}: ActivityCardProps) {
  const { colors, spacing, radius } = useTheme();

  const platform = useMemo(() => {
    try {
      return healthPlatformLabel();
    } catch {
      return 'Health';
    }
  }, []);

  const exerciseMinutes = useMemo(
    () =>
      exercises.reduce(
        (total, entry) => total + (Number.isFinite(entry.durationMin) ? entry.durationMin : 0),
        0
      ),
    [exercises]
  );

  if (!healthEnabled) {
    return (
      <Card>
        <SectionHeader title="Activity" />
        <View style={[styles.promptRow, { marginTop: spacing.sm }]}>
          <View
            style={[
              styles.iconWrap,
              { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill },
            ]}
          >
            <Ionicons name="heart-outline" size={18} color={colors.textMuted} />
          </View>
          <View style={styles.promptCopy}>
            <DashText variant="body" color={colors.text}>
              {`Connect ${platform}`}
            </DashText>
            <DashText variant="caption" color={colors.textMuted}>
              Import steps, workouts and active energy automatically.
            </DashText>
          </View>
        </View>
        <View style={{ marginTop: spacing.md }}>
          <Button title="Health settings" onPress={onOpenSettings} variant="secondary" size="sm" />
        </View>
        <View style={{ marginTop: spacing.sm }}>
          <DashText variant="micro" color={colors.textFaint}>
            {`${exerciseMinutes} min logged manually · ${formatNumber(exerciseBurned)} kcal burned`}
          </DashText>
        </View>
      </Card>
    );
  }

  return (
    <Card>
      <SectionHeader
        title="Activity"
        right={
          <Button
            title={syncing ? 'Syncing' : 'Sync'}
            onPress={onSync}
            variant="ghost"
            size="sm"
            loading={syncing}
            disabled={syncing}
          />
        }
      />

      <View style={[styles.tiles, { marginTop: spacing.sm, gap: spacing.sm }]}>
        <View style={styles.tile}>
          <StatTile
            label="Steps"
            value={formatNumber(health?.steps ?? 0)}
            icon="footsteps-outline"
            color={colors.primary}
            onPress={onOpenActivity}
          />
        </View>
        <View style={styles.tile}>
          <StatTile
            label="Active"
            value={formatNumber(health?.activeEnergyKcal ?? 0)}
            sublabel="kcal"
            icon="flame-outline"
            color={colors.calories}
            onPress={onOpenActivity}
          />
        </View>
        <View style={styles.tile}>
          <StatTile
            label="Exercise"
            value={formatNumber(exerciseMinutes)}
            sublabel="min"
            icon="barbell-outline"
            color={colors.success}
            onPress={onOpenActivity}
          />
        </View>
      </View>

      <DashText variant="micro" color={colors.textFaint} style={{ marginTop: spacing.md }}>
        {health
          ? `${platform} · ${health.importedWorkouts} ${
              health.importedWorkouts === 1 ? 'workout' : 'workouts'
            } imported`
          : `${platform} · pull to refresh to sync`}
      </DashText>

      {syncError ? (
        <DashText variant="micro" color={colors.danger} style={{ marginTop: spacing.xs }}>
          {syncError}
        </DashText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row' },
  tile: { flex: 1 },
  promptRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  promptCopy: { flex: 1, gap: 2 },
  iconWrap: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
});
