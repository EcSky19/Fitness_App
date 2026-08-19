import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, spacing, typography, useTheme } from '../theme';

export interface SegmentedOption<T> {
  label: string;
  value: T;
}

export interface SegmentedControlProps<T> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: 'md' | 'sm';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** iOS-style segmented picker. Generic over the option value type. */
export function SegmentedControl<T>({
  options,
  value,
  onChange,
  size = 'md',
  style,
  testID,
}: SegmentedControlProps<T>): React.JSX.Element {
  const { colors } = useTheme();
  const small = size === 'sm';

  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      style={[
        styles.track,
        { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
        small ? styles.trackSm : null,
        style,
      ]}
    >
      {options.map((option, index) => {
        const selected = Object.is(option.value, value);
        return (
          <Pressable
            key={`${String(option.label)}-${index}`}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.segment,
              small ? styles.segmentSm : null,
              selected ? { backgroundColor: colors.surface } : null,
              selected ? styles.selected : null,
              pressed && !selected ? styles.pressed : null,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                small ? typography.caption : typography.label,
                styles.text,
                { color: selected ? colors.text : colors.textMuted },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.6,
  },
  segment: {
    alignItems: 'center',
    borderRadius: radius.sm,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  segmentSm: {
    paddingVertical: spacing.xs,
  },
  selected: {
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
  },
  text: {
    fontWeight: '700',
  },
  track: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    padding: 3,
    width: '100%',
  },
  trackSm: {
    padding: 2,
  },
});

export default SegmentedControl;
