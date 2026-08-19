import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';

import { Button, useTheme } from '@/ui';
import type { VisionMode } from '@/types';

const FOOD_STEPS = [
  'Reading the image…',
  'Identifying foods…',
  'Estimating portions…',
  'Checking the macros…',
];

const LABEL_STEPS = [
  'Reading the image…',
  'Finding the Nutrition Facts panel…',
  'Extracting the numbers…',
  'Checking the macros…',
];

const STEP_INTERVAL_MS = 1800;

export interface AnalyzingOverlayProps {
  photoUri: string;
  mode: VisionMode;
  onCancel: () => void;
  testID?: string;
}

/** Dimmed freeze-frame of the shot while the vision provider is working. */
export function AnalyzingOverlay({
  photoUri,
  mode,
  onCancel,
  testID = 'analyzing-overlay',
}: AnalyzingOverlayProps): React.JSX.Element {
  const { colors, spacing, typography, radius } = useTheme();
  const steps = mode === 'nutrition_label' ? LABEL_STEPS : FOOD_STEPS;
  const [stepIndex, setStepIndex] = useState(0);

  const pulse = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const id = setInterval(() => {
      setStepIndex((i) => (i + 1) % steps.length);
    }, STEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [steps.length]);

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    const sweepLoop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 2200,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    pulseLoop.start();
    sweepLoop.start();
    return () => {
      pulseLoop.stop();
      sweepLoop.stop();
    };
  }, [pulse, sweep]);

  const shimmerStyle = useMemo(
    () => ({
      opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.7] }),
      transform: [
        {
          translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [-140, 640] }),
        },
      ],
    }),
    [pulse, sweep]
  );

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} testID={testID}>
      <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} />
      <Animated.View
        pointerEvents="none"
        style={[styles.shimmer, { backgroundColor: colors.primary }, shimmerStyle]}
      />

      <View style={styles.center}>
        <View
          style={[
            styles.panel,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radius.lg,
              padding: spacing.xl,
            },
          ]}
        >
          <ActivityIndicator size="large" color={colors.primary} />
          <Text
            style={[typography.title, { color: colors.text, marginTop: spacing.lg }]}
            testID="analyzing-status"
          >
            {steps[stepIndex]}
          </Text>
          <Text
            style={[typography.caption, { color: colors.textMuted, marginTop: spacing.xs }]}
          >
            {mode === 'nutrition_label' ? 'Reading the label' : 'Analysing your plate'}
          </Text>
          <Button
            title="Cancel"
            variant="ghost"
            onPress={onCancel}
            style={{ marginTop: spacing.lg }}
            testID="analyzing-cancel"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  panel: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 320,
    width: '100%',
  },
  root: { backgroundColor: '#000' },
  shimmer: { height: 120, left: 0, opacity: 0.4, position: 'absolute', right: 0, top: 0 },
});

export default AnalyzingOverlay;
