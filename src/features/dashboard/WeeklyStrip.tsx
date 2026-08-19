import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, SectionHeader, useTheme } from '@/ui';
import type { DailySummary } from '@/types';

import { DashText } from './dashboardText';
import { formatNumber, safeRatio } from './useDashboardData';

interface WeeklyStripProps {
  /** Ascending, oldest first; produced by `buildDailySummary` per day. */
  week: DailySummary[];
  targetCalories: number;
  onPress: () => void;
}

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function weekdayInitial(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  const day = parsed.getDay();
  return Number.isNaN(day) ? '·' : (WEEKDAY_INITIALS[day] ?? '·');
}

/** 7-day net calories (food minus exercise) against the daily target. */
export function WeeklyStrip({ week, targetCalories, onPress }: WeeklyStripProps) {
  const { colors, spacing, radius } = useTheme();

  const hasTarget = Number.isFinite(targetCalories) && targetCalories > 0;

  const { peak, average, loggedDays } = useMemo(() => {
    const nets = week.map((day) => Math.max(day.netCalories, 0));
    const logged = week.filter((day) => day.entryCount > 0);
    const total = logged.reduce((sum, day) => sum + day.netCalories, 0);
    return {
      peak: Math.max(hasTarget ? targetCalories : 0, ...nets, 1),
      average: logged.length > 0 ? total / logged.length : 0,
      loggedDays: logged.length,
    };
  }, [week, targetCalories, hasTarget]);

  return (
    <Card onPress={onPress}>
      <SectionHeader title="Last 7 days" />

      {loggedDays === 0 ? (
        <DashText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
          Nothing logged in the last 7 days.
        </DashText>
      ) : (
        <>
          <View style={[styles.chart, { marginTop: spacing.md, gap: spacing.sm }]}>
            {hasTarget ? (
              <View
                style={[
                  styles.goalLine,
                  {
                    borderColor: colors.border,
                    bottom: 18 + safeRatio(targetCalories, peak) * 96,
                  },
                ]}
              />
            ) : null}

            {week.map((day) => {
              const net = Math.max(day.netCalories, 0);
              const fill = safeRatio(net, peak);
              const over = hasTarget && day.netCalories > targetCalories;
              const barColor =
                day.entryCount === 0 ? colors.surfaceAlt : over ? colors.warning : colors.primary;

              return (
                <View
                  key={day.date}
                  style={styles.column}
                  accessible
                  accessibilityLabel={`${day.date}: ${formatNumber(day.netCalories)} net calories`}
                >
                  <View style={styles.barTrack}>
                    <View style={{ flex: Math.max(1 - fill, 0) }} />
                    <View
                      style={[
                        styles.bar,
                        {
                          flex: Math.max(fill, 0.02),
                          backgroundColor: barColor,
                          borderRadius: radius.sm,
                        },
                      ]}
                    />
                  </View>
                  <DashText variant="micro" color={colors.textFaint}>
                    {weekdayInitial(day.date)}
                  </DashText>
                </View>
              );
            })}
          </View>

          <DashText variant="micro" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
            {hasTarget
              ? `Avg ${formatNumber(average)} kcal net · target ${formatNumber(targetCalories)}`
              : `Avg ${formatNumber(average)} kcal net`}
          </DashText>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 116 },
  goalLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  column: { flex: 1, alignItems: 'center', gap: 6 },
  barTrack: { height: 96, alignSelf: 'stretch', flexDirection: 'column' },
  bar: { alignSelf: 'stretch' },
});
