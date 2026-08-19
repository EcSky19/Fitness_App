import { Ionicons } from '@expo/vector-icons';
import React, { useContext } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { Button, MacroBar, useTheme } from '@/ui';
import { formatEnergy, formatMacroG } from '@/domain';
import type { AppSettings, Macros } from '@/types';

export interface ReviewTotalsFooterProps {
  totals: Macros;
  includedCount: number;
  energyUnit?: AppSettings['energyUnit'];
  saveAsCustom: boolean;
  onToggleSaveAsCustom: () => void;
  onLog: () => void;
  logging?: boolean;
  disabled?: boolean;
  /** Why logging is blocked, shown above the button. */
  hint?: string | null;
}

/** Sticky summary + primary action for the review screen. */
export function ReviewTotalsFooter({
  totals,
  includedCount,
  energyUnit = 'kcal',
  saveAsCustom,
  onToggleSaveAsCustom,
  onLog,
  logging = false,
  disabled = false,
  hint,
}: ReviewTotalsFooterProps): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();
  const insets = useContext(SafeAreaInsetsContext);
  const bottom = insets?.bottom ?? 0;

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          paddingBottom: Math.max(spacing.md, bottom),
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.md,
        },
      ]}
      testID="review-totals-footer"
    >
      <View style={styles.row}>
        <Text style={[typography.h3, { color: colors.text }]} testID="totals-calories">
          {formatEnergy(totals.calories, energyUnit)}
        </Text>
        <Text style={[typography.caption, { color: colors.textMuted }]} testID="totals-macros">
          {`P ${formatMacroG(totals.protein)} · C ${formatMacroG(totals.carbs)} · F ${formatMacroG(totals.fat)}`}
        </Text>
      </View>

      <View style={{ marginTop: spacing.sm }}>
        <MacroBar protein={totals.protein} carbs={totals.carbs} fat={totals.fat} height={8} />
      </View>

      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="Save items as custom foods"
        accessibilityState={{ checked: saveAsCustom }}
        hitSlop={6}
        onPress={onToggleSaveAsCustom}
        style={[styles.checkRow, { marginTop: spacing.md }]}
        testID="save-custom-toggle"
      >
        <Ionicons
          name={saveAsCustom ? 'checkbox' : 'square-outline'}
          size={20}
          color={saveAsCustom ? colors.primary : colors.textFaint}
        />
        <Text style={[typography.body, { color: colors.textMuted, marginLeft: spacing.sm }]}>
          Save items as custom foods
        </Text>
      </Pressable>

      {hint ? (
        <Text
          style={[typography.caption, { color: colors.warning, marginTop: spacing.sm }]}
          testID="log-hint"
        >
          {hint}
        </Text>
      ) : null}

      <Button
        title={includedCount === 1 ? 'Log 1 item' : `Log ${includedCount} items`}
        onPress={onLog}
        size="lg"
        fullWidth
        loading={logging}
        disabled={disabled || logging}
        style={{ marginTop: spacing.md }}
        testID="log-button"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  checkRow: { alignItems: 'center', flexDirection: 'row' },
  row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  wrap: { borderTopWidth: StyleSheet.hairlineWidth },
});

export default ReviewTotalsFooter;
