import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatDateLabel, isValidISODate } from '@/domain';
import { AnalyzingOverlay } from '@/features/scan/AnalyzingOverlay';
import { CameraOverlay } from '@/features/scan/CameraOverlay';
import { ScanErrorCard } from '@/features/scan/ScanErrorCard';
import type { EntryDraft } from '@/features/scan/useScanReview';
import { analyzeImage, imageUriToBase64 } from '@/services/vision';
import { useAppStore } from '@/store/appStore';
import { MEAL_TYPES } from '@/types/constants';
import type { ISODate, MealType, VisionMode, VisionResult } from '@/types';
import { Button, Card, EmptyState, Screen, useTheme } from '@/ui';

type Phase = 'camera' | 'analyzing' | 'error' | 'empty';

const GENERIC_ERROR = "We couldn't read that photo. Try again with more light, or enter it by hand.";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function coerceMeal(value: string | string[] | undefined): MealType | null {
  const raw = firstParam(value);
  return raw && (MEAL_TYPES as string[]).includes(raw) ? (raw as MealType) : null;
}

/**
 * A `date` param is untrusted (deep link, restored nav state). Anything that is
 * not a real calendar day is rejected so it never reaches the diary write via
 * scan-review, where `food_entries.date` is matched exactly.
 */
function coerceDate(value: string | string[] | undefined): ISODate | null {
  const raw = firstParam(value)?.trim();
  return raw && isValidISODate(raw) ? raw : null;
}

/** breakfast before 10:30, lunch before 15:00, dinner before 21:00, else snack. */
export function inferMealType(now: Date = new Date()): MealType {
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < 10 * 60 + 30) return 'breakfast';
  if (minutes < 15 * 60) return 'lunch';
  if (minutes < 21 * 60) return 'dinner';
  return 'snack';
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  return GENERIC_ERROR;
}

export default function ScanScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ date?: string; mealType?: string }>();
  const selectedDate = useAppStore((s) => s.selectedDate);
  const { colors, spacing, typography } = useTheme();

  const [date] = useState<ISODate>(coerceDate(params.date) ?? selectedDate);
  const [mealType, setMealType] = useState<MealType>(coerceMeal(params.mealType) ?? inferMealType());
  const [mode, setMode] = useState<VisionMode>('food_photo');
  const [torch, setTorch] = useState(false);
  const [phase, setPhase] = useState<Phase>('camera');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [message, setMessage] = useState<string>(GENERIC_ERROR);

  const [permission, requestPermission] = useCameraPermissions();

  const cameraRef = useRef<CameraView | null>(null);
  const isCapturing = useRef(false);
  /** Bumped to invalidate an in-flight analysis (cancel, unmount or re-capture). */
  const runId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      runId.current += 1;
    };
  }, []);

  const goToReview = useCallback(
    (result: VisionResult, uri: string) => {
      const payload = encodeURIComponent(JSON.stringify(result));
      const href =
        `/scan-review?payload=${payload}` +
        `&date=${encodeURIComponent(date)}` +
        `&mealType=${encodeURIComponent(mealType)}` +
        `&photoUri=${encodeURIComponent(uri)}`;
      router.replace(href as Href);
    },
    [date, mealType]
  );

  const analyze = useCallback(
    async (uri: string) => {
      const current = runId.current + 1;
      runId.current = current;
      setPhotoUri(uri);
      setPhase('analyzing');

      try {
        const { base64, mimeType } = await imageUriToBase64(uri);
        if (!mounted.current || runId.current !== current) return;

        const response = await analyzeImage({ imageBase64: base64, mimeType, mode });
        if (!mounted.current || runId.current !== current) return;

        if (!response.ok || !response.data) {
          setMessage(response.error ?? GENERIC_ERROR);
          setPhase('error');
          return;
        }
        if (response.data.items.length === 0) {
          setPhase('empty');
          return;
        }
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        goToReview(response.data, uri);
      } catch (error) {
        if (!mounted.current || runId.current !== current) return;
        setMessage(errorText(error));
        setPhase('error');
      }
    },
    [goToReview, mode]
  );

  const handleShutter = useCallback(async () => {
    // Guards a double-tap: the second press is dropped while the first is busy.
    if (isCapturing.current || phase !== 'camera') return;
    isCapturing.current = true;
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const photo = await cameraRef.current?.takePictureAsync({
        quality: 0.6,
        base64: false,
        skipProcessing: false,
      });
      if (!photo?.uri) throw new Error('The camera did not return a photo.');
      await analyze(photo.uri);
    } catch (error) {
      if (!mounted.current) return;
      setMessage(errorText(error));
      setPhase('error');
    } finally {
      isCapturing.current = false;
    }
  }, [analyze, phase]);

  const pickFromLibrary = useCallback(async () => {
    try {
      // SDK 54 takes an array of media types; the `MediaTypeOptions` enum is deprecated.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.6,
        allowsMultipleSelection: false,
      });
      if (result.canceled) return;
      const uri = result.assets?.[0]?.uri;
      if (!uri) return;
      await analyze(uri);
    } catch (error) {
      if (!mounted.current) return;
      setMessage(errorText(error));
      setPhase('error');
    }
  }, [analyze]);

  const cancelAnalysis = useCallback(() => {
    runId.current += 1;
    setPhotoUri(null);
    setPhase('camera');
  }, []);

  const retryAnalysis = useCallback(() => {
    if (photoUri) {
      void analyze(photoUri);
      return;
    }
    setPhase('camera');
  }, [analyze, photoUri]);

  const goManual = useCallback(() => {
    const draft: EntryDraft = {
      date,
      mealType,
      foodId: null,
      name: '',
      brand: null,
      quantity: 1,
      unit: 'serving',
      servingLabel: '1 serving',
      gramsTotal: 0,
      macros: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      photoUri,
      source: 'quick_add',
      visionConfidence: null,
      wasEdited: false,
      loggedAt: new Date().toISOString(),
    };
    const href =
      `/food-edit?draft=${encodeURIComponent(JSON.stringify(draft))}` +
      `&date=${encodeURIComponent(date)}&mealType=${encodeURIComponent(mealType)}`;
    router.replace(href as Href);
  }, [date, mealType, photoUri]);

  const goSettings = useCallback(() => {
    router.push('/settings');
  }, []);

  const goBarcode = useCallback(() => {
    router.replace(
      `/barcode-scan?date=${encodeURIComponent(date)}&mealType=${encodeURIComponent(mealType)}` as Href
    );
  }, [date, mealType]);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, []);

  /**
   * Shared by the camera and the blocked-camera branches: the gallery is
   * offered in both, so an empty analysis has to be explained in both. Leaving
   * it to the camera branch alone drops blocked users back to the rationale
   * card with no idea why nothing happened.
   */
  const noFoodCard = (
    <Card testID="no-food-card">
      <Text style={[typography.title, { color: colors.text }]}>No food detected</Text>
      <Text style={[typography.body, { color: colors.textMuted, marginTop: spacing.xs }]}>
        {mode === 'nutrition_label'
          ? 'The Nutrition Facts panel was hard to read. Move closer, keep it flat and avoid glare.'
          : 'Try getting closer so the plate fills the frame, or find better light.'}
      </Text>
      <View style={styles.actions}>
        <Button title="Retake photo" icon="camera-outline" onPress={cancelAnalysis} />
        <Button title="Enter manually" variant="secondary" icon="create-outline" onPress={goManual} />
      </View>
    </Card>
  );

  /* ---------------------------------------------------------------------- */
  /* Permission gates                                                       */
  /* ---------------------------------------------------------------------- */

  if (!permission) {
    return (
      <Screen title="Scan">
        <Text style={[typography.body, { color: colors.textMuted }]}>Checking camera access…</Text>
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen title="Scan" subtitle="Snap a plate or a nutrition label">
        {permission.canAskAgain ? (
          <Card testID="camera-rationale">
            <Text style={[typography.title, { color: colors.text }]}>Camera access needed</Text>
            <Text style={[typography.body, { color: colors.textMuted, marginTop: spacing.xs }]}>
              MacroTrack uses the camera to photograph your meal and estimate its macros. Photos are
              only sent to the vision provider you choose in Settings.
            </Text>
            <View style={styles.actions}>
              <Button
                title="Allow camera"
                icon="camera-outline"
                onPress={() => {
                  void requestPermission();
                }}
                testID="allow-camera"
              />
              <Button
                title="Choose from library"
                variant="secondary"
                icon="images-outline"
                onPress={() => {
                  void pickFromLibrary();
                }}
                testID="permission-gallery"
              />
            </View>
          </Card>
        ) : (
          <View testID="camera-denied">
            <EmptyState
              icon="camera-outline"
              title="Camera is turned off"
              message={
                Platform.OS === 'ios'
                  ? 'Turn the camera back on in Settings › MacroTrack › Camera, then come back here.'
                  : 'Turn the camera permission back on for MacroTrack in the system app settings, then come back here.'
              }
              actionLabel="Open Settings"
              onAction={() => {
                void Linking.openSettings();
              }}
            />
            <View style={styles.actions}>
              <Button
                title="Choose from library"
                variant="secondary"
                icon="images-outline"
                onPress={() => {
                  void pickFromLibrary();
                }}
                testID="permission-gallery"
              />
              <Button title="Close" variant="ghost" onPress={close} />
            </View>
          </View>
        )}

        {phase === 'error' ? (
          <View style={{ marginTop: spacing.lg }}>
            <ScanErrorCard
              message={message}
              onRetry={retryAnalysis}
              onManual={goManual}
              onAddApiKey={goSettings}
            />
          </View>
        ) : null}

        {phase === 'empty' ? <View style={{ marginTop: spacing.lg }}>{noFoodCard}</View> : null}

        {phase === 'analyzing' && photoUri ? (
          <AnalyzingOverlay photoUri={photoUri} mode={mode} onCancel={cancelAnalysis} />
        ) : null}
      </Screen>
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Camera                                                                 */
  /* ---------------------------------------------------------------------- */

  return (
    <View style={styles.root} testID="scan-screen">
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        mode="picture"
        enableTorch={torch}
        flash={torch ? 'on' : 'off'}
        animateShutter={false}
      />

      <CameraOverlay
        mode={mode}
        onModeChange={setMode}
        mealType={mealType}
        onMealChange={setMealType}
        dateLabel={formatDateLabel(date)}
        torch={torch}
        onToggleTorch={() => setTorch((v) => !v)}
        onShutter={() => {
          void handleShutter();
        }}
        onPickFromLibrary={() => {
          void pickFromLibrary();
        }}
        onClose={close}
        busy={phase !== 'camera'}
      />

      <View style={styles.barcodeShortcut} pointerEvents="box-none">
        <Button
          title="Scan barcode"
          variant="secondary"
          icon="barcode-outline"
          onPress={goBarcode}
          testID="barcode-mode-button"
        />
      </View>

      {phase === 'analyzing' && photoUri ? (
        <AnalyzingOverlay photoUri={photoUri} mode={mode} onCancel={cancelAnalysis} />
      ) : null}

      {phase === 'error' || phase === 'empty' ? (
        <View style={[StyleSheet.absoluteFill, styles.resultRoot]} testID="scan-result-overlay">
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : null}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} />
          <ScrollView contentContainerStyle={[styles.resultContent, { padding: spacing.lg }]}>
            {phase === 'error' ? (
              <ScanErrorCard
                message={message}
                onRetry={retryAnalysis}
                onManual={goManual}
                onAddApiKey={goSettings}
              />
            ) : (
              noFoodCard
            )}

            <Button
              title="Back to camera"
              variant="ghost"
              icon="camera-outline"
              onPress={cancelAnalysis}
              style={styles.backToCamera}
              testID="back-to-camera"
            />
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  backToCamera: { alignSelf: 'center', marginTop: 12 },
  barcodeShortcut: { alignItems: 'center', bottom: 126, left: 0, position: 'absolute', right: 0 },
  resultContent: { flexGrow: 1, justifyContent: 'center' },
  resultRoot: { backgroundColor: '#000' },
  root: { backgroundColor: '#000', flex: 1 },
});
