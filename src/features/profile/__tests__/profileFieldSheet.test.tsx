import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import type { UserProfile, HeightUnit, WeightUnit } from '@/types';
import { fromDisplayWeight, ftInToCm, roundTo } from '@/domain';

import { ProfileFieldSheet, type ProfileField } from '../ProfileFieldSheet';

const BASE: UserProfile = {
  id: 'me',
  name: 'Alex',
  sex: 'male',
  birthDate: '1990-06-15',
  heightCm: 180,
  currentWeightKg: 80,
  goalWeightKg: 75,
  activityLevel: 'moderate',
  weightUnit: 'kg',
  heightUnit: 'cm',
  onboardedAt: '2024-01-01T00:00:00.000Z',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

function renderSheet(
  field: ProfileField,
  overrides: Partial<UserProfile> = {},
  units: { weightUnit?: WeightUnit; heightUnit?: HeightUnit } = {}
) {
  const profile = { ...BASE, ...overrides };
  const onSave = jest.fn();
  const onClose = jest.fn();
  const utils = render(
    <ProfileFieldSheet
      field={field}
      profile={profile}
      weightUnit={units.weightUnit ?? profile.weightUnit}
      heightUnit={units.heightUnit ?? profile.heightUnit}
      onClose={onClose}
      onSave={onSave}
    />
  );
  return { onSave, onClose, profile, ...utils };
}

describe('ProfileFieldSheet — weight', () => {
  it('saves an unchanged kg weight without drifting', () => {
    const { onSave } = renderSheet('weight');
    fireEvent.press(screen.getByTestId('field-save'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].currentWeightKg).toBe(80);
  });

  it('saves a lb weight back to the correct kilograms', () => {
    // 80 kg displays as 176.4 lb; saving unchanged must round-trip to ~80 kg.
    const { onSave } = renderSheet('weight', {}, { weightUnit: 'lb' });
    expect(screen.getByTestId('field-weight').props.value).toBe('176.4');

    fireEvent.changeText(screen.getByTestId('field-weight'), '154');
    fireEvent.press(screen.getByTestId('field-save'));

    const kg = onSave.mock.calls[0][0].currentWeightKg;
    expect(kg).toBeCloseTo(fromDisplayWeight(154, 'lb'), 2);
  });

  it('does not drift over repeated lb save cycles', () => {
    let kg = 80;
    for (let i = 0; i < 5; i += 1) {
      const { onSave, unmount } = renderSheet('weight', { currentWeightKg: kg }, { weightUnit: 'lb' });
      fireEvent.press(screen.getByTestId('field-save'));
      kg = onSave.mock.calls[0][0].currentWeightKg as number;
      unmount();
    }
    expect(kg).toBeCloseTo(80, 1);
  });

  it('blocks an absurd weight and keeps the old value', () => {
    const { onSave } = renderSheet('weight');
    fireEvent.changeText(screen.getByTestId('field-weight'), '999');
    expect(screen.getByTestId('field-save').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('field-save'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('converts the shown value when toggling kg -> lb -> kg without drift', () => {
    renderSheet('weight');
    expect(screen.getByTestId('field-weight').props.value).toBe('80');

    fireEvent.press(within(screen.getByTestId('weight-unit-toggle')).getByText('lb'));
    expect(screen.getByTestId('field-weight').props.value).toBe('176.4');

    fireEvent.press(within(screen.getByTestId('weight-unit-toggle')).getByText('kg'));
    expect(screen.getByTestId('field-weight').props.value).toBe('80');
  });
});

describe('ProfileFieldSheet — height', () => {
  it('saves an unchanged cm height', () => {
    const { onSave } = renderSheet('height');
    fireEvent.press(screen.getByTestId('field-save'));
    expect(onSave.mock.calls[0][0].heightCm).toBe(180);
  });

  it('saves a ft/in height back to the correct centimetres', () => {
    const { onSave } = renderSheet('height', {}, { heightUnit: 'ft_in' });
    expect(screen.getByTestId('height-ft').props.value).toBe('5');
    expect(screen.getByTestId('height-in').props.value).toBe('11');

    fireEvent.changeText(screen.getByTestId('height-in'), '10');
    fireEvent.press(screen.getByTestId('field-save'));

    const cm = onSave.mock.calls[0][0].heightCm as number;
    expect(cm).toBeCloseTo(roundTo(ftInToCm(5, 10), 1), 1);
  });
});

describe('ProfileFieldSheet — name', () => {
  it('trims whitespace before saving', () => {
    const { onSave } = renderSheet('name');
    fireEvent.changeText(screen.getByTestId('field-name'), '  Sam  ');
    fireEvent.press(screen.getByTestId('field-save'));
    expect(onSave.mock.calls[0][0].name).toBe('Sam');
  });

  it('blocks an empty name', () => {
    const { onSave } = renderSheet('name');
    fireEvent.changeText(screen.getByTestId('field-name'), '   ');
    fireEvent.press(screen.getByTestId('field-save'));
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('ProfileFieldSheet — goal weight', () => {
  it('saves null when the goal weight is cleared', () => {
    const { onSave } = renderSheet('goalWeight');
    fireEvent.changeText(screen.getByTestId('field-goal-weight'), '');
    fireEvent.press(screen.getByTestId('field-save'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toEqual({ goalWeightKg: null });
  });
});

describe('ProfileFieldSheet — sex & activity', () => {
  it('saves a changed sex', () => {
    const { onSave } = renderSheet('sex');
    fireEvent.press(within(screen.getByTestId('field-sex')).getByText('Female'));
    fireEvent.press(screen.getByTestId('field-save'));
    expect(onSave.mock.calls[0][0]).toEqual({ sex: 'female' });
  });

  it('saves a changed activity level', () => {
    const { onSave } = renderSheet('activityLevel');
    fireEvent.press(screen.getByTestId('activity-option-very_active'));
    fireEvent.press(screen.getByTestId('field-save'));
    expect(onSave.mock.calls[0][0]).toEqual({ activityLevel: 'very_active' });
  });
});

describe('ProfileFieldSheet — birth date', () => {
  it('saves a valid changed date as an ISO string', () => {
    const { onSave } = renderSheet('birthDate');
    fireEvent.changeText(screen.getByTestId('dob-year'), '1985');
    fireEvent.press(screen.getByTestId('field-save'));
    expect(onSave.mock.calls[0][0]).toEqual({ birthDate: '1985-06-15' });
  });

  it('blocks saving when the date is incomplete', () => {
    const { onSave } = renderSheet('birthDate');
    fireEvent.changeText(screen.getByTestId('dob-day'), '');
    fireEvent.press(screen.getByTestId('field-save'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('blocks an implausible age (too young)', () => {
    const { onSave } = renderSheet('birthDate');
    const thisYear = new Date().getFullYear();
    fireEvent.changeText(screen.getByTestId('dob-year'), String(thisYear - 5));
    expect(screen.getByTestId('field-save').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('field-save'));
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('ProfileFieldSheet — height unit toggle', () => {
  it('saves the same centimetres after toggling cm -> ft/in and back', () => {
    const { onSave } = renderSheet('height');
    fireEvent.press(within(screen.getByTestId('height-unit-toggle')).getByText('ft / in'));
    fireEvent.press(within(screen.getByTestId('height-unit-toggle')).getByText('cm'));
    fireEvent.press(screen.getByTestId('field-save'));
    expect(onSave.mock.calls[0][0].heightCm).toBe(180);
  });

  it('blocks an out-of-range ft/in height', () => {
    const { onSave } = renderSheet('height', {}, { heightUnit: 'ft_in' });
    fireEvent.changeText(screen.getByTestId('height-ft'), '8');
    fireEvent.changeText(screen.getByTestId('height-in'), '11');
    fireEvent.press(screen.getByTestId('field-save'));
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('ProfileFieldSheet — cancel semantics', () => {
  it('restores the original value after an edit is cancelled and the sheet reopens', () => {
    const profile = { ...BASE };
    const onSave = jest.fn();
    const { rerender } = render(
      <ProfileFieldSheet
        field="weight"
        profile={profile}
        weightUnit="kg"
        heightUnit="cm"
        onClose={jest.fn()}
        onSave={onSave}
      />
    );

    fireEvent.changeText(screen.getByTestId('field-weight'), '90');
    expect(screen.getByTestId('field-weight').props.value).toBe('90');

    // Cancel closes the sheet (parent sets field back to null)…
    rerender(
      <ProfileFieldSheet
        field={null}
        profile={profile}
        weightUnit="kg"
        heightUnit="cm"
        onClose={jest.fn()}
        onSave={onSave}
      />
    );
    // …then the user reopens the same field.
    rerender(
      <ProfileFieldSheet
        field="weight"
        profile={profile}
        weightUnit="kg"
        heightUnit="cm"
        onClose={jest.fn()}
        onSave={onSave}
      />
    );

    expect(screen.getByTestId('field-weight').props.value).toBe('80');
    expect(onSave).not.toHaveBeenCalled();
  });
});
