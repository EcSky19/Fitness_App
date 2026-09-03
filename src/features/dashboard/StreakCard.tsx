import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Card, hexToRgba, useTheme } from '@/ui';

import { DashText } from './dashboardText';

interface StreakCardProps {
  /** Consecutive days logged, from `useLoggingStreak`. */
  streak: number;
}

/**
 * Small motivational strip: how many days in a row the user has logged food.
 * Hidden entirely at 0 so a brand-new (or lapsed) account never sees a
 * discouraging "0 day streak" banner — it reappears the day logging resumes.
 */
export function StreakCard({ streak }: StreakCardProps) {
  const { colors, spacing } = useTheme();

  if (!Number.isFinite(streak) || streak <= 0) return null;

  return (
    <Card>
      <View
        style={styles.row}
        accessible
        accessibilityLabel={`${streak} day logging streak`}
      >
        <View style={[styles.iconWrap, { backgroundColor: hexToRgba(colors.warning, 0.16) }]}>
          <Ionicons name="flame" size={20} color={colors.warning} />
        </View>
        <View style={{ marginLeft: spacing.sm }}>
          <DashText variant="subtitle" color={colors.text}>
            {`${streak} day streak`}
          </DashText>
          <DashText variant="caption" color={colors.textMuted}>
            Log something today to keep it going
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
