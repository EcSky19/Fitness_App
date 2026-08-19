/**
 * Weight tab: current weight, trend chart, stats, weigh-in history and the
 * log/edit sheet. Everything is persisted in kilograms.
 */
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { LogWeightSheet } from '@/features/weight/LogWeightSheet';
import { useWeightHistory, type WeightRange } from '@/features/weight/useWeightHistory';
import { WeightChartCard } from '@/features/weight/WeightChartCard';
import { WeightHeroCard } from '@/features/weight/WeightHeroCard';
import { WeightHistoryList } from '@/features/weight/WeightHistoryList';
import { WeightStatsRow } from '@/features/weight/WeightStatsRow';
import { formatKg } from '@/features/weight/weightFormat';
import { getHealthService, healthPlatformLabel, isHealthSupported } from '@/services/health';
import { useAppStore } from '@/store/appStore';
import { Button, Card, EmptyState, ListRow, Screen, useTheme } from '@/ui';
import type { WeightLog } from '@/types';

const RANGE_LABELS: Record<WeightRange, string> = {
  '7D': 'last 7 days',
  '30D': 'last 30 days',
  '90D': 'last 90 days',
  '1Y': 'last year',
  ALL: 'whole history',
};

export default function WeightScreen(): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();
  const router = useRouter();

  const unit = useAppStore((state) => state.settings.weightUnit);
  const healthSyncEnabled = useAppStore((state) => state.settings.healthSyncEnabled);
  const profile = useAppStore((state) => state.profile);

  const { range, setRange, logs, points, stats, latestLog, loading, error, reload } =
    useWeightHistory('30D');

  const [sheetVisible, setSheetVisible] = useState(false);
  const [editing, setEditing] = useState<WeightLog | null>(null);
  const [prefillKg, setPrefillKg] = useState<number | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const rangeLabel = RANGE_LABELS[range];
  const hasLogs = logs.length > 0;

  const healthSupported = useMemo(() => {
    try {
      return Boolean(isHealthSupported());
    } catch {
      return false;
    }
  }, []);

  const platform = useMemo(() => {
    try {
      return healthPlatformLabel();
    } catch {
      return 'Health';
    }
  }, []);

  const openNew = useCallback((kg: number | null = null) => {
    setEditing(null);
    setPrefillKg(kg);
    setSheetVisible(true);
  }, []);

  const openEdit = useCallback((log: WeightLog) => {
    setEditing(log);
    setPrefillKg(null);
    setSheetVisible(true);
  }, []);

  const importFromHealth = useCallback(async () => {
    setImportError(null);
    try {
      const kg = await getHealthService().getLatestWeightKg();
      if (kg == null || !Number.isFinite(kg)) {
        setImportError(`No weight found in ${platform}.`);
        return;
      }
      openNew(kg);
    } catch {
      setImportError(`Could not read your weight from ${platform}.`);
    }
  }, [openNew, platform]);

  return (
    <Screen
      title="Weight"
      subtitle={hasLogs ? `${formatKg(stats.currentKg, unit)} today` : 'Track your progress'}
      scrollable
      refreshing={loading}
      onRefresh={reload}
      headerRight={<Button title="Log" icon="add" size="sm" onPress={() => openNew()} />}
    >
      <View style={{ gap: spacing.lg }}>
        {error ? (
          <Card>
            <Text style={[typography.label, { color: colors.danger }]}>{error}</Text>
          </Card>
        ) : null}

        {!hasLogs ? (
          <Card padded={false}>
            <EmptyState
              icon="scale-outline"
              title="No weigh-ins yet"
              message="Log your weight regularly to see your trend, weekly rate and projected goal date."
              actionLabel="Log your first weight"
              onAction={() => openNew()}
            />
          </Card>
        ) : (
          <>
            <WeightHeroCard
              stats={stats}
              unit={unit}
              rangeLabel={rangeLabel}
              onLogPress={() => openNew()}
              onSetGoalPress={() => router.push('/(tabs)/profile')}
            />

            <WeightChartCard
              points={points}
              unit={unit}
              goalKg={stats.goalKg}
              range={range}
              onRangeChange={setRange}
            />

            <WeightStatsRow stats={stats} unit={unit} rangeLabel={rangeLabel} />
          </>
        )}

        {profile?.goalWeightKg == null ? (
          <Card>
            <Text style={[typography.title, { color: colors.text }]}>Set a goal weight</Text>
            <Text
              style={[
                typography.body,
                { color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.md },
              ]}
            >
              Add a goal in your profile to unlock progress, remaining weight and a projected goal
              date.
            </Text>
            <Button
              title="Go to profile"
              variant="secondary"
              size="sm"
              icon="flag-outline"
              onPress={() => router.push('/(tabs)/profile')}
            />
          </Card>
        ) : null}

        {healthSupported && healthSyncEnabled ? (
          <Card padded={false}>
            <ListRow
              title={`Import latest from ${platform}`}
              subtitle="Prefills the sheet with your most recent reading"
              leftIcon="cloud-download-outline"
              onPress={() => void importFromHealth()}
            />
            {importError ? (
              <Text
                style={[
                  typography.caption,
                  {
                    color: colors.warning,
                    paddingHorizontal: spacing.lg,
                    paddingBottom: spacing.md,
                  },
                ]}
              >
                {importError}
              </Text>
            ) : null}
          </Card>
        ) : null}

        {hasLogs ? (
          <Card padded={false}>
            <View style={styles.historyCard}>
              <WeightHistoryList logs={logs} unit={unit} goalKg={stats.goalKg} onEdit={openEdit} />
            </View>
          </Card>
        ) : null}
      </View>

      <LogWeightSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        log={editing}
        latestLog={latestLog}
        prefillKg={prefillKg}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  historyCard: {
    paddingVertical: 4,
  },
});
