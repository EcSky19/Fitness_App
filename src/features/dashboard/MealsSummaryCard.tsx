import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Card, EmptyState, ListRow, SectionHeader, useTheme } from '@/ui';
import { MEAL_LABELS, MEAL_TYPES } from '@/types/constants';
import type { DailySummary, FoodEntry, MealType } from '@/types';

import { DashText } from './dashboardText';
import { formatNumber } from './useDashboardData';

interface MealsSummaryCardProps {
  summary: DailySummary;
  entries: FoodEntry[];
  /** Opens the diary tab (tap + long press). Keeps destructive actions off the home screen. */
  onOpenDiary: (meal: MealType) => void;
  onAddFood: (meal: MealType) => void;
}

const MEAL_ICONS: Record<MealType, React.ComponentProps<typeof Ionicons>['name']> = {
  breakfast: 'sunny-outline',
  lunch: 'restaurant-outline',
  dinner: 'moon-outline',
  snack: 'nutrition-outline',
};

function previewNames(entries: FoodEntry[]): string {
  if (entries.length === 0) return 'Nothing logged';
  const names = entries.slice(0, 3).map((entry) => entry.name);
  const rest = entries.length - names.length;
  return rest > 0 ? `${names.join(', ')} +${rest} more` : names.join(', ');
}

export function MealsSummaryCard({
  summary,
  entries,
  onOpenDiary,
  onAddFood,
}: MealsSummaryCardProps) {
  const { colors, spacing, radius } = useTheme();

  if (summary.entryCount === 0) {
    return (
      <Card>
        <SectionHeader title="Meals" />
        <EmptyState
          icon="restaurant-outline"
          title="Nothing logged yet"
          message="Add your first food to start tracking today's calories and macros."
          actionLabel="Add food"
          onAction={() => onAddFood('breakfast')}
        />
      </Card>
    );
  }

  return (
    <Card padded={false}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
        <SectionHeader title="Meals" />
      </View>

      {MEAL_TYPES.map((meal) => {
        const mealEntries = entries.filter((entry) => entry.mealType === meal);
        const kcal = summary.byMeal?.[meal]?.calories ?? 0;
        const label = MEAL_LABELS[meal];

        return (
          <ListRow
            key={meal}
            title={label}
            subtitle={previewNames(mealEntries)}
            meta={`${formatNumber(kcal)} kcal · ${mealEntries.length} ${
              mealEntries.length === 1 ? 'item' : 'items'
            }`}
            leftIcon={MEAL_ICONS[meal]}
            leftColor={colors.primary}
            onPress={() => onOpenDiary(meal)}
            onLongPress={() => onOpenDiary(meal)}
            right={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Add food to ${label.toLowerCase()}`}
                hitSlop={10}
                onPress={() => onAddFood(meal)}
                style={[
                  styles.add,
                  { backgroundColor: colors.primaryDim, borderRadius: radius.pill },
                ]}
              >
                <Ionicons name="add" size={18} color={colors.primary} />
              </Pressable>
            }
          />
        );
      })}

      <View style={{ padding: spacing.lg, paddingTop: spacing.sm }}>
        <DashText variant="micro" color={colors.textFaint}>
          {`${summary.entryCount} ${summary.entryCount === 1 ? 'item' : 'items'} · ${formatNumber(
            summary.consumed.calories
          )} kcal today`}
        </DashText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  add: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
});
