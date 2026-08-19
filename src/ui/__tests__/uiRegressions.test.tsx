/**
 * Regression tests for bugs found by auditing the shared UI kit: contrast,
 * layout correctness, interaction edge cases and accessibility.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Polyline } from 'react-native-svg';

import {
  Button,
  Chip,
  Divider,
  LineChart,
  ListRow,
  MacroBar,
  NumberField,
  ProgressRing,
  SegmentedControl,
  Sheet,
  TextField,
  darkPalette,
  lightPalette,
  type Palette,
} from '@/ui';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 contrast ratio between two opaque hex colours. */
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function flatStyle(node: { props: { style?: unknown } }): Record<string, unknown> {
  return (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
}

type RenderNode = {
  type: string;
  props: { style?: unknown };
  children: (RenderNode | string)[] | null;
};

function isRenderNode(value: RenderNode | string): value is RenderNode {
  return typeof value !== 'string';
}

/** Host nodes from `root` down to (and including) the first match, or []. */
function pathTo(root: RenderNode, match: (node: RenderNode) => boolean): RenderNode[] {
  if (match(root)) return [root];
  for (const child of root.children ?? []) {
    if (!isRenderNode(child)) continue;
    const below = pathTo(child, match);
    if (below.length > 0) return [root, ...below];
  }
  return [];
}

/* -------------------------------------------------------------------------- */
/* theme                                                                      */
/* -------------------------------------------------------------------------- */

describe('theme contrast', () => {
  const cases: [string, Palette][] = [
    ['dark', darkPalette],
    ['light', lightPalette],
  ];

  it.each(cases)('%s: body text tokens are readable on surface and bg', (_name, palette) => {
    for (const bg of [palette.surface, palette.bg] as const) {
      expect(contrastRatio(palette.text, bg)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(palette.textMuted, bg)).toBeGreaterThanOrEqual(4.5);
      // textFaint carries helper text, placeholders and chart axis labels — it
      // still has to clear WCAG AA for normal text.
      expect(contrastRatio(palette.textFaint, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(cases)('%s: keeps a visible muted / faint hierarchy', (_name, palette) => {
    expect(palette.textFaint).not.toBe(palette.textMuted);
    expect(contrastRatio(palette.textMuted, palette.surface)).toBeGreaterThan(
      contrastRatio(palette.textFaint, palette.surface)
    );
  });
});

/* -------------------------------------------------------------------------- */
/* ProgressRing                                                               */
/* -------------------------------------------------------------------------- */

describe('ProgressRing accessibility', () => {
  it('exposes a progressbar role and its value', () => {
    render(<ProgressRing progress={0.75} label="1,850" sublabel="kcal left" testID="ring" />);

    const ring = screen.getByRole('progressbar');
    expect(ring.props.accessibilityValue).toMatchObject({ min: 0, max: 100, now: 75 });
    expect(ring.props.accessibilityLabel).toContain('1,850');
  });

  it('reports over-target progress instead of silently capping the announcement', () => {
    render(<ProgressRing progress={1.5} label="300" />);

    const ring = screen.getByRole('progressbar');
    expect(ring.props.accessibilityValue.now).toBe(100);
    expect(ring.props.accessibilityValue.text).toBe('150%');
  });

  it('clamps a non-finite progress to 0% instead of announcing NaN', () => {
    render(<ProgressRing progress={Number.NaN} />);

    const ring = screen.getByRole('progressbar');
    expect(ring.props.accessibilityValue).toMatchObject({ now: 0, text: '0%' });
  });

  it('leaves accessibility to the caller when custom children are supplied', () => {
    render(
      <ProgressRing progress={0.4} testID="ring">
        <View accessible accessibilityLabel="1,200 calories left">
          <Text>1,200</Text>
        </View>
      </ProgressRing>
    );

    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByLabelText('1,200 calories left')).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Button                                                                     */
/* -------------------------------------------------------------------------- */

describe('Button', () => {
  it('keeps its label mounted while loading so the width does not collapse', () => {
    const view = render(<Button title="Save entry" onPress={jest.fn()} />);
    const idleStyle = flatStyle(view.toJSON() as never);

    view.rerender(<Button title="Save entry" onPress={jest.fn()} loading />);

    // The label still occupies the button, just hidden behind the spinner.
    expect(screen.getByText('Save entry')).toBeTruthy();
    expect(screen.UNSAFE_getAllByType(ActivityIndicator)).toHaveLength(1);
    const loadingStyle = flatStyle(view.toJSON() as never);
    expect(loadingStyle.height).toBe(idleStyle.height);
  });

  it('hides the label from the spinner overlay so it cannot be tapped through', () => {
    const view = render(<Button title="Save entry" onPress={jest.fn()} loading />);
    const root = view.toJSON() as { children: { props: { style?: unknown } }[] };
    const [labelRow] = root.children;
    expect(flatStyle(labelRow as never).opacity).toBe(0);
  });

  it('pads small buttons up to a 44pt touch target', () => {
    render(<Button title="Edit" onPress={jest.fn()} size="sm" />);
    const button = screen.getByRole('button', { name: 'Edit' });
    // sm is 34pt tall: 5pt of slop top and bottom makes it 44pt.
    expect(button.props.hitSlop).toMatchObject({ top: 5, bottom: 5 });
  });

  it('does not add slop to buttons that are already big enough', () => {
    render(<Button title="Log" onPress={jest.fn()} size="lg" />);
    expect(screen.getByRole('button', { name: 'Log' }).props.hitSlop).toMatchObject({
      top: 0,
      bottom: 0,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Chip                                                                       */
/* -------------------------------------------------------------------------- */

describe('Chip', () => {
  it('extends the vertical touch target beyond its 32pt pill', () => {
    render(<Chip label="Favorites" onPress={jest.fn()} />);
    const chip = screen.getByRole('button', { name: 'Favorites' });
    expect(chip.props.hitSlop).toMatchObject({ top: 6, bottom: 6 });
  });
});

/* -------------------------------------------------------------------------- */
/* Divider                                                                    */
/* -------------------------------------------------------------------------- */

describe('Divider', () => {
  it('does not overflow its parent when inset', () => {
    const view = render(<Divider inset={16} />);
    const style = flatStyle(view.toJSON() as never);

    expect(style.marginLeft).toBe(16);
    // width:'100%' plus a left margin renders 16px wider than the container.
    expect(style.width).not.toBe('100%');
  });

  it('still spans the full width with no inset', () => {
    const view = render(<Divider />);
    expect(flatStyle(view.toJSON() as never).width).toBe('100%');
  });
});

/* -------------------------------------------------------------------------- */
/* Sheet                                                                      */
/* -------------------------------------------------------------------------- */

describe('Sheet', () => {
  it('gives the keyboard avoider a definite height so maxHeight applies', () => {
    render(
      <Sheet visible onClose={jest.fn()} title="Add food">
        <Text>body</Text>
      </Sheet>
    );

    const avoider = screen.UNSAFE_getByType(KeyboardAvoidingView);
    // Without flex:1 the avoider is content-sized, and the sheet's percentage
    // maxHeight resolves against an indefinite parent (i.e. is ignored).
    expect(flatStyle(avoider as never).flex).toBe(1);
  });

  it('scrolls long content instead of clipping it', () => {
    render(
      <Sheet visible onClose={jest.fn()} title="Log a workout">
        <Text>body</Text>
      </Sheet>
    );

    expect(screen.UNSAFE_getAllByType(ScrollView).length).toBeGreaterThan(0);
    expect(screen.getByText('body')).toBeTruthy();
  });

  it('can opt out of the internal scroll view', () => {
    render(
      <Sheet visible onClose={jest.fn()} title="Log a workout" scrollable={false}>
        <Text>body</Text>
      </Sheet>
    );

    expect(screen.UNSAFE_queryAllByType(ScrollView)).toHaveLength(0);
    expect(screen.getByText('body')).toBeTruthy();
  });

  /**
   * jest-expo runs react-test-renderer, which has no Yoga instance (RN ships
   * Yoga as C++ only) and no DOM layout, so no test here can measure a real
   * clamped height in pixels. What is assertable is the invariant the clamp is
   * made of: between the box carrying maxHeight and the content, every box must
   * either be allowed to shrink or be a scroller. RN defaults flexShrink to 0,
   * so one rigid wrapper lets tall content grow past 90% and push the sheet's
   * own controls (in LogWorkoutSheet, the cancel button) off screen. Walking
   * the real render tree rather than naming a style also catches a future
   * wrapper being inserted into that chain.
   */
  it.each([
    ['scrollable', true],
    ['non-scrollable', false],
  ])('clamps %s content: every box under maxHeight shrinks or scrolls', (_name, scrollable) => {
    render(
      <Sheet visible onClose={jest.fn()} title="Log a workout" scrollable={scrollable}>
        <Text>body</Text>
      </Sheet>
    );

    const chain = pathTo(
      screen.toJSON() as unknown as RenderNode,
      (node) => node.children?.includes('body') ?? false
    );
    const sheetIndex = chain.findIndex((node) => flatStyle(node).maxHeight === '90%');
    expect(sheetIndex).toBeGreaterThanOrEqual(0);

    const boxes = chain.slice(sheetIndex + 1, -1);
    expect(boxes.length).toBeGreaterThan(0);

    let scroller = false;
    for (const box of boxes) {
      const boxStyle = flatStyle(box);
      expect(boxStyle.flexShrink).toBeGreaterThan(0);
      expect(boxStyle.height).toBeUndefined();
      expect(boxStyle.minHeight).toBeUndefined();
      // Overflow below a scroller is intentional, so the chain ends there.
      if (box.type === 'RCTScrollView') {
        scroller = true;
        break;
      }
    }
    expect(scroller).toBe(scrollable);
  });

  it('lays its content out identically whether or not it scrolls', () => {
    // RN's own jest mock for ScrollView renders `<View>{children}</View>` and
    // drops contentContainerStyle, so the scrolling branch's content box is not
    // reachable through the render tree; read it off the component instead.
    const scrolling = render(
      <Sheet visible onClose={jest.fn()} title="Log a workout">
        <Text>body</Text>
      </Sheet>
    );
    const scrollingContent = StyleSheet.flatten(
      scrolling.UNSAFE_getByType(ScrollView).props.contentContainerStyle
    );
    scrolling.unmount();

    const staticSheet = render(
      <Sheet visible onClose={jest.fn()} title="Log a workout" scrollable={false}>
        <Text>body</Text>
      </Sheet>
    );
    const staticContent = flatStyle(
      pathTo(
        staticSheet.toJSON() as unknown as RenderNode,
        (node) => node.children?.includes('body') ?? false
      ).at(-2) as RenderNode
    );

    expect(staticContent).toEqual(scrollingContent);
    expect(staticContent.flexShrink).toBeGreaterThan(0);
  });

  it('dismisses the keyboard when closed from the backdrop or the close button', () => {    const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
    const onClose = jest.fn();

    render(
      <Sheet visible onClose={onClose} title="Add food">
        <Text>body</Text>
      </Sheet>
    );

    fireEvent.press(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalled();

    dismiss.mockClear();
    fireEvent.press(screen.getByLabelText('Close sheet'));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(dismiss).toHaveBeenCalled();

    dismiss.mockRestore();
  });
});

/* -------------------------------------------------------------------------- */
/* NumberField / TextField                                                    */
/* -------------------------------------------------------------------------- */

describe('NumberField', () => {
  it('re-formats the displayed text when decimals changes', () => {
    const onChange = jest.fn();
    const view = render(
      <NumberField label="Weight" value={12.345} onChange={onChange} decimals={2} />
    );
    expect(screen.getByLabelText('Weight').props.value).toBe('12.35');

    view.rerender(<NumberField label="Weight" value={12.345} onChange={onChange} decimals={0} />);
    expect(screen.getByLabelText('Weight').props.value).toBe('12');
  });

  it('does not re-emit an unchanged value on blur', () => {
    const onChange = jest.fn();
    render(<NumberField label="Calories" value={250} onChange={onChange} min={0} />);

    const input = screen.getByLabelText('Calories');
    fireEvent(input, 'focus');
    fireEvent(input, 'blur');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('still emits on blur when the value was normalised', () => {
    const onChange = jest.fn();
    render(<NumberField label="Reps" value={null} onChange={onChange} min={1} max={100} />);

    const input = screen.getByLabelText('Reps');
    fireEvent.changeText(input, '500');
    fireEvent(input, 'blur');
    expect(onChange).toHaveBeenLastCalledWith(100);
  });

  it('marks a read-only field as disabled for screen readers', () => {
    render(<NumberField label="Grams" value={5} onChange={jest.fn()} editable={false} />);
    expect(screen.getByLabelText('Grams').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('treats a non-finite value as empty rather than rendering NaN', () => {
    render(<NumberField label="Grams" value={Number.NaN} onChange={jest.fn()} />);
    expect(screen.getByLabelText('Grams').props.value).toBe('');
  });
});

describe('TextField', () => {
  it('marks a read-only field as disabled for screen readers', () => {
    render(<TextField label="Name" value="x" onChangeText={jest.fn()} editable={false} />);
    expect(screen.getByLabelText('Name').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* MacroBar                                                                   */
/* -------------------------------------------------------------------------- */

describe('MacroBar', () => {
  it('groups the bar into a single accessibility element', () => {
    render(<MacroBar protein={30} carbs={40} fat={10} testID="bar" />);
    const bar = screen.getByTestId('bar');
    expect(bar.props.accessible).toBe(true);
    expect(bar.props.accessibilityLabel).toBe('Protein 30g, carbs 40g, fat 10g');
  });
});

/* -------------------------------------------------------------------------- */
/* SegmentedControl                                                           */
/* -------------------------------------------------------------------------- */

describe('SegmentedControl', () => {
  const options = [
    { label: '7d', value: 7 },
    { label: '30d', value: 30 },
  ];

  it('extends short segments vertically towards a 44pt touch target', () => {
    render(<SegmentedControl options={options} value={7} onChange={jest.fn()} />);
    const tab = screen.getByRole('tab', { name: '30d' });
    expect(tab.props.hitSlop).toMatchObject({ top: 6, bottom: 6, left: 0, right: 0 });
  });

  it('adds more slop to the compact size', () => {
    render(<SegmentedControl options={options} value={7} onChange={jest.fn()} size="sm" />);
    expect(screen.getByRole('tab', { name: '30d' }).props.hitSlop).toMatchObject({
      top: 10,
      bottom: 10,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* ListRow                                                                    */
/* -------------------------------------------------------------------------- */

describe('ListRow', () => {
  it('lets a long meta column shrink instead of pushing the row wide', () => {
    render(
      <ListRow
        title="Overnight oats with peanut butter and banana"
        meta="1,284 kcal · 210 g · 3 servings"
        testID="row"
      />
    );

    const meta = screen.getByText('1,284 kcal · 210 g · 3 servings');
    expect(flatStyle(meta as never).flexShrink).toBe(1);
    expect(meta.props.numberOfLines).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* LineChart                                                                  */
/* -------------------------------------------------------------------------- */

describe('LineChart legend', () => {
  it('omits legend entries for series that draw nothing', () => {
    render(
      <LineChart
        series={[
          { data: [{ x: 0, y: 1 }, { x: 1, y: 2 }], label: 'Weight' },
          { data: [], label: 'Trend', dashed: true },
        ]}
        height={200}
      />
    );

    expect(screen.UNSAFE_getAllByType(Polyline)).toHaveLength(1);
    // A legend swatch for a line that is not on the chart is misleading.
    expect(screen.queryByText('Trend')).toBeNull();
  });
});
