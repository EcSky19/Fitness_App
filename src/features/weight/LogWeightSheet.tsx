/**
 * Log / edit a weigh-in. Values are entered in the display unit and converted
 * to kg exactly once, on save.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDateLabel, lastNDaysISO, todayISO } from '@/domain';
import {
  Button,
  Chip,
  KeyboardAvoider,
  NumberField,
  SegmentedControl,
  Sheet,
  TextField,
  useTheme,
} from '@/ui';
import type { WeightLog, WeightUnit } from '@/types';

import { useWeightForm } from './useWeightForm';
import { unitLabel } from './weightFormat';

export interface LogWeightSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Existing log to edit. */
  log?: WeightLog | null;
  /** Newest log overall: prefill + "big change" baseline. */
  latestLog?: WeightLog | null;
  /** Overrides the prefill, e.g. a weight imported from Health. */
  prefillKg?: number | null;
}

const UNIT_OPTIONS: { label: string; value: WeightUnit }[] = [
  { label: 'kg', value: 'kg' },
  { label: 'lb', value: 'lb' },
];

export function LogWeightSheet({
  visible,
  onClose,
  log = null,
  latestLog = null,
  prefillKg = null,
}: LogWeightSheetProps): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();
  const form = useWeightForm({ log, latestLog, prefillKg, active: visible });

  const today = todayISO();
  const recentDates = useMemo(() => {
    const days = lastNDaysISO(7);
    return (Array.isArray(days) ? [...days] : []).sort((a, b) => b.localeCompare(a));
  }, []);

  const isToday = form.date >= today;

  const handleSave = async (): Promise<void> => {
    const ok = await form.submit();
    if (ok) onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={log ? 'Edit weigh-in' : 'Log weight'}>
      <KeyboardAvoider>
        <View style={{ gap: spacing.lg }}>
          <View style={styles.unitRow}>
            <SegmentedControl<WeightUnit>
              options={UNIT_OPTIONS}
              value={form.unit}
              onChange={form.setUnit}
            />
          </View>

          <NumberField
            label="Weight"
            value={form.displayWeight}
            onChange={form.setDisplayWeight}
            suffix={unitLabel(form.unit)}
            decimals={1}
            min={0}
            max={form.unit === 'lb' ? 1500 : 700}
            placeholder={form.unit === 'lb' ? '154.0' : '70.0'}
            autoFocus
          />

          {form.warning ? (
            <Text
              testID="weight-form-warning"
              accessibilityLabel={`Warning. ${form.warning}`}
              style={[typography.label, { color: colors.warning }]}
            >
              {form.warning}
            </Text>
          ) : null}

          <View>
            <View style={styles.dateHeader}>
              <Text style={[typography.label, { color: colors.textMuted }]}>Date</Text>
              <View style={styles.stepper}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Previous day"
                  onPress={() => form.shiftDate(-1)}
                  style={[styles.stepButton, { backgroundColor: colors.surfaceAlt }]}
                >
                  <Ionicons name="chevron-back" size={16} color={colors.text} />
                </Pressable>
                <Text
                  testID="weight-form-date"
                  style={[typography.title, styles.dateValue, { color: colors.text }]}
                >
                  {formatDateLabel(form.date)}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Next day"
                  accessibilityState={{ disabled: isToday }}
                  disabled={isToday}
                  onPress={() => form.shiftDate(1)}
                  style={[
                    styles.stepButton,
                    { backgroundColor: colors.surfaceAlt, opacity: isToday ? 0.4 : 1 },
                  ]}
                >
                  <Ionicons name="chevron-forward" size={16} color={colors.text} />
                </Pressable>
              </View>
            </View>

            <View style={styles.dateChips}>
              {recentDates.map((iso) => (
                <Chip
                  key={iso}
                  label={formatDateLabel(iso)}
                  selected={iso === form.date}
                  onPress={() => form.setDate(iso)}
                />
              ))}
            </View>

            {form.dateError ? (
              <Text
                testID="weight-form-date-error"
                style={[typography.caption, { color: colors.danger, marginTop: spacing.xs }]}
              >
                {form.dateError}
              </Text>
            ) : null}
          </View>

          <NumberField
            label="Body fat (optional)"
            value={form.bodyFatPct}
            onChange={form.setBodyFatPct}
            suffix="%"
            decimals={1}
            min={0}
            max={100}
            placeholder="18.0"
          />

          <TextField
            label="Note (optional)"
            value={form.note}
            onChangeText={form.setNote}
            placeholder="Morning, after gym..."
            multiline
          />

          {form.error ? (
            <Text
              testID="weight-form-error"
              style={[typography.label, { color: colors.danger }]}
            >
              {form.error}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Button title="Cancel" variant="ghost" onPress={onClose} />
            <Button
              title={log ? 'Save changes' : 'Save weigh-in'}
              onPress={handleSave}
              loading={form.saving}
              disabled={!form.canSave}
              icon="checkmark"
              fullWidth
            />
          </View>
        </View>
      </KeyboardAvoider>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  dateChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  dateHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dateValue: {
    minWidth: 96,
    textAlign: 'center',
  },
  stepButton: {
    alignItems: 'center',
    borderRadius: 999,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  stepper: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  unitRow: {
    alignSelf: 'flex-start',
  },
});

export default LogWeightSheet;
