import { fireEvent, render, screen } from '@testing-library/react-native';
import { addDays, format } from 'date-fns';
import React from 'react';
import { Text } from 'react-native';

import type { MealType } from '@/types';
import {
  Badge,
  Card,
  Chip,
  DateStepper,
  Divider,
  EmptyState,
  KeyboardAvoider,
  ListRow,
  Screen,
  SectionHeader,
  SegmentedControl,
  Sheet,
  StatTile,
} from '@/ui';

const todayISO = (): string => format(new Date(), 'yyyy-MM-dd');
const shiftISO = (days: number): string => format(addDays(new Date(), days), 'yyyy-MM-dd');

describe('SegmentedControl', () => {
  const options: { label: string; value: MealType }[] = [
    { label: 'Breakfast', value: 'breakfast' },
    { label: 'Lunch', value: 'lunch' },
    { label: 'Dinner', value: 'dinner' },
  ];

  it('reports the newly selected value', () => {
    const onChange = jest.fn();
    render(<SegmentedControl options={options} value="breakfast" onChange={onChange} />);

    fireEvent.press(screen.getByRole('tab', { name: 'Dinner' }));
    expect(onChange).toHaveBeenCalledWith('dinner');
  });

  it('marks the active segment as selected', () => {
    render(<SegmentedControl options={options} value="lunch" onChange={jest.fn()} size="sm" />);

    expect(screen.getByRole('tab', { name: 'Lunch' }).props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByRole('tab', { name: 'Dinner' }).props.accessibilityState).toMatchObject({
      selected: false,
    });
  });

  it('supports numeric option values', () => {
    const onChange = jest.fn();
    render(
      <SegmentedControl
        options={[
          { label: '7d', value: 7 },
          { label: '30d', value: 30 },
        ]}
        value={7}
        onChange={onChange}
      />
    );

    fireEvent.press(screen.getByRole('tab', { name: '30d' }));
    expect(onChange).toHaveBeenCalledWith(30);
  });
});

describe('DateStepper', () => {
  it('labels today and yesterday', () => {
    const view = render(<DateStepper date={todayISO()} onChange={jest.fn()} />);
    expect(screen.getByText('Today')).toBeTruthy();

    view.rerender(<DateStepper date={shiftISO(-1)} onChange={jest.fn()} />);
    expect(screen.getByText('Yesterday')).toBeTruthy();

    view.rerender(<DateStepper date={shiftISO(-5)} onChange={jest.fn()} />);
    expect(screen.getByText(format(addDays(new Date(), -5), 'EEE, MMM d'))).toBeTruthy();
  });

  it('steps backwards and forwards', () => {
    const onChange = jest.fn();
    render(<DateStepper date={shiftISO(-3)} onChange={onChange} />);

    fireEvent.press(screen.getByRole('button', { name: 'Previous day' }));
    expect(onChange).toHaveBeenLastCalledWith(shiftISO(-4));

    fireEvent.press(screen.getByRole('button', { name: 'Next day' }));
    expect(onChange).toHaveBeenLastCalledWith(shiftISO(-2));
  });

  it('disables the future', () => {
    const onChange = jest.fn();
    render(<DateStepper date={todayISO()} onChange={onChange} />);

    const next = screen.getByRole('button', { name: 'Next day' });
    expect(next.props.accessibilityState).toMatchObject({ disabled: true });

    fireEvent.press(next);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('falls back to today for a malformed date', () => {
    render(<DateStepper date="not-a-date" onChange={jest.fn()} />);
    expect(screen.getByText('Today')).toBeTruthy();
  });
});

describe('layout + surface components', () => {
  it('Screen renders a header without a SafeAreaProvider', () => {
    render(
      <Screen title="Today" subtitle="Tuesday" headerRight={<Text>edit</Text>} testID="screen">
        <Text>content</Text>
      </Screen>
    );

    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Tuesday')).toBeTruthy();
    expect(screen.getByText('edit')).toBeTruthy();
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('Screen renders non-scrollable content', () => {
    render(
      <Screen title="Scan" scrollable={false} padded={false}>
        <Text>camera</Text>
      </Screen>
    );
    expect(screen.getByText('camera')).toBeTruthy();
  });

  it('Screen wires up pull-to-refresh', () => {
    const onRefresh = jest.fn();
    render(
      <Screen title="Diary" refreshing onRefresh={onRefresh}>
        <Text>rows</Text>
      </Screen>
    );
    expect(screen.getByText('rows')).toBeTruthy();
  });

  it('Card fires onPress when interactive', () => {
    const onPress = jest.fn();
    render(
      <Card onPress={onPress} accessibilityLabel="summary">
        <Text>card body</Text>
      </Card>
    );

    fireEvent.press(screen.getByRole('button', { name: 'summary' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('Sheet renders its content and closes from the backdrop', () => {
    const onClose = jest.fn();
    render(
      <Sheet visible onClose={onClose} title="Add food">
        <Text>sheet body</Text>
      </Sheet>
    );

    expect(screen.getByText('Add food')).toBeTruthy();
    expect(screen.getByText('sheet body')).toBeTruthy();

    fireEvent.press(screen.getAllByRole('button', { name: 'Close' })[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it('KeyboardAvoider renders children', () => {
    render(
      <KeyboardAvoider>
        <Text>form</Text>
      </KeyboardAvoider>
    );
    expect(screen.getByText('form')).toBeTruthy();
  });
});

describe('content components', () => {
  it('ListRow exposes a combined accessibility label and fires callbacks', () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    render(
      <ListRow
        title="Greek yogurt"
        subtitle="200 g"
        meta="180 kcal"
        leftIcon="nutrition"
        onPress={onPress}
        onLongPress={onLongPress}
        right={<Text>›</Text>}
      />
    );

    const row = screen.getByRole('button', { name: 'Greek yogurt, 200 g, 180 kcal' });
    fireEvent.press(row);
    fireEvent(row, 'longPress');
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('ListRow renders as a static row without handlers', () => {
    render(<ListRow title="Steps" meta="8,240" destructive />);
    expect(screen.getByText('Steps')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('StatTile renders value and optional press handler', () => {
    const onPress = jest.fn();
    render(
      <StatTile label="Calories" value={1850} sublabel="of 2,300" icon="flame" onPress={onPress} />
    );

    fireEvent.press(screen.getByRole('button', { name: 'Calories, 1850, of 2,300' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('EmptyState renders an action', () => {
    const onAction = jest.fn();
    render(
      <EmptyState
        icon="restaurant"
        title="Nothing logged"
        message="Add your first meal to get started."
        actionLabel="Add food"
        onAction={onAction}
      />
    );

    expect(screen.getByText('Nothing logged')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Add food' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('Chip toggles and reflects selection', () => {
    const onPress = jest.fn();
    render(<Chip label="Favorites" selected onPress={onPress} icon="star" />);

    const chip = screen.getByRole('button', { name: 'Favorites' });
    expect(chip.props.accessibilityState).toMatchObject({ selected: true });
    fireEvent.press(chip);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('Badge, SectionHeader and Divider render', () => {
    render(
      <>
        <Badge label="New" tone="success" />
        <SectionHeader title="Breakfast" right={<Text>420 kcal</Text>} />
        <Divider inset={16} />
      </>
    );

    expect(screen.getByText('New')).toBeTruthy();
    expect(screen.getByText('BREAKFAST')).toBeTruthy();
    expect(screen.getByText('420 kcal')).toBeTruthy();
  });
});
