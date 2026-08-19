/**
 * Seven-day burn trend: chart, totals, average and active minutes.
 */
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { format, parseISO } from 'date-fns';

import type { ExerciseEntry, ISODate } from '@/types';
import { Card, LineChart, SectionHeader, StatTile, useTheme } from '@/ui';

export interface WeeklyBurnCardProps {
  /** Ascending list of days to chart (usually `lastNDaysISO(7, selectedDate)`). */
  days: ISODate[];
  entries: ExerciseEntry[];
}

interface WeeklyTotals {
  points: { x: number; y: number }[];
  totalKcal: number;
  averageKcal: number;
  totalMinutes: number;
}

export function computeWeeklyTotals(days: ISODate[], entries: ExerciseEntry[]): WeeklyTotals {
  const byDate = new Map<ISODate, number>();
  let totalKcal = 0;
  let totalMinutes = 0;

  for (const entry of entries) {
    byDate.set(entry.date, (byDate.get(entry.date) ?? 0) + (entry.caloriesBurned || 0));
    totalKcal += entry.caloriesBurned || 0;
    totalMinutes += entry.durationMin || 0;
  }

  const points = days.map((day, index) => ({ x: index, y: Math.round(byDate.get(day) ?? 0) }));
  const divisor = days.length || 1;

  return {
    points,
    totalKcal: Math.round(totalKcal),
    averageKcal: Math.round(totalKcal / divisor),
    totalMinutes: Math.round(totalMinutes),
  };
}

function dayLabel(day: ISODate | undefined): string {
  if (!day) return '';
  try {
    return format(parseISO(day), 'EEEEE');
  } catch {
    return '';
  }
}

export function WeeklyBurnCard({ days, entries }: WeeklyBurnCardProps): React.JSX.Element {
  const { colors, spacing } = useTheme();
  const { points, totalKcal, averageKcal, totalMinutes } = useMemo(
    () => computeWeeklyTotals(days, entries),
    [days, entries]
  );

  return (
    <Card testID="weekly-burn-card">
      <SectionHeader title="Last 7 days" />
      <LineChart
        data={points}
        height={140}
        color={colors.calories}
        showArea
        goalLine={averageKcal > 0 ? averageKcal : undefined}
        yFormatter={(value: number) => `${Math.round(value)}`}
        xFormatter={(value: number) => dayLabel(days[Math.round(value)])}
      />
      <View style={[styles.tiles, { marginTop: spacing.md }]}>
        <StatTile
          label="Total"
          value={totalKcal}
          sublabel="kcal"
          icon="flame"
          color={colors.calories}
          style={styles.tile}
        />
        <StatTile
          label="Daily average"
          value={averageKcal}
          sublabel="kcal"
          icon="stats-chart"
          color={colors.primary}
          style={styles.tile}
        />
        <StatTile
          label="Active time"
          value={totalMinutes}
          sublabel="min"
          icon="timer"
          color={colors.carbs}
          style={styles.tile}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  tile: { flexGrow: 1, flexBasis: '30%' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});

export default WeeklyBurnCard;
