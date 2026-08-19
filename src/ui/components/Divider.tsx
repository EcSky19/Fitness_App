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
  return <View style={[styles.line, { backgroundColor: colors.border, marginLeft: inset }, style]} />;
}

const styles = StyleSheet.create({
  line: {
    height: StyleSheet.hairlineWidth,
    width: '100%',
  },
});

export default Divider;
