import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/ui';

export interface SettingsRowProps {
  title: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  /** Trailing control: segmented control, badge, value text... */
  right?: React.ReactNode;
  /** When provided the row renders a switch and `right` is ignored. */
  toggle?: { value: boolean; onChange: (v: boolean) => void };
  /** Stack `right` under the text instead of beside it (wide controls). */
  stacked?: boolean;
  testID?: string;
  children?: React.ReactNode;
}

/** One labelled row inside a settings card. */
export function SettingsRow({
  title,
  subtitle,
  icon,
  iconColor,
  right,
  toggle,
  stacked = false,
  testID,
  children,
}: SettingsRowProps): React.JSX.Element {
  const { colors, spacing, radius, typography } = useTheme();

  return (
    <View style={{ paddingVertical: spacing.md }} testID={testID}>
      <View style={styles.row}>
        {icon ? (
          <View
            style={[
              styles.icon,
              {
                backgroundColor: colors.surfaceAlt,
                borderRadius: radius.sm,
                marginRight: spacing.md,
              },
            ]}
          >
            <Ionicons name={icon} size={16} color={iconColor ?? colors.primary} />
          </View>
        ) : null}
        <View style={styles.text}>
          <Text style={[typography.title, { color: colors.text }]}>{title}</Text>
          {subtitle ? (
            <Text style={[typography.caption, { color: colors.textMuted, marginTop: 2 }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {toggle ? (
          <Switch
            value={toggle.value}
            onValueChange={(v) => {
              void Haptics.selectionAsync();
              toggle.onChange(v);
            }}
            trackColor={{ false: colors.surfaceAlt, true: colors.primaryDim }}
            thumbColor={colors.onPrimary}
            accessibilityLabel={title}
            testID={testID ? `${testID}-switch` : undefined}
          />
        ) : !stacked && right ? (
          <View style={{ marginLeft: spacing.sm }}>{right}</View>
        ) : null}
      </View>
      {stacked && right ? <View style={{ marginTop: spacing.sm }}>{right}</View> : null}
      {children ? <View style={{ marginTop: spacing.sm }}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  icon: { alignItems: 'center', height: 28, justifyContent: 'center', width: 28 },
  row: { alignItems: 'center', flexDirection: 'row' },
  text: { flex: 1 },
});
