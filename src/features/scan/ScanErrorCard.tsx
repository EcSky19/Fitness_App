import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Card, useTheme } from '@/ui';

const KEY_ERROR_PATTERN =
  /(api[\s-]?key|not configured|missing key|unauthori[sz]ed|invalid[\s-]?key|401|403|credential)/i;

/** True when the failure reads like "no / bad API key", which Settings can fix. */
export function looksLikeKeyError(message: string): boolean {
  return KEY_ERROR_PATTERN.test(message ?? '');
}

export interface ScanErrorCardProps {
  title?: string;
  message: string;
  onRetry: () => void;
  onManual: () => void;
  /** Shown only for key/configuration failures. */
  onAddApiKey?: () => void;
  retryLabel?: string;
  testID?: string;
}

/** Failure state for the capture pipeline — always offers a way forward. */
export function ScanErrorCard({
  title = "That scan didn't work",
  message,
  onRetry,
  onManual,
  onAddApiKey,
  retryLabel = 'Retry',
  testID = 'scan-error-card',
}: ScanErrorCardProps): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();
  const showKeyAction = Boolean(onAddApiKey) && looksLikeKeyError(message);

  return (
    <Card testID={testID}>
      <Text style={[typography.title, { color: colors.text }]}>{title}</Text>
      <Text
        style={[typography.body, { color: colors.textMuted, marginTop: spacing.xs }]}
        testID="scan-error-message"
      >
        {message}
      </Text>

      <View style={[styles.actions, { marginTop: spacing.lg }]}>
        <Button title={retryLabel} icon="refresh" onPress={onRetry} />
        <Button title="Enter manually" variant="secondary" icon="create-outline" onPress={onManual} />
        {showKeyAction && onAddApiKey ? (
          <Button title="Add API key" variant="ghost" icon="key-outline" onPress={onAddApiKey} />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});

export default ScanErrorCard;
