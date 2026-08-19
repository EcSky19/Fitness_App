import React from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { spacing, typography, useSafeInsets, useTheme } from '../theme';

export interface ScreenProps {
  title?: string;
  subtitle?: string;
  /** Wraps children in a ScrollView. Default true. */
  scrollable?: boolean;
  refreshing?: boolean;
  /** Enables pull-to-refresh (scrollable screens only). */
  onRefresh?: () => void;
  /** Trailing slot in the large-title header. */
  headerRight?: React.ReactNode;
  /** Applies the standard 16px horizontal gutter. Default true. */
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
  children?: React.ReactNode;
}

/** Bottom inset so the floating tab bar never covers the last row. */
const TAB_BAR_CLEARANCE = 120;

/** Safe-area aware page shell with a large title header. */
export function Screen({
  title,
  subtitle,
  scrollable = true,
  refreshing = false,
  onRefresh,
  headerRight,
  padded = true,
  style,
  contentContainerStyle,
  testID,
  children,
}: ScreenProps): React.JSX.Element {
  const { colors } = useTheme();
  const insets = useSafeInsets();

  const gutter = padded ? spacing.lg : 0;

  const header =
    title || subtitle || headerRight ? (
      <View style={[styles.header, { paddingHorizontal: gutter }]}>
        <View style={styles.headerText}>
          {title ? (
            <Text
              accessibilityRole="header"
              numberOfLines={2}
              style={[typography.h1, { color: colors.text }]}
            >
              {title}
            </Text>
          ) : null}
          {subtitle ? (
            <Text numberOfLines={2} style={[typography.body, styles.subtitle, { color: colors.textMuted }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {headerRight ? <View style={styles.headerRight}>{headerRight}</View> : null}
      </View>
    ) : null;

  const body = scrollable ? (
    <ScrollView
      style={styles.fill}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[
        { paddingHorizontal: gutter, paddingBottom: TAB_BAR_CLEARANCE + insets.bottom },
        contentContainerStyle,
      ]}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressBackgroundColor={colors.surface}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View
      style={[
        styles.fill,
        { paddingHorizontal: gutter, paddingBottom: insets.bottom },
        contentContainerStyle,
      ]}
    >
      {children}
    </View>
  );

  return (
    <View
      testID={testID}
      style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }, style]}
    >
      {header}
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  header: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.md,
    paddingTop: spacing.md,
  },
  headerRight: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    marginLeft: spacing.md,
  },
  headerText: {
    flex: 1,
  },
  root: {
    flex: 1,
  },
  subtitle: {
    marginTop: 2,
  },
});

export default Screen;
