import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '../theme';

export interface DividerProps {
  /** Left indent in px, e.g. to align with text after a leading icon. */
  inset?: number;
  style?: StyleProp<ViewStyle>;
}

/** 1px hairline separator. */
export function Divider({ inset = 0, style }: DividerProps): React.JSX.Element {
  const { colors } = useTheme();
  const indent = typeof inset === 'number' && Number.isFinite(inset) ? Math.max(0, inset) : 0;

  return (
    <View
      style={[
        styles.line,
        // `width: '100%'` plus a left margin overflows the parent by `inset`;
        // stretching to the cross axis keeps the line inside its container.
        indent > 0 ? styles.inset : null,
        { backgroundColor: colors.border, marginLeft: indent },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  inset: {
    alignSelf: 'stretch',
    width: 'auto',
  },
  line: {
    height: StyleSheet.hairlineWidth,
    width: '100%',
  },
});

export default Divider;
