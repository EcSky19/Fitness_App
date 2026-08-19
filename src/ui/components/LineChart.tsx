import React, { useId, useMemo, useState } from 'react';
import {
  Dimensions,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Polyline, Stop } from 'react-native-svg';

import { spacing, typography, useTheme } from '../theme';

export interface LineChartPoint {
  x: number;
  y: number;
}

export interface LineChartSeries {
  data: LineChartPoint[];
  /** Defaults to the theme primary for the first series, then a rotating palette. */
  color?: string;
  /** Shown in the legend. Series without a label are skipped there. */
  label?: string;
  /** Gradient fill under the line. Default false for extra series. */
  showArea?: boolean;
  /** Default 2. */
  strokeWidth?: number;
  /** Dashed stroke — use for trend/EMA overlays. Default false. */
  dashed?: boolean;
  /** `undefined` = dot on the last point only, `true` = every point, `false` = none. */
  showDots?: boolean;
}

export interface LineChartProps {
  /** Single-series shortcut. Becomes the first series when `series` is also given. */
  data?: LineChartPoint[];
  /** Overlay several series on one shared x/y domain. */
  series?: LineChartSeries[];
  height?: number;
  /** Colour of the `data` series. */
  color?: string;
  /** Gradient fill under the `data` series. Default true. */
  showArea?: boolean;
  /** Dashed horizontal reference line (target weight, calorie goal...). */
  goalLine?: number;
  yFormatter?: (n: number) => string;
  xFormatter?: (n: number) => string;
  /** Message shown when no series has any point. */
  emptyMessage?: string;
  /** Defaults to true when there is more than one series. Needs 2+ labelled series. */
  showLegend?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const PAD_TOP = 12;
const PAD_RIGHT = 10;
/** Stroke width of the `data` series — kept at the historical value. */
const PRIMARY_STROKE_WIDTH = 2.5;
const SERIES_STROKE_WIDTH = 2;

interface ResolvedSeries {
  /** Palette slot; stable even when earlier series are empty. */
  key: number;
  points: LineChartPoint[];
  color?: string;
  label?: string;
  showArea: boolean;
  strokeWidth: number;
  dashed: boolean;
  showDots?: boolean;
}

interface ScreenPoint {
  x: number;
  y: number;
}

interface PlacedSeries extends ResolvedSeries {
  screen: ScreenPoint[];
}

function isFinitePoint(p: LineChartPoint | undefined): p is LineChartPoint {
  return (
    !!p && typeof p.x === 'number' && typeof p.y === 'number' &&
    Number.isFinite(p.x) && Number.isFinite(p.y)
  );
}

function round2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function cleanPoints(input: LineChartPoint[] | undefined): LineChartPoint[] {
  const points = (Array.isArray(input) ? input : []).filter(isFinitePoint);
  points.sort((a, b) => a.x - b.x);
  return points;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Trend chart with an optional multi-series overlay.
 *
 * Every series shares one x/y domain so lines are directly comparable, and the
 * renderer tolerates 0-point, 1-point and flat series without emitting NaN.
 */
export function LineChart({
  data,
  series,
  height = 180,
  color,
  showArea = true,
  goalLine,
  yFormatter,
  xFormatter,
  emptyMessage = 'Not enough data yet',
  showLegend,
  style,
  testID,
}: LineChartProps): React.JSX.Element {
  const { colors } = useTheme();
  const rawId = useId();
  const gradientId = `mtChart${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;

  const chartHeight = Math.max(60, Number.isFinite(height) ? height : 180);
  const [width, setWidth] = useState<number>(() =>
    Math.max(160, Dimensions.get('window').width - 64)
  );

  const handleLayout = (e: LayoutChangeEvent): void => {
    const next = e.nativeEvent.layout.width;
    if (Number.isFinite(next) && next > 0 && Math.abs(next - width) > 0.5) setWidth(next);
  };

  const allSeries = useMemo<ResolvedSeries[]>(() => {
    const extra = Array.isArray(series) ? series : [];
    const primary = cleanPoints(data);
    const list: ResolvedSeries[] = [];

    // `data` only claims the first palette slot when it carries points, or when
    // it is the sole source — so `series`-only charts still start at `primary`.
    if (primary.length > 0 || extra.length === 0) {
      list.push({
        key: 0,
        points: primary,
        color,
        showArea,
        strokeWidth: PRIMARY_STROKE_WIDTH,
        dashed: false,
        showDots: undefined,
      });
    }

    for (const entry of extra) {
      list.push({
        key: list.length,
        points: cleanPoints(entry?.data),
        color: entry?.color,
        label: entry?.label,
        showArea: entry?.showArea ?? false,
        strokeWidth: positiveNumber(entry?.strokeWidth, SERIES_STROKE_WIDTH),
        dashed: entry?.dashed ?? false,
        showDots: entry?.showDots,
      });
    }

    return list;
  }, [color, data, series, showArea]);

  const model = useMemo(() => {
    const padLeft = yFormatter ? 42 : 10;
    const padBottom = xFormatter ? 22 : 10;
    const plotW = Math.max(1, width - padLeft - PAD_RIGHT);
    const plotH = Math.max(1, chartHeight - PAD_TOP - padBottom);
    const drawable = allSeries.filter((s) => s.points.length > 0);

    if (drawable.length === 0) {
      return {
        empty: true as const,
        padLeft,
        padBottom,
        plotW,
        plotH,
        placed: [] as PlacedSeries[],
        minX: 0,
        maxX: 0,
        minY: 0,
        maxY: 0,
        goalY: null as number | null,
      };
    }

    // Shared domain across every series (plus the goal line) — this is what makes
    // overlaid series comparable.
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const s of drawable) {
      for (const p of s.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }

    const hasGoal = typeof goalLine === 'number' && Number.isFinite(goalLine);
    if (hasGoal) {
      const goal = goalLine as number;
      if (goal < minY) minY = goal;
      if (goal > maxY) maxY = goal;
    }

    const spanRaw = maxY - minY;
    const padY = spanRaw > 0 ? spanRaw * 0.05 : Math.max(1, Math.abs(maxY) * 0.1);
    minY -= padY;
    maxY += padY;
    const spanY = maxY - minY || 1;
    const spanX = maxX - minX;

    const toY = (y: number): number => round2(PAD_TOP + (1 - (y - minY) / spanY) * plotH);
    const toX = (x: number): number =>
      round2(spanX > 0 ? padLeft + ((x - minX) / spanX) * plotW : padLeft + plotW);

    const placed: PlacedSeries[] = drawable.map((s) => {
      if (s.points.length === 1) {
        const only = s.points[0];
        const y = toY(only.y);
        // With no x-span at all the single value spreads across the plot (the
        // historical single-series look); otherwise it sits at its real x.
        const screen: ScreenPoint[] =
          spanX > 0
            ? [
                { x: toX(only.x), y },
                { x: toX(only.x), y },
              ]
            : [
                { x: round2(padLeft), y },
                { x: round2(padLeft + plotW), y },
              ];
        return { ...s, screen };
      }
      return { ...s, screen: s.points.map((p) => ({ x: toX(p.x), y: toY(p.y) })) };
    });

    return {
      empty: false as const,
      padLeft,
      padBottom,
      plotW,
      plotH,
      placed,
      minX,
      maxX,
      minY,
      maxY,
      goalY: hasGoal ? toY(goalLine as number) : null,
    };
  }, [allSeries, chartHeight, goalLine, width, xFormatter, yFormatter]);

  const paletteCycle = [colors.primary, colors.fat, colors.carbs, colors.protein];
  const colorFor = (s: ResolvedSeries): string =>
    s.color ?? paletteCycle[s.key % paletteCycle.length];

  // Only series that actually draw a line earn a legend entry — a swatch for an
  // empty series claims data the chart never shows.
  const legendItems = allSeries.filter((s) => !!s.label && s.points.length > 0);
  const legendVisible = (showLegend ?? allSeries.length > 1) && legendItems.length > 1;

  if (model.empty) {
    return (
      <View
        testID={testID}
        onLayout={handleLayout}
        style={[styles.empty, { height: chartHeight, borderColor: colors.border }, style]}
      >
        <Text style={[typography.caption, { color: colors.textFaint }]}>{emptyMessage}</Text>
      </View>
    );
  }

  const { placed, padLeft, plotW, plotH, minY, maxY, goalY } = model;
  const baseY = round2(PAD_TOP + plotH);
  const areaSeries = placed.filter((s) => s.showArea);

  const chart = (
    <View testID={testID} onLayout={handleLayout} style={[{ height: chartHeight }, style]}>
      <Svg width={width} height={chartHeight}>
        {areaSeries.length > 0 ? (
          <Defs>
            {areaSeries.map((s) => (
              <LinearGradient key={s.key} id={`${gradientId}s${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colorFor(s)} stopOpacity="0.35" />
                <Stop offset="1" stopColor={colorFor(s)} stopOpacity="0" />
              </LinearGradient>
            ))}
          </Defs>
        ) : null}

        {areaSeries.map((s) => (
          <Path
            key={`area-${s.key}`}
            d={`M ${s.screen[0].x} ${s.screen[0].y} ${s.screen
              .slice(1)
              .map((p) => `L ${p.x} ${p.y}`)
              .join(' ')} L ${s.screen[s.screen.length - 1].x} ${baseY} L ${s.screen[0].x} ${baseY} Z`}
            fill={`url(#${gradientId}s${s.key})`}
          />
        ))}

        {goalY !== null ? (
          <Line
            x1={padLeft}
            y1={goalY}
            x2={round2(padLeft + plotW)}
            y2={goalY}
            stroke={colors.textFaint}
            strokeWidth={1}
            strokeDasharray="5 4"
          />
        ) : null}

        {placed.map((s) => (
          <Polyline
            key={`line-${s.key}`}
            points={s.screen.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={colorFor(s)}
            strokeWidth={s.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={s.dashed ? '6 4' : undefined}
          />
        ))}

        {placed.map((s) => {
          if (s.showDots === false) return null;
          const last = s.screen[s.screen.length - 1];
          return (
            <React.Fragment key={`dots-${s.key}`}>
              {s.showDots === true
                ? s.screen
                    .slice(0, -1)
                    .map((p, i) => (
                      <Circle key={`dot-${s.key}-${i}`} cx={p.x} cy={p.y} r={3} fill={colorFor(s)} />
                    ))
                : null}
              <Circle cx={last.x} cy={last.y} r={5} fill={colorFor(s)} />
              <Circle cx={last.x} cy={last.y} r={2} fill={colors.bg} />
            </React.Fragment>
          );
        })}
      </Svg>

      {yFormatter ? (
        <>
          <Text style={[typography.caption, styles.yTop, { color: colors.textFaint }]}>
            {yFormatter(maxY)}
          </Text>
          <Text
            style={[
              typography.caption,
              styles.yBottom,
              { color: colors.textFaint, bottom: model.padBottom },
            ]}
          >
            {yFormatter(minY)}
          </Text>
        </>
      ) : null}

      {xFormatter ? (
        <View style={[styles.xAxis, { left: padLeft, right: PAD_RIGHT }]}>
          <Text style={[typography.caption, { color: colors.textFaint }]}>
            {xFormatter(model.minX)}
          </Text>
          <Text style={[typography.caption, { color: colors.textFaint }]}>
            {xFormatter(model.maxX)}
          </Text>
        </View>
      ) : null}
    </View>
  );

  if (!legendVisible) return chart;

  return (
    <View>
      {chart}
      <View style={styles.legend}>
        {legendItems.map((s) => (
          <View key={`legend-${s.key}`} style={styles.legendItem}>
            {s.dashed ? (
              <View style={styles.swatchDashed}>
                <View style={[styles.swatchDash, { backgroundColor: colorFor(s) }]} />
                <View style={[styles.swatchDash, { backgroundColor: colorFor(s) }]} />
              </View>
            ) : (
              <View style={[styles.swatch, { backgroundColor: colorFor(s) }]} />
            )}
            <Text style={[typography.caption, { color: colors.textMuted }]}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    borderRadius: 16,
    borderStyle: 'dashed',
    borderWidth: 1,
    justifyContent: 'center',
    width: '100%',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    marginRight: spacing.lg,
  },
  swatch: {
    borderRadius: 2,
    height: 3,
    marginRight: spacing.xs,
    width: 14,
  },
  swatchDash: {
    borderRadius: 2,
    height: 3,
    width: 6,
  },
  swatchDashed: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginRight: spacing.xs,
    width: 14,
  },
  xAxis: {
    bottom: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    position: 'absolute',
  },
  yBottom: {
    left: spacing.xs,
    position: 'absolute',
  },
  yTop: {
    left: spacing.xs,
    position: 'absolute',
    top: PAD_TOP - 6,
  },
});

export default LineChart;
