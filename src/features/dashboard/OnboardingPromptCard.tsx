import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button, Card, useTheme } from '@/ui';

import { DashText } from './dashboardText';

interface OnboardingPromptCardProps {
  onStart: () => void;
}

/** Shown on the dashboard when no profile exists, so targets cannot be derived. */
export function OnboardingPromptCard({ onStart }: OnboardingPromptCardProps) {
  const { colors, spacing } = useTheme();

  return (
    <Card>
      <View style={styles.row}>
        <View
          style={[styles.iconWrap, { backgroundColor: colors.primaryDim, marginRight: spacing.md }]}
        >
          <Ionicons name="person-add-outline" size={22} color={colors.primary} />
        </View>
        <View style={styles.copy}>
          <DashText variant="subtitle" color={colors.text}>
            Set up your profile to get calorie targets
          </DashText>
          <DashText
            variant="caption"
            color={colors.textMuted}
            style={{ marginTop: spacing.xs, lineHeight: 17 }}
          >
            Add your height, weight and goal and MacroTrack will calculate your daily calories and
            macros.
          </DashText>
        </View>
      </View>
      <View style={{ marginTop: spacing.md }}>
        <Button title="Set up profile" onPress={onStart} variant="primary" size="md" fullWidth />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1 },
});
