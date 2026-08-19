/**
 * Chart card: 0 / 1 / many data points, range selection and the raw vs trend
 * series toggle.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import type { WeightTrendPoint } from '../useWeightHistory';
import { WeightChartCard } from '../WeightChartCard';

const POINTS: WeightTrendPoint[] = [
  { date: '2026-02-01', weightKg: 82, ema: 82 },
  { date: '2026-02-08', weightKg: 81, ema: 81.75 },
  { date: '2026-02-15', weightKg: 80.4, ema: 81.41 },
];

function renderCard(overrides: Partial<React.ComponentProps<typeof WeightChartCard>> = {}) {
  const props = {
    points: POINTS,
    unit: 'kg' as const,
    goalKg: 70,
    range: '30D' as const,
    onRangeChange: jest.fn(),
    ...overrides,
  };
  return { ...render(<WeightChartCard {...props} />), props };
}

describe('WeightChartCard', () => {
  it('renders a placeholder with no data', () => {
    renderCard({ points: [] });
    expect(screen.getByTestId('weight-chart-empty')).toBeTruthy();
    expect(screen.getByText('No weigh-ins in this range')).toBeTruthy();
    expect(screen.queryByTestId('weight-chart')).toBeNull();
  });

  it('renders the single value without a chart for one data point', () => {
    renderCard({ points: [POINTS[0]] });
    expect(screen.getByTestId('weight-chart-empty')).toBeTruthy();
    expect(screen.getByText('82.0 kg')).toBeTruthy();
    expect(screen.queryByTestId('weight-chart')).toBeNull();
  });

  it('renders the chart from two data points up', () => {
    renderCard({ points: POINTS.slice(0, 2) });
    expect(screen.getByTestId('weight-chart')).toBeTruthy();
    expect(screen.queryByTestId('weight-chart-empty')).toBeNull();
  });

  it('exposes every range option and reports selection', () => {
    const { props } = renderCard();
    ['7D', '30D', '90D', '1Y', 'All'].forEach((label) => {
      expect(screen.getByText(label)).toBeTruthy();
    });

    fireEvent.press(screen.getByText('7D'));
    expect(props.onRangeChange).toHaveBeenCalledWith('7D');
  });

  it('overlays the raw and trend series with a legend', () => {
    renderCard();
    expect(screen.getByTestId('weight-chart')).toBeTruthy();
    expect(screen.getByText('Weight')).toBeTruthy();
    expect(screen.getByText('Trend')).toBeTruthy();
  });

  it('hides the trend series when the toggle is turned off', () => {
    renderCard();
    expect(screen.getByTestId('weight-chart').props.accessibilityLabel).toBe(
      'Weight chart with trend line'
    );

    fireEvent.press(screen.getByText('Trend line'));

    expect(screen.getByTestId('weight-chart').props.accessibilityLabel).toBe(
      'Weight chart, trend line hidden'
    );
    expect(screen.queryByText('Trend')).toBeNull();
    expect(screen.getByTestId('weight-chart')).toBeTruthy();
  });

  it('labels the axis with the display unit', () => {
    renderCard({ unit: 'lb' });
    expect(screen.getByText(/trend \(lb\)/i)).toBeTruthy();
  });

  it('plots every series and the goal line in the same display unit', () => {
    // Domain spans the series (82 kg) and the goal (70 kg), padded by 5%.
    renderCard();
    expect(screen.getByText('82.6')).toBeTruthy();
    expect(screen.getByText('69.4')).toBeTruthy();
    screen.unmount();

    // Same data in pounds: a kg goal line would drag the minimum far lower.
    renderCard({ unit: 'lb' });
    expect(screen.getByText('182.1')).toBeTruthy();
    expect(screen.getByText('153.0')).toBeTruthy();
  });

  it('keeps the goal line out of the domain when there is no goal', () => {
    renderCard({ goalKg: null });
    expect(screen.getByText('82.1')).toBeTruthy();
    expect(screen.getByText('80.3')).toBeTruthy();
  });
});
