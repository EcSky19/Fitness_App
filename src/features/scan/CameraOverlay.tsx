import { Ionicons } from '@expo/vector-icons';
import React, { useContext, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { Chip, SegmentedControl, Sheet, useTheme } from '@/ui';
import { MEAL_LABELS, MEAL_TYPES } from '@/types/constants';
import type { MealType, VisionMode } from '@/types';

const MODE_OPTIONS: { label: string; value: VisionMode }[] = [
  { label: 'Food', value: 'food_photo' },
  { label: 'Nutrition label', value: 'nutrition_label' },
];

export const MODE_HINTS: Record<VisionMode, string> = {
  food_photo: 'Fill the frame with your plate',
  nutrition_label: 'Line up the Nutrition Facts panel',
};

/** Food shots frame square, labels frame as a tall portrait panel. */
const GUIDE_ASPECT: Record<VisionMode, number> = {
  food_photo: 1,
  nutrition_label: 0.62,
};

export interface CameraOverlayProps {
  mode: VisionMode;
  onModeChange: (mode: VisionMode) => void;
  mealType: MealType;
  onMealChange: (meal: MealType) => void;
  dateLabel: string;
  torch: boolean;
  onToggleTorch: () => void;
  onShutter: () => void;
  onPickFromLibrary: () => void;
  onClose: () => void;
  busy?: boolean;
}

/** Camera chrome: mode switch, framing guide and the capture bar. */
export function CameraOverlay({
  mode,
  onModeChange,
  mealType,
  onMealChange,
  dateLabel,
  torch,
  onToggleTorch,
  onShutter,
  onPickFromLibrary,
  onClose,
  busy = false,
}: CameraOverlayProps): React.JSX.Element {
  const { colors, spacing, radius, typography } = useTheme();
  const insets = useContext(SafeAreaInsetsContext);
  const top = insets?.top ?? 0;
  const bottom = insets?.bottom ?? 0;
  const [mealSheet, setMealSheet] = useState(false);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="camera-overlay">
      {/* Top chrome */}
      <View style={[styles.top, { paddingTop: top + spacing.sm }]} pointerEvents="box-none">
        <View style={styles.topRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close camera"
            onPress={onClose}
            style={[styles.iconButton, { backgroundColor: 'rgba(0,0,0,0.45)' }]}
            testID="close-camera"
          >
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </Pressable>

          <Chip
            label={`${MEAL_LABELS[mealType]} · ${dateLabel}`}
            icon="restaurant-outline"
            onPress={() => setMealSheet(true)}
            testID="meal-chip"
          />
        </View>

        <View style={[styles.modeWrap, { marginTop: spacing.md }]}>
          <SegmentedControl<VisionMode>
            options={MODE_OPTIONS}
            value={mode}
            onChange={onModeChange}
            size="sm"
          />
        </View>

        <Text style={[typography.caption, styles.hint, { marginTop: spacing.sm }]} testID="mode-hint">
          {MODE_HINTS[mode]}
        </Text>
      </View>

      {/* Framing guide */}
      <View style={styles.guideWrap} pointerEvents="none">
        <View
          style={[
            styles.guide,
            {
              aspectRatio: GUIDE_ASPECT[mode],
              borderColor: 'rgba(255,255,255,0.85)',
              borderRadius: radius.lg,
            },
          ]}
          testID={`framing-guide-${mode}`}
        />
      </View>

      {/* Capture bar */}
      <View
        style={[styles.bottom, { paddingBottom: bottom + spacing.xl }]}
        pointerEvents="box-none"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose from library"
          onPress={onPickFromLibrary}
          style={[styles.iconButton, { backgroundColor: 'rgba(0,0,0,0.45)' }]}
          testID="gallery-button"
        >
          <Ionicons name="images-outline" size={24} color="#FFFFFF" />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={onShutter}
          style={({ pressed }) => [
            styles.shutter,
            { borderColor: '#FFFFFF', opacity: busy ? 0.5 : 1 },
            pressed ? styles.shutterPressed : null,
          ]}
          testID="shutter-button"
        >
          <View style={[styles.shutterInner, { backgroundColor: colors.primary }]} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={torch ? 'Turn flash off' : 'Turn flash on'}
          accessibilityState={{ selected: torch }}
          onPress={onToggleTorch}
          style={[
            styles.iconButton,
            { backgroundColor: torch ? colors.primary : 'rgba(0,0,0,0.45)' },
          ]}
          testID="torch-button"
        >
          <Ionicons
            name={torch ? 'flash' : 'flash-off'}
            size={24}
            color={torch ? colors.onPrimary : '#FFFFFF'}
          />
        </Pressable>
      </View>

      <Sheet visible={mealSheet} onClose={() => setMealSheet(false)} title="Log to which meal?">
        <View style={styles.mealRow}>
          {MEAL_TYPES.map((meal) => (
            <Chip
              key={meal}
              label={MEAL_LABELS[meal]}
              selected={meal === mealType}
              onPress={() => {
                onMealChange(meal);
                setMealSheet(false);
              }}
              testID={`meal-option-${meal}`}
            />
          ))}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  bottom: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
  },
  guide: {
    borderWidth: 2,
    maxHeight: '100%',
    width: '82%',
  },
  guideWrap: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingVertical: 12 },
  hint: {
    color: '#FFFFFF',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { height: 1, width: 0 },
    textShadowRadius: 3,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 999,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  mealRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modeWrap: { alignSelf: 'center' },
  shutter: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 4,
    height: 78,
    justifyContent: 'center',
    width: 78,
  },
  shutterInner: { borderRadius: 999, height: 62, width: 62 },
  shutterPressed: { transform: [{ scale: 0.94 }] },
  top: { paddingHorizontal: 16 },
  topRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
});

export default CameraOverlay;
