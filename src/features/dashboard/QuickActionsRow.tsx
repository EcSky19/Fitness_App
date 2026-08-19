import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { useTheme } from '@/ui';

import { DashText } from './dashboardText';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export interface QuickAction {
  key: string;
  label: string;
  accessibilityLabel: string;
  icon: IconName;
  onPress: () => void;
}

interface QuickActionsRowProps {
  onScan: () => void;
  onAddFood: () => void;
  onLogExercise: () => void;
  onLogWeight: () => void;
}

export function QuickActionsRow({
  onScan,
  onAddFood,
  onLogExercise,
  onLogWeight,
}: QuickActionsRowProps) {
  const { colors, spacing, radius } = useTheme();

  const actions: QuickAction[] = [
    {
      key: 'scan',
      label: 'Scan',
      accessibilityLabel: 'Scan food',
      icon: 'camera-outline',
      onPress: onScan,
    },
    {
      key: 'add',
      label: 'Add food',
      accessibilityLabel: 'Add food',
      icon: 'search-outline',
      onPress: onAddFood,
    },
    {
      key: 'exercise',
      label: 'Exercise',
      accessibilityLabel: 'Log exercise',
      icon: 'barbell-outline',
      onPress: onLogExercise,
    },
    {
      key: 'weight',
      label: 'Weight',
      accessibilityLabel: 'Log weight',
      icon: 'scale-outline',
      onPress: onLogWeight,
    },
  ];

  const handlePress = (action: QuickAction) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    action.onPress();
  };

  return (
    <View style={[styles.row, { gap: spacing.sm }]}>
      {actions.map((action) => (
        <Pressable
          key={action.key}
          accessibilityRole="button"
          accessibilityLabel={action.accessibilityLabel}
          onPress={() => handlePress(action)}
          style={({ pressed }) => [
            styles.tile,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radius.lg,
              paddingVertical: spacing.md,
              opacity: pressed ? 0.6 : 1,
            },
          ]}
        >
          <View
            style={[
              styles.iconWrap,
              { backgroundColor: colors.primaryDim, borderRadius: radius.pill },
            ]}
          >
            <Ionicons name={action.icon} size={20} color={colors.primary} />
          </View>
          <DashText variant="micro" color={colors.textMuted} numberOfLines={1}>
            {action.label}
          </DashText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  tile: { flex: 1, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, gap: 6 },
  iconWrap: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
