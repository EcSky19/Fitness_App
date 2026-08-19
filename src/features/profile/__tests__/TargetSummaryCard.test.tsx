import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { formatEnergy, macrosToCalories } from '@/domain';

import { TargetSummaryCard } from '../TargetSummaryCard';
import { computePlan } from '../useGoalEditor';

const PLAN = computePlan({
  sex: 'male',
  weightKg: 80,
  heightCm: 180,
  ageYears: 30,
  activityLevel: 'moderate',
  goalType: 'cut',
  rateKgPerWeek: -0.5,
  macroSplit: 'balanced',
});

function textOf(testID: string): string {
  const { children } = screen.getByTestId(testID).props as { children: unknown };
  return (Array.isArray(children) ? children : [children]).join('');
}

function gramsOf(testID: string): number {
  return Number(textOf(`${testID}-grams`).replace(/[^\d.]/g, ''));
}

describe('TargetSummaryCard', () => {
  it('renders macro grams that reconstruct the calorie target', () => {
    render(<TargetSummaryCard targets={PLAN.targets} />);

    const protein = gramsOf('target-protein');
    const carbs = gramsOf('target-carbs');
    const fat = gramsOf('target-fat');

    expect(protein).toBe(Math.round(PLAN.targets.protein));
    expect(carbs).toBe(Math.round(PLAN.targets.carbs));
    expect(fat).toBe(Math.round(PLAN.targets.fat));

    const fromMacros = macrosToCalories({ protein, carbs, fat });
    expect(Math.abs(fromMacros - PLAN.targets.calories)).toBeLessThanOrEqual(
      PLAN.targets.calories * 0.02
    );

    expect(screen.getByTestId('target-calories')).toBeTruthy();
    expect(screen.getByTestId('target-macro-bar')).toBeTruthy();
  });

  it('shows a before -> after comparison when previous targets are supplied', () => {
    const before = { calories: PLAN.targets.calories + 300, protein: 120, carbs: 190, fat: 60 };
    render(<TargetSummaryCard targets={PLAN.targets} compareTo={before} />);

    expect(textOf('target-calories-delta')).toBe('\u2212300');
    expect(textOf('target-calories-before')).toBe(`was ${formatEnergy(before.calories, 'kcal')}`);
    expect(textOf('target-protein-delta')).toBe(
      `+${Math.round(PLAN.targets.protein) - before.protein} g`
    );
  });

  it('does not render a delta row when nothing changed', () => {
    render(<TargetSummaryCard targets={PLAN.targets} compareTo={PLAN.targets} />);
    expect(screen.queryByTestId('target-calories-delta')).toBeNull();
    expect(screen.queryByTestId('target-protein-delta')).toBeNull();
    expect(screen.getByTestId('target-calories-before')).toBeTruthy();
  });

  it('surfaces a safety warning and the custom badge', () => {
    render(
      <TargetSummaryCard
        targets={{ ...PLAN.targets, calories: 1100 }}
        isManualOverride
        warning="That is below the 1,500 kcal safety floor."
      />
    );
    expect(screen.getByTestId('target-warning')).toBeTruthy();
    expect(screen.getByText(/safety floor/i)).toBeTruthy();
    expect(screen.getByText('Custom')).toBeTruthy();
  });
});
