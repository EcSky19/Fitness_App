import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/ui';
import { describeGoal, roundTo, toDisplayWeight } from '@/domain';
import type { GoalType, WeightUnit } from '@/types';

import { rateMagnitudeBounds } from './useGoalEditor';

export interface RateBounds {
  min: number;
  max: number;
  step: number;
}

export interface RateStepperProps {
  goalType: GoalType;
  /** Signed kg/week, exactly as stored on the goal. */
  value: number;
  bounds: RateBounds;
  weightUnit: WeightUnit;
  onNudge: (direction: 1 | -1) => void;
  testID?: string;
}

function formatRate(rateKgPerWeek: number, unit: WeightUnit): string {
  const magnitude = Math.abs(toDisplayWeight(rateKgPerWeek, unit));
  const dp = unit === 'lb' ? 1 : 2;
  return `${roundTo(magnitude, dp).toFixed(dp)} ${unit}/week`;
}

/**
 * +/- pace control. No slider library is used — the app ships no slider
 * dependency, so the rate is nudged in `bounds.step` increments.
 */
export function RateStepper({
  goalType,
  value,
  bounds,
  weightUnit,
  onNudge,
  testID,
}: RateStepperProps): React.JSX.Element {
  const { colors, spacing, radius, typography } = useTheme();

  const press = useCallback(
    (direction: 1 | -1) => {
      void Haptics.selectionAsync();
      onNudge(direction);
    },
    [onNudge]
  );

  const magnitude = Math.abs(value);
  const { slowest, fastest } = rateMagnitudeBounds(bounds);
  const isMaintain = goalType === 'maintain';
  const atSlowest = magnitude <= slowest + 1e-9;
  const atFastest = magnitude >= fastest - 1e-9;

  return (
    <View testID={testID}>
      <View
        style={[
          styles.bar,
          { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.xs },
        ]}
      >
        <StepButton
          icon="remove"
          label="Slower pace"
          disabled={isMaintain || atSlowest}
          onPress={() => press(-1)}
          testID="rate-decrease"
        />
        <View style={styles.readout}>
          <Text style={[typography.h3, { color: colors.text }]} testID="rate-value">
            {isMaintain ? 'Hold steady' : formatRate(value, weightUnit)}
          </Text>
        </View>
        <StepButton
          icon="add"
          label="Faster pace"
          disabled={isMaintain || atFastest}
          onPress={() => press(1)}
          testID="rate-increase"
        />
      </View>
      <Text
        style={[typography.caption, { color: colors.textMuted, marginTop: spacing.sm }]}
        testID="rate-description"
      >
        {describeGoal(goalType, value, weightUnit)}
      </Text>
    </View>
  );
}

interface StepButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}

function StepButton({ icon, label, disabled, onPress, testID }: StepButtonProps): React.JSX.Element {
  const { colors, radius } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.step,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radius.sm,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={20} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  readout: { alignItems: 'center', flex: 1 },
  step: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    height: 40,
    justifyContent: 'center',
    width: 48,
  },
});
