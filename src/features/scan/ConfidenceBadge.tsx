import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Badge, useTheme } from '@/ui';

export type ConfidenceTone = 'success' | 'warning' | 'danger';

/** green >= 0.75, amber >= 0.5, red below. */
export function confidenceTone(confidence: number): ConfidenceTone {
  if (confidence >= 0.75) return 'success';
  if (confidence >= 0.5) return 'warning';
  return 'danger';
}

export function confidenceLabel(confidence: number): string {
  const pct = Math.round(Math.min(1, Math.max(0, confidence)) * 100);
  if (confidence >= 0.75) return `High ${pct}%`;
  if (confidence >= 0.5) return `Medium ${pct}%`;
  return `Low ${pct}%`;
}

export interface ConfidenceBadgeProps {
  confidence: number;
  /** Adds the "please check" nudge under low-confidence detections. */
  showHint?: boolean;
  testID?: string;
}

/** How sure the model was about one detected item. */
export function ConfidenceBadge({
  confidence,
  showHint = true,
  testID,
}: ConfidenceBadgeProps): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();
  const tone = confidenceTone(confidence);

  return (
    <View style={styles.wrap} testID={testID}>
      <Badge label={confidenceLabel(confidence)} tone={tone} testID="confidence-badge" />
      {showHint && tone === 'danger' ? (
        <Text
          style={[typography.caption, { color: colors.warning, marginTop: spacing.xs }]}
          testID="confidence-hint"
        >
          Low confidence, please check
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-end' },
});

export default ConfidenceBadge;
