import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import { LineChart, MacroBar, ProgressRing } from '@/ui';

function serialize(): string {
  return JSON.stringify(screen.toJSON());
}

describe('ProgressRing', () => {
  it.each([0, 0.5, 1, 1.5, 3])('renders progress %p without crashing', (progress) => {
    render(<ProgressRing progress={progress} label="1,850" sublabel="kcal left" />);
    expect(screen.getByText('1,850')).toBeTruthy();
    expect(serialize()).not.toMatch(/NaN/);
  });

  it('tolerates NaN / negative progress', () => {
    render(<ProgressRing progress={Number.NaN} testID="ring" />);
    expect(screen.getByTestId('ring')).toBeTruthy();
    expect(serialize()).not.toMatch(/NaN/);

    screen.unmount();
    render(<ProgressRing progress={-4} testID="ring" />);
    expect(screen.getByTestId('ring')).toBeTruthy();
    expect(serialize()).not.toMatch(/NaN/);
  });

  it('tolerates a stroke wider than the ring', () => {
    render(<ProgressRing progress={0.5} size={40} strokeWidth={400} testID="ring" />);
    expect(screen.getByTestId('ring')).toBeTruthy();
    expect(serialize()).not.toMatch(/NaN/);
  });

  it('renders children instead of label/sublabel', () => {
    render(
      <ProgressRing progress={0.4} label="ignored" sublabel="ignored too">
        <Text>custom</Text>
      </ProgressRing>
    );
    expect(screen.getByText('custom')).toBeTruthy();
    expect(screen.queryByText('ignored')).toBeNull();
  });
});

describe('LineChart', () => {
  it('renders a placeholder with no data', () => {
    render(<LineChart data={[]} />);
    expect(screen.getByText('Not enough data yet')).toBeTruthy();
  });

  it('renders a flat line for a single point', () => {
    render(<LineChart data={[{ x: 1, y: 80 }]} testID="chart" />);
    expect(screen.getByTestId('chart')).toBeTruthy();
    expect(serialize()).not.toMatch(/NaN/);
  });

  it('renders many points with a goal line and formatters', () => {
    const data = Array.from({ length: 30 }, (_, i) => ({ x: i, y: 80 + Math.sin(i) * 2 }));
    render(
      <LineChart
        data={data}
        goalLine={78}
        showArea
        yFormatter={(n) => `${n.toFixed(1)} kg`}
        xFormatter={(n) => `d${n}`}
        testID="chart"
      />
    );
    expect(screen.getByTestId('chart')).toBeTruthy();
    expect(serialize()).not.toMatch(/NaN/);
  });

  it('handles identical y values without dividing by zero', () => {
    const data = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ];
    render(<LineChart data={data} testID="chart" />);
    expect(serialize()).not.toMatch(/NaN/);
  });

  it('filters out non-finite points', () => {
    const data = [
      { x: 0, y: Number.NaN },
      { x: 1, y: 5 },
      { x: Number.POSITIVE_INFINITY, y: 3 },
      { x: 2, y: 9 },
    ];
    render(<LineChart data={data} testID="chart" />);
    expect(screen.getByTestId('chart')).toBeTruthy();
    expect(serialize()).not.toMatch(/NaN/);
  });
});

describe('MacroBar', () => {
  it('renders an empty track for all-zero macros', () => {
    render(<MacroBar protein={0} carbs={0} fat={0} testID="bar" />);
    expect(screen.getByTestId('bar')).toBeTruthy();
    expect(screen.getByText('P 0g')).toBeTruthy();
    expect(screen.getByText('C 0g')).toBeTruthy();
    expect(screen.getByText('F 0g')).toBeTruthy();
  });

  it('renders gram labels for real macros', () => {
    render(<MacroBar protein={150} carbs={200} fat={60} />);
    expect(screen.getByText('P 150g')).toBeTruthy();
    expect(screen.getByText('C 200g')).toBeTruthy();
    expect(screen.getByText('F 60g')).toBeTruthy();
  });

  it('hides labels when showLabels is false', () => {
    render(<MacroBar protein={10} carbs={10} fat={10} showLabels={false} />);
    expect(screen.queryByText('P 10g')).toBeNull();
  });

  it('treats negative / non-finite macros as zero', () => {
    render(<MacroBar protein={-20} carbs={Number.NaN} fat={30} testID="bar" />);
    expect(screen.getByText('P 0g')).toBeTruthy();
    expect(screen.getByText('C 0g')).toBeTruthy();
    expect(screen.getByText('F 30g')).toBeTruthy();
  });
});
