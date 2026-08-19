import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Card, EmptyState, LineChart, SectionHeader, useTheme } from '@/ui';
import { addDaysISO, formatWeight, toDisplayWeight, weightTrend } from '@/domain';
import { KG_PER_LB } from '@/types/constants';
import type { ISODate, WeightLog, WeightUnit } from '@/types';

import { DashText } from './dashboardText';

interface WeightSnapshotCardProps {
  /** Ascending by date. */
  logs: WeightLog[];
  unit: WeightUnit;
  selectedDate: ISODate;
  onOpenWeight: () => void;
}

/**
 * `weightTrend(logs, days)` returns `{ changeKg, ratePerWeekKg, direction }`
 * from an EMA-smoothed series; only the change and direction are surfaced here.
 */
export function WeightSnapshotCard({
  logs,
  unit,
  selectedDate,
  onOpenWeight,
}: WeightSnapshotCardProps) {
  const { colors, spacing } = useTheme();

  const latest = logs.length > 0 ? logs[logs.length - 1] : null;

  const trend = useMemo(() => {
    if (logs.length < 2) return null;
    try {
      return weightTrend(logs, 7);
    } catch {
      return null;
    }
  }, [logs]);

  const points = useMemo(() => {
    let start: ISODate | null = null;
    try {
      start = addDaysISO(selectedDate, -29);
    } catch {
      start = null;
    }
    const cutoff = start;
    const windowed = cutoff === null ? logs : logs.filter((log) => log.date >= cutoff);
    const source = windowed.length > 1 ? windowed : logs;
    return source.map((log, index) => ({ x: index, y: toDisplayWeight(log.weightKg, unit) }));
  }, [logs, selectedDate, unit]);

  if (!latest) {
    return (
      <Card>
        <SectionHeader title="Weight" />
        <EmptyState
          icon="scale-outline"
          title="No weight logged"
          message="Log your weight to see progress toward your goal."
          actionLabel="Log weight"
          onAction={onOpenWeight}
        />
      </Card>
    );
  }

  const trendUp = trend?.direction === 'up';
  const trendDown = trend?.direction === 'down';
  const trendColor = trendUp ? colors.warning : trendDown ? colors.success : colors.textMuted;
  const trendIcon = trendUp ? 'trending-up' : trendDown ? 'trending-down' : 'remove';
  const trendText =
    trend === null
      ? 'Not enough data for a 7-day trend'
      : `${trend.changeKg > 0 ? '+' : trend.changeKg < 0 ? '-' : ''}${formatWeight(
          Math.abs(trend.changeKg),
          unit
        )} over 7 days`;

  return (
    <Card onPress={onOpenWeight}>
      <SectionHeader title="Weight" />
      <View
        style={[styles.headline, { marginTop: spacing.sm }]}
        accessible
        accessibilityLabel={`Latest weight ${formatWeight(latest.weightKg, unit)}. ${trendText}`}
      >
        <DashText variant="title" color={colors.text}>
          {formatWeight(latest.weightKg, unit)}
        </DashText>
        <View style={styles.trend}>
          <Ionicons name={trendIcon} size={14} color={trendColor} />
          <DashText variant="caption" color={trendColor}>
            {trendText}
          </DashText>
        </View>
      </View>

      {points.length > 1 ? (
        <View style={{ marginTop: spacing.md }}>
          <LineChart
            data={points}
            height={90}
            color={colors.primary}
            showArea
            yFormatter={(n) => formatWeight(unit === 'lb' ? n * KG_PER_LB : n, unit)}
          />
        </View>
      ) : (
        <DashText variant="micro" color={colors.textFaint} style={{ marginTop: spacing.md }}>
          Log again to see your 30-day chart.
        </DashText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  headline: { gap: 4 },
  trend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
