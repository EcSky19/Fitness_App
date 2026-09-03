import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Card, hexToRgba, useTheme } from '@/ui';

import { DashText } from './dashboardText';
import type { LoggingStreak } from './useLoggingStreak';

interface StreakCardProps {
  streak: LoggingStreak;
}

/**
 * Small motivational strip: how many days in a row the user has logged food,
 * plus their personal best when it beats the current run. Hidden entirely at
 * 0 so a brand-new (or lapsed) account never sees a discouraging "0 day
 * streak" banner — it reappears the day logging resumes.
 */
export function StreakCard({ streak }: StreakCardProps) {
  const { colors, spacing } = useTheme();
  const { current, longest } = streak;

  if (!Number.isFinite(current) || current <= 0) return null;

  const hasNewBest = longest > current;
  const a11yLabel = hasNewBest
    ? `${current} day logging streak, best ${longest} days`
    : `${current} day logging streak`;

  return (
    <Card>
      <View style={styles.row} accessible accessibilityLabel={a11yLabel}>
        <View style={[styles.iconWrap, { backgroundColor: hexToRgba(colors.warning, 0.16) }]}>
          <Ionicons name="flame" size={20} color={colors.warning} />
        </View>
        <View style={{ marginLeft: spacing.sm }}>
          <DashText variant="subtitle" color={colors.text}>
            {`${current} day streak`}
          </DashText>
          <DashText variant="caption" color={colors.textMuted}>
            {hasNewBest ? `Best: ${longest} days` : 'Log something today to keep it going'}
          </DashText>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row' },
  iconWrap: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
});
