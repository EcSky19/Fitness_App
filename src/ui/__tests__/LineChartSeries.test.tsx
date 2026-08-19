import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { Polyline } from 'react-native-svg';

import { LineChart, type LineChartPoint } from '@/ui';

const HEIGHT = 200;

function serialize(): string {
  return JSON.stringify(screen.toJSON());
}

/** Raw `points` attributes of every rendered series polyline, in render order. */
function polylines(): string[] {
  return screen.UNSAFE_getAllByType(Polyline).map((node) => String(node.props.points));
}

function parsePoints(points: string): { x: number; y: number }[] {
  return points
    .split(' ')
    .filter(Boolean)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return { x, y };
    });
}

function averageY(points: string): number {
  const parsed = parsePoints(points);
  return parsed.reduce((sum, p) => sum + p.y, 0) / parsed.length;
}

function ramp(from: number, to: number, count: number): LineChartPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    x: i,
    y: from + ((to - from) * i) / Math.max(1, count - 1),
  }));
}

describe('LineChart multi-series', () => {
  it('renders one polyline per non-empty series', () => {
    render(
      <LineChart
        series={[{ data: ramp(70, 75, 5) }, { data: ramp(80, 85, 5) }]}
        height={HEIGHT}
        testID="chart"
      />
    );

    expect(polylines()).toHaveLength(2);
    expect(serialize()).not.toMatch(/NaN/);
  });

  it('scales every series on one shared y-domain', () => {
    // A flat low series next to a high rising series. With per-series autoscaling
    // the flat one would land in the vertical middle of the plot; on a shared
    // domain it must sit near the bottom, well below the high series.
    render(
      <LineChart
        series={[
          { data: [{ x: 0, y: 100 }, { x: 1, y: 100 }, { x: 2, y: 100 }], label: 'flat' },
          { data: [{ x: 0, y: 200 }, { x: 1, y: 210 }, { x: 2, y: 220 }], label: 'high' },
        ]}
        height={HEIGHT}
        testID="chart"
      />
    );

    const [flat, high] = polylines();
    const flatY = averageY(flat);
    const highY = averageY(high);

    // SVG y grows downwards: the low series must render BELOW the high one.
    expect(flatY).toBeGreaterThan(highY);

    const plotTop = 12;
    const plotBottom = HEIGHT - 10;
    const plotMiddle = (plotTop + plotBottom) / 2;

    // Independently autoscaled, a flat series would sit at ~plotMiddle.
    expect(flatY).toBeGreaterThan(plotMiddle + 40);
    expect(flatY).toBeLessThanOrEqual(plotBottom);
    expect(highY).toBeLessThan(plotMiddle);
    expect(highY).toBeGreaterThanOrEqual(plotTop);
  });

  it('shares the x-domain across series with different ranges', () => {
    render(
      <LineChart
        series={[
          { data: [{ x: 0, y: 5 }, { x: 10, y: 6 }] },
          { data: [{ x: 5, y: 5.5 }, { x: 6, y: 5.6 }] },
        ]}
        height={HEIGHT}
        testID="chart"
      />
    );

    const [wide, narrow] = polylines().map(parsePoints);

    // The wide series spans the full plot...
    expect(wide[0].x).toBeLessThan(narrow[0].x);
    expect(wide[wide.length - 1].x).toBeGreaterThan(narrow[narrow.length - 1].x);
    // ...and the narrow series sits around the middle of it, not re-stretched.
    const plotWidth = wide[wide.length - 1].x - wide[0].x;
    expect(narrow[0].x).toBeGreaterThan(wide[0].x + plotWidth * 0.3);
    expect(narrow[1].x).toBeLessThan(wide[0].x + plotWidth * 0.7);
  });

  it('renders a dashed trend series', () => {
    render(
      <LineChart
        series={[
          { data: ramp(80, 78, 10), label: 'Weight' },
          { data: ramp(80, 79, 10), label: 'Trend', dashed: true },
        ]}
        height={HEIGHT}
        testID="chart"
      />
    );

    const dashArrays = screen
      .UNSAFE_getAllByType(Polyline)
      .map((node) => node.props.strokeDasharray);

    expect(dashArrays[0]).toBeUndefined();
    expect(dashArrays[1]).toBe('6 4');
  });

  it('renders a legend for labelled series', () => {
    render(
      <LineChart
        series={[
          { data: ramp(80, 78, 4), label: 'Weight' },
          { data: ramp(80, 79, 4), label: 'Trend', dashed: true },
        ]}
        height={HEIGHT}
      />
    );

    expect(screen.getByText('Weight')).toBeTruthy();
    expect(screen.getByText('Trend')).toBeTruthy();
  });

  it('skips the legend for unlabelled series and when disabled', () => {
    const view = render(
      <LineChart
        series={[{ data: ramp(80, 78, 4), label: 'Weight' }, { data: ramp(80, 79, 4) }]}
        height={HEIGHT}
      />
    );
    expect(screen.queryByText('Weight')).toBeNull();

    view.rerender(
      <LineChart
        series={[
          { data: ramp(80, 78, 4), label: 'Weight' },
          { data: ramp(80, 79, 4), label: 'Trend' },
        ]}
        height={HEIGHT}
        showLegend={false}
      />
    );
    expect(screen.queryByText('Weight')).toBeNull();
    expect(screen.queryByText('Trend')).toBeNull();
  });

  it('treats `data` as the first series when combined with `series`', () => {
    render(
      <LineChart
        data={ramp(100, 120, 6)}
        color="#ff0000"
        series={[{ data: ramp(200, 220, 6), color: '#00ff00' }]}
        height={HEIGHT}
        testID="chart"
      />
    );

    const nodes = screen.UNSAFE_getAllByType(Polyline);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].props.stroke).toBe('#ff0000');
    expect(nodes[1].props.stroke).toBe('#00ff00');
    // The `data` series keeps its historical 2.5 stroke; extra series default to 2.
    expect(nodes[0].props.strokeWidth).toBe(2.5);
    expect(nodes[1].props.strokeWidth).toBe(2);
    // Shared domain: the 100-120 series renders below the 200-220 series.
    expect(averageY(String(nodes[0].props.points))).toBeGreaterThan(
      averageY(String(nodes[1].props.points))
    );
  });

  it('tolerates empty and single-point series in the same chart', () => {
    render(
      <LineChart
        series={[
          { data: [], label: 'empty' },
          { data: [{ x: 3, y: 82 }], label: 'single' },
          { data: ramp(80, 84, 8), label: 'many' },
        ]}
        height={HEIGHT}
        testID="chart"
      />
    );

    // The empty series is skipped, the other two render.
    expect(polylines()).toHaveLength(2);
    expect(serialize()).not.toMatch(/NaN/);

    // The single point lands at its real x, not stretched across the plot.
    const [single] = polylines().map(parsePoints);
    expect(single[0].x).toBe(single[1].x);
  });

  it('falls back to the placeholder when every series is empty', () => {
    render(<LineChart series={[{ data: [] }, { data: [] }]} height={HEIGHT} />);
    expect(screen.getByText('Not enough data yet')).toBeTruthy();
  });

  it('filters non-finite points out of every series', () => {
    render(
      <LineChart
        series={[
          {
            data: [
              { x: 0, y: Number.NaN },
              { x: 1, y: 5 },
              { x: Number.POSITIVE_INFINITY, y: 2 },
              { x: 2, y: 7 },
            ],
          },
          { data: [{ x: 0, y: Number.NEGATIVE_INFINITY }, { x: 1, y: 6 }] },
        ]}
        height={HEIGHT}
        goalLine={Number.NaN}
        testID="chart"
      />
    );

    expect(serialize()).not.toMatch(/NaN/);
    expect(serialize()).not.toMatch(/Infinity/);
  });

  it('keeps flat multi-series data on a valid domain', () => {
    render(
      <LineChart
        series={[
          { data: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
          { data: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
        ]}
        height={HEIGHT}
        testID="chart"
      />
    );

    expect(serialize()).not.toMatch(/NaN/);
    expect(polylines()).toHaveLength(2);
  });

  it('includes the goal line in the shared domain', () => {
    render(
      <LineChart
        series={[{ data: ramp(80, 82, 5) }]}
        goalLine={60}
        height={HEIGHT}
        yFormatter={(n) => n.toFixed(0)}
        testID="chart"
      />
    );

    // The y-axis must stretch down to the goal, not stop at the data minimum.
    expect(Number(screen.getAllByText(/^\d+$/)[1].props.children)).toBeLessThanOrEqual(60);
    expect(serialize()).not.toMatch(/NaN/);
  });

  it('honours showDots', () => {
    const view = render(
      <LineChart series={[{ data: ramp(1, 5, 5), showDots: true }]} height={HEIGHT} />
    );
    const withDots = serialize();

    view.rerender(<LineChart series={[{ data: ramp(1, 5, 5), showDots: false }]} height={HEIGHT} />);
    const withoutDots = serialize();

    expect(withDots.length).toBeGreaterThan(withoutDots.length);
    expect(withDots).not.toMatch(/NaN/);
    expect(withoutDots).not.toMatch(/NaN/);
  });

  it('renders an area fill only when a series opts in', () => {
    const view = render(<LineChart series={[{ data: ramp(1, 5, 5) }]} height={HEIGHT} />);
    expect(serialize()).not.toMatch(/LinearGradient|brushRef/);

    view.rerender(
      <LineChart series={[{ data: ramp(1, 5, 5), showArea: true }]} height={HEIGHT} />
    );
    expect(serialize()).toMatch(/LinearGradient/);
    expect(serialize()).toMatch(/brushRef/);
  });
});

describe('LineChart single-series compatibility', () => {
  it('keeps the historical stroke, area and dot for a `data`-only chart', () => {
    render(<LineChart data={ramp(70, 75, 6)} height={HEIGHT} testID="chart" />);

    const nodes = screen.UNSAFE_getAllByType(Polyline);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].props.strokeWidth).toBe(2.5);
    expect(nodes[0].props.strokeDasharray).toBeUndefined();
    // showArea defaults to true for `data`.
    expect(serialize()).toMatch(/LinearGradient/);
  });

  it('still spreads a lone point across the plot', () => {
    render(<LineChart data={[{ x: 5, y: 80 }]} height={HEIGHT} testID="chart" />);

    const [only] = polylines().map(parsePoints);
    expect(only[0].x).toBeLessThan(only[1].x);
    expect(only[0].y).toBe(only[1].y);
  });

  it('never renders a legend for a single series', () => {
    render(<LineChart data={ramp(1, 5, 5)} height={HEIGHT} showLegend />);
    expect(screen.UNSAFE_getAllByType(Polyline)).toHaveLength(1);
  });
});
