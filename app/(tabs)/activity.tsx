/**
 * Activity tab — everything that burns calories.
 *
 * Health data is read through `@/services/health`; every call is wrapped so a
 * missing/denied/failing health integration degrades to "manual logging only"
 * instead of breaking the screen.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import {
  deleteExerciseEntry,
  getLatestWeight,
  listExercisesByDate,
  listExercisesByDateRange,
} from '@/db/repositories';
import { formatDateLabel, isFutureISO, lastNDaysISO } from '@/domain';
import { useAsyncData } from '@/hooks/useAsyncData';
import {
  HEALTH_PERMISSIONS,
  getHealthService,
  healthPlatformLabel,
  syncHealthDay,
} from '@/services/health';
import { useAppStore } from '@/store/appStore';
import type {
  ExerciseEntry,
  HealthDaySummary,
  HealthPermissionStatus,
  ISODate,
  UserProfile,
  WeightLog,
} from '@/types';
import { Button, Card, DateStepper, EmptyState, Screen, SectionHeader, useTheme } from '@/ui';

import { BurnSummaryCard } from '@/features/activity/BurnSummaryCard';
import { ExerciseEntryRow } from '@/features/activity/ExerciseEntryRow';
import { HealthConnectCard } from '@/features/activity/HealthConnectCard';
import { HealthStatsRow } from '@/features/activity/HealthStatsRow';
import { LogWorkoutSheet } from '@/features/activity/LogWorkoutSheet';
import { WeeklyBurnCard } from '@/features/activity/WeeklyBurnCard';

interface ActivityData {
  entries: ExerciseEntry[];
  weekEntries: ExerciseEntry[];
  latestWeight: unknown;
}

const EMPTY_DATA: ActivityData = { entries: [], weekEntries: [], latestWeight: null };

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** `getLatestWeight()` may hand back a WeightLog or a plain number. */
function resolveWeightKg(latest: unknown, profile: UserProfile | null): number | null {
  if (typeof latest === 'number' && Number.isFinite(latest) && latest > 0) return latest;
  const log = latest as WeightLog | null;
  if (log && typeof log.weightKg === 'number' && log.weightKg > 0) return log.weightKg;
  const fromProfile = profile?.currentWeightKg;
  return typeof fromProfile === 'number' && fromProfile > 0 ? fromProfile : null;
}

function safeWeekDays(date: ISODate): ISODate[] {
  try {
    const days = lastNDaysISO(7, date);
    if (Array.isArray(days) && days.length > 0) return days;
  } catch {
    // domain not ready — fall through
  }
  return [date];
}

function safeDateLabel(date: ISODate): string {
  try {
    return formatDateLabel(date) || date;
  } catch {
    return date;
  }
}

function safeIsFuture(date: ISODate): boolean {
  try {
    return isFutureISO(date);
  } catch {
    return false;
  }
}

function safePlatformLabel(): string {
  try {
    return healthPlatformLabel() || 'your health app';
  } catch {
    return 'your health app';
  }
}

export default function ActivityScreen(): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();

  const selectedDate = useAppStore((s) => s.selectedDate);
  const setSelectedDate = useAppStore((s) => s.setSelectedDate);
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const invalidate = useAppStore((s) => s.invalidate);
  const profile = useAppStore((s) => s.profile);

  const healthSyncEnabled = settings.healthSyncEnabled;
  const platformLabel = useMemo(() => safePlatformLabel(), []);
  const weekDays = useMemo(() => safeWeekDays(selectedDate), [selectedDate]);
  const weekStart = weekDays[0];

  const loader = useCallback(async (): Promise<ActivityData> => {
    const [entries, weekEntries] = await Promise.all([
      listExercisesByDate(selectedDate),
      listExercisesByDateRange(weekStart, selectedDate),
    ]);
    let latestWeight: unknown = null;
    try {
      latestWeight = await getLatestWeight();
    } catch {
      latestWeight = null;
    }
    return {
      entries: Array.isArray(entries) ? entries : [],
      weekEntries: Array.isArray(weekEntries) ? weekEntries : [],
      latestWeight,
    };
  }, [selectedDate, weekStart]);

  const {
    data,
    error: dataError,
    reload,
  } = useAsyncData<ActivityData>(loader, [selectedDate, weekStart], EMPTY_DATA);

  const entries = data?.entries ?? [];
  const weekEntries = data?.weekEntries ?? [];
  const weightKg = resolveWeightKg(data?.latestWeight ?? null, profile);

  const [healthStatus, setHealthStatus] = useState<HealthPermissionStatus>('undetermined');
  const [healthSummary, setHealthSummary] = useState<HealthDaySummary | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ExerciseEntry | null>(null);

  const loadHealth = useCallback(async () => {
    try {
      const service = getHealthService();
      const status = await service.getPermissionStatus();
      setHealthStatus(status);
      if (!healthSyncEnabled || status === 'denied' || status === 'undetermined') {
        setHealthSummary(null);
        return;
      }
      const summary = await service.getDaySummary(selectedDate);
      setHealthSummary(summary ?? null);
      setHealthError(null);
    } catch (error) {
      setHealthSummary(null);
      setHealthError(toMessage(error, 'Could not read health data.'));
    }
  }, [healthSyncEnabled, selectedDate]);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  // `unavailable` is not a connection. A release build with no native health
  // module reports it, and so does a device where the platform was removed
  // after the user connected. Counting it as connected would show a stats row
  // of zeros as if it were the real day; HealthConnectCard has an honest
  // unavailable state that explains the situation instead.
  const isConnected = healthSyncEnabled && healthStatus === 'granted';

  const runSync = useCallback(async () => {
    setSyncing(true);
    setHealthError(null);
    try {
      const result = await syncHealthDay(selectedDate);
      if (result?.ok) {
        setLastSyncedAt(new Date().toISOString());
        invalidate();
      } else {
        setHealthError(result?.error ?? 'Health sync failed. Manual logging still works.');
      }
      try {
        const summary = await getHealthService().getDaySummary(selectedDate);
        setHealthSummary(summary ?? null);
      } catch {
        // keep whatever we already had
      }
      reload();
    } catch (error) {
      setHealthError(toMessage(error, 'Health sync failed. Manual logging still works.'));
    } finally {
      setSyncing(false);
    }
  }, [invalidate, reload, selectedDate]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setHealthError(null);
    try {
      const service = getHealthService();
      const status = await service.requestPermissions();
      setHealthStatus(status);
      if (status === 'granted') {
        updateSettings({ healthSyncEnabled: true });
        const result = await syncHealthDay(selectedDate);
        if (result?.ok) {
          setLastSyncedAt(new Date().toISOString());
        } else {
          setHealthError(result?.error ?? 'Connected, but the first sync failed.');
        }
        try {
          const summary = await service.getDaySummary(selectedDate);
          setHealthSummary(summary ?? null);
        } catch {
          // stats simply stay empty
        }
        reload();
      } else if (status === 'unavailable') {
        // The card re-renders into its unavailable state, which already
        // explains this. A "denied access" error would send the user hunting
        // through device settings for a permission that does not exist.
      } else {
        setHealthError(
          `${platformLabel} denied access. Enable MacroTrack in your device settings to sync automatically.`
        );
      }
    } catch (error) {
      setHealthError(toMessage(error, 'Could not connect to your health app.'));
    } finally {
      setConnecting(false);
    }
  }, [platformLabel, reload, selectedDate, updateSettings]);

  const handleOpenSettings = useCallback(() => {
    void Linking.openSettings().catch(() => {
      Alert.alert('Open settings', 'Open your device settings and grant MacroTrack health access.');
    });
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      reload();
      if (healthSyncEnabled) {
        await runSync();
      } else {
        await loadHealth();
      }
    } finally {
      setRefreshing(false);
    }
  }, [healthSyncEnabled, loadHealth, reload, runSync]);

  const handleDelete = useCallback(
    async (entry: ExerciseEntry) => {
      setActionError(null);
      try {
        await deleteExerciseEntry(entry.id);
        invalidate();
        reload();
      } catch (error) {
        setActionError(toMessage(error, 'Could not delete that workout.'));
      }
    },
    [invalidate, reload]
  );

  const isFuture = safeIsFuture(selectedDate);

  const openNewWorkout = useCallback(() => {
    setEditingEntry(null);
    setSheetOpen(true);
  }, []);

  const openEditWorkout = useCallback((entry: ExerciseEntry) => {
    setEditingEntry(entry);
    setSheetOpen(true);
  }, []);

  return (
    <Screen
      title="Activity"
      subtitle={safeDateLabel(selectedDate)}
      scrollable
      refreshing={refreshing}
      onRefresh={() => {
        void handleRefresh();
      }}
    >
      <DateStepper date={selectedDate} onChange={setSelectedDate} />

      <BurnSummaryCard
        entries={entries}
        health={healthSummary}
        addExerciseToTarget={settings.addExerciseToTarget}
        onOpenSettings={() => router.push('/settings')}
      />

      {isConnected ? (
        <HealthStatsRow
          platformLabel={platformLabel}
          summary={healthSummary}
          lastSyncedAt={lastSyncedAt}
          syncing={syncing}
          error={healthError}
          onSync={() => {
            void runSync();
          }}
        />
      ) : (
        <HealthConnectCard
          platformLabel={platformLabel}
          permissions={HEALTH_PERMISSIONS}
          status={healthStatus}
          connecting={connecting}
          error={healthError}
          onConnect={() => {
            void handleConnect();
          }}
          onOpenSettings={handleOpenSettings}
        />
      )}

      <SectionHeader title="Workouts" />

      {isFuture ? (
        <Card testID="future-date-notice">
          <Text style={[typography.body, { color: colors.warning }]}>
            {`${safeDateLabel(selectedDate)} hasn't happened yet — you can't log a workout for a future day.`}
          </Text>
        </Card>
      ) : (
        <Button
          title="Log workout"
          icon="add"
          fullWidth
          onPress={openNewWorkout}
          accessibilityLabel="Log workout"
        />
      )}

      {dataError ? (
        <Text
          style={[typography.caption, { color: colors.danger, marginTop: spacing.sm }]}
          accessibilityRole="alert"
          testID="activity-data-error"
        >
          Could not load your workouts. Pull down to try again.
        </Text>
      ) : null}

      {actionError ? (
        <Text
          style={[typography.caption, { color: colors.danger, marginTop: spacing.sm }]}
          accessibilityRole="alert"
        >
          {actionError}
        </Text>
      ) : null}

      <View style={{ marginTop: spacing.sm }}>
        {entries.length === 0 ? (
          <EmptyState
            icon="barbell-outline"
            title="No workouts yet"
            message={
              isConnected
                ? `Log one by hand or sync ${platformLabel} to pull in today's workouts.`
                : 'Log your first workout to add its calories to your day.'
            }
            actionLabel={isFuture ? undefined : 'Log workout'}
            onAction={isFuture ? undefined : openNewWorkout}
            testID="activity-empty"
          />
        ) : (
          entries.map((entry) => (
            <ExerciseEntryRow
              key={entry.id}
              entry={entry}
              onEdit={openEditWorkout}
              onDelete={(target) => {
                void handleDelete(target);
              }}
            />
          ))
        )}
      </View>

      <View style={styles.section}>
        <WeeklyBurnCard days={weekDays} entries={weekEntries} />
      </View>

      <LogWorkoutSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        date={selectedDate}
        weightKg={weightKg}
        entry={editingEntry}
        onSaved={reload}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 16 },
});
