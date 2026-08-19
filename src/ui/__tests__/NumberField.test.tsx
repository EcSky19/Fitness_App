import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import { NumberField, TextField } from '@/ui';

describe('NumberField', () => {
  it('emits null when the field is cleared', () => {
    const onChange = jest.fn();
    render(<NumberField label="Grams" value={120} onChange={onChange} />);

    fireEvent.changeText(screen.getByLabelText('Grams'), '');
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('emits null for non-numeric input', () => {
    const onChange = jest.fn();
    render(<NumberField label="Grams" value={null} onChange={onChange} />);

    fireEvent.changeText(screen.getByLabelText('Grams'), 'abc');
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('parses decimals', () => {
    const onChange = jest.fn();
    render(<NumberField label="Weight" value={null} onChange={onChange} decimals={2} />);

    fireEvent.changeText(screen.getByLabelText('Weight'), '12.5');
    expect(onChange).toHaveBeenLastCalledWith(12.5);
  });

  it('keeps partial input like "1." usable', () => {
    const onChange = jest.fn();
    render(<NumberField label="Weight" value={null} onChange={onChange} decimals={1} />);

    const input = screen.getByLabelText('Weight');
    fireEvent.changeText(input, '1.');
    expect(input.props.value).toBe('1.');
    expect(onChange).toHaveBeenLastCalledWith(1);

    fireEvent.changeText(input, '1.4');
    expect(onChange).toHaveBeenLastCalledWith(1.4);
  });

  it('drops the fraction when decimals is 0', () => {
    const onChange = jest.fn();
    render(<NumberField label="Calories" value={null} onChange={onChange} decimals={0} />);

    const input = screen.getByLabelText('Calories');
    fireEvent.changeText(input, '250.7');
    expect(input.props.value).toBe('250');
    expect(onChange).toHaveBeenLastCalledWith(250);
  });

  it('does not clamp while typing but clamps on blur', () => {
    const onChange = jest.fn();
    render(<NumberField label="Reps" value={null} onChange={onChange} min={1} max={100} />);

    const input = screen.getByLabelText('Reps');
    fireEvent.changeText(input, '500');
    expect(onChange).toHaveBeenLastCalledWith(500);

    fireEvent(input, 'blur');
    expect(onChange).toHaveBeenLastCalledWith(100);
    expect(input.props.value).toBe('100');
  });

  it('normalises an empty value on blur', () => {
    const onChange = jest.fn();
    render(<NumberField label="Reps" value={null} onChange={onChange} />);

    const input = screen.getByLabelText('Reps');
    fireEvent.changeText(input, '.');
    fireEvent(input, 'blur');
    expect(input.props.value).toBe('');
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('adopts external value changes', () => {
    const onChange = jest.fn();
    const view = render(<NumberField label="Grams" value={10} onChange={onChange} />);
    expect(screen.getByLabelText('Grams').props.value).toBe('10');

    view.rerender(<NumberField label="Grams" value={42.25} onChange={onChange} />);
    expect(screen.getByLabelText('Grams').props.value).toBe('42.25');
  });

  it('renders suffix, helper and error text', () => {
    const view = render(
      <NumberField label="Grams" value={5} onChange={jest.fn()} suffix="g" helper="per serving" />
    );
    expect(screen.getByText('g')).toBeTruthy();
    expect(screen.getByText('per serving')).toBeTruthy();

    view.rerender(
      <NumberField label="Grams" value={5} onChange={jest.fn()} suffix="g" error="Too high" />
    );
    expect(screen.getByText('Too high')).toBeTruthy();
  });
});

describe('TextField', () => {
  it('forwards typed text', () => {
    const onChangeText = jest.fn();
    render(<TextField label="Name" value="" onChangeText={onChangeText} placeholder="Food name" />);

    fireEvent.changeText(screen.getByLabelText('Name'), 'Greek yogurt');
    expect(onChangeText).toHaveBeenCalledWith('Greek yogurt');
  });

  it('prefers the error message over the helper text', () => {
    render(
      <TextField
        label="Name"
        value=""
        onChangeText={jest.fn()}
        helper="Required"
        error="Cannot be empty"
      />
    );

    expect(screen.getByText('Cannot be empty')).toBeTruthy();
    expect(screen.queryByText('Required')).toBeNull();
  });

  it('supports multiline and a trailing slot', () => {
    render(
      <TextField
        label="Notes"
        value="hi"
        onChangeText={jest.fn()}
        multiline
        right={<Text>unit</Text>}
      />
    );
    expect(screen.getByText('unit')).toBeTruthy();
  });
});
