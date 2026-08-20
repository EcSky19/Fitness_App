/**
 * Weight chart: the raw weigh-ins and the EMA trend overlaid on one shared
 * domain, with a range selector and a toggle to hide the trend line.
 *
 * Both series and the goal line are converted to the display unit here — the
 * chart itself is unit-agnostic, so mixing units would silently misplot.
 */
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatDateShort, isoToDate } from '@/domain';
import {
  Card,
  Chip,
  LineChart,
  SectionHeader,
  SegmentedControl,
  useTheme,
  type LineChartPoint,
  type LineChartSeries,
} from '@/ui';
import type { WeightUnit } from '@/types';

import { WEIGHT_RANGE_OPTIONS, type WeightRange, type WeightTrendPoint } from './useWeightHistory';
import { displayValue, formatKg, unitLabel } from './weightFormat';

export interface WeightChartCardProps {
  points: WeightTrendPoint[];
  unit: WeightUnit;
  goalKg: number | null;
  range: WeightRange;
  onRangeChange: (range: WeightRange) => void;
}

const MS_PER_DAY = 86_400_000;

function isoFromMs(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function xOf(iso: string, index: number): number {
  const date = isoToDate(iso);
  const time = date instanceof Date ? date.getTime() : NaN;
  return Number.isFinite(time) ? time : index * MS_PER_DAY;
}

/** Projects kg values into the display unit, dropping anything non-finite. */
function toSeriesData(
  points: WeightTrendPoint[],
  unit: WeightUnit,
  pick: (point: WeightTrendPoint) => number
): LineChartPoint[] {
  const data: LineChartPoint[] = [];
  points.forEach((point, index) => {
    const y = displayValue(pick(point), unit, 2);
    if (y == null) return;
    data.push({ x: xOf(point.date, index), y });
  });
  return data;
}

export function WeightChartCard({
  points,
  unit,
  goalKg,
  range,
  onRangeChange,
}: WeightChartCardProps): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();
  const [showTrend, setShowTrend] = useState(true);

  const rawData = useMemo(
    () => toSeriesData(points, unit, (point) => point.weightKg),
    [points, unit]
  );
  const trendData = useMemo(() => toSeriesData(points, unit, (point) => point.ema), [points, unit]);

  const series = useMemo<LineChartSeries[]>(() => {
    const list: LineChartSeries[] = [
      { data: rawData, label: 'Weight', color: colors.primary, showArea: true },
    ];
    if (showTrend && trendData.length > 0) {
      list.push({
        data: trendData,
        label: 'Trend',
        color: colors.text,
        dashed: true,
        showDots: false,
      });
    }
    return list;
  }, [colors.primary, colors.text, rawData, showTrend, trendData]);

  const goalLine = useMemo(() => displayValue(goalKg, unit, 2) ?? undefined, [goalKg, unit]);

  const hasChart = rawData.length >= 2;
  const only = points.length === 1 ? points[0] : null;

  return (
    <Card>
      <SectionHeader title={`Trend (${unitLabel(unit)})`} />

      <View style={{ marginBottom: spacing.md }}>
        <SegmentedControl<WeightRange>
          options={WEIGHT_RANGE_OPTIONS}
          value={range}
          onChange={onRangeChange}
        />
      </View>

      {hasChart ? (
        <>
          <View style={styles.chips}>
            <Chip
              label="Trend line"
              icon="analytics-outline"
              selected={showTrend}
              onPress={() => setShowTrend((previous) => !previous)}
            />
          </View>

          <View
            testID="weight-chart"
            accessibilityLabel={
              showTrend ? 'Weight chart with trend line' : 'Weight chart, trend line hidden'
            }
          >
            <LineChart
              series={series}
              height={200}
              goalLine={goalLine}
              unit={unit}
              yFormatter={(value: number) => `${value.toFixed(1)}`}
              xFormatter={(value: number) => formatDateShort(isoFromMs(value))}
            />
          </View>
        </>
      ) : (
        <View testID="weight-chart-empty" style={styles.placeholder}>
          <Text style={[typography.title, { color: colors.text }]}>
            {only ? formatKg(only.weightKg, unit) : 'No weigh-ins in this range'}
          </Text>
          <Text style={[typography.caption, { color: colors.textMuted, marginTop: spacing.xs }]}>
            Log at least two weigh-ins to see your trend.
          </Text>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
});

export default WeightChartCard;
