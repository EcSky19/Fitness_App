import { CameraView, useCameraPermissions, type BarcodeScanningResult, type BarcodeType } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { getFoodByBarcode, upsertFood } from '@/db/repositories';
import { formatEnergy, formatMacroG } from '@/domain';
import { inferMealType, normalizeDateParam, normalizeMealParam } from '@/features/diary/useEntryDraft';
import { productToFoodInput, type BarcodeProduct } from '@/features/barcode/types';
import { lookupBarcode, isValidBarcode } from '@/services/barcode';
import { useAppStore } from '@/store/appStore';
import type { ISODate, MealType } from '@/types';
import { Button, Card, EmptyState, Screen, Sheet, TextField, useTheme } from '@/ui';

type Phase = 'scanning' | 'looking_up' | 'found' | 'not_found' | 'error';

const BARCODE_TYPES: BarcodeType[] = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'itf14'];

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Barcode lookup failed. Check your connection and try again.';
}

function foodEditHref(foodId: string, date: ISODate, mealType: MealType): Href {
  return `/food-edit?foodId=${encodeURIComponent(foodId)}&date=${encodeURIComponent(date)}&mealType=${encodeURIComponent(mealType)}` as Href;
}

function createFoodHref(barcode: string, date: ISODate, mealType: MealType): Href {
  const draft = {
    date,
    mealType,
    foodId: null,
    name: '',
    brand: null,
    quantity: 1,
    unit: 'serving',
    servingLabel: '1 serving (100 g)',
    gramsTotal: 100,
    macros: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    photoUri: null,
    source: 'quick_add',
    visionConfidence: null,
    wasEdited: false,
    loggedAt: new Date().toISOString(),
  };
  return (
    `/food-edit?draft=${encodeURIComponent(JSON.stringify(draft))}` +
    `&barcode=${encodeURIComponent(barcode)}&date=${encodeURIComponent(date)}&mealType=${encodeURIComponent(mealType)}`
  ) as Href;
}

export default function BarcodeScanScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ date?: string; mealType?: string }>();
  const selectedDate = useAppStore((s) => s.selectedDate);
  const { colors, spacing, radius, typography } = useTheme();

  const [date] = useState<ISODate>(normalizeDateParam(params.date) ?? selectedDate);
  const [mealType] = useState<MealType>(normalizeMealParam(params.mealType) ?? inferMealType());
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [phase, setPhase] = useState<Phase>('scanning');
  const [barcode, setBarcode] = useState('');
  const [product, setProduct] = useState<BarcodeProduct | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');

  const scanLockedRef = useRef(false);
  const lastRejectedCodeRef = useRef<string | null>(null);
  const mounted = useRef(true);
  const runId = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      runId.current += 1;
    };
  }, []);

  const resetScan = useCallback(() => {
    runId.current += 1;
    scanLockedRef.current = false;
    lastRejectedCodeRef.current = null;
    setPhase('scanning');
    setBarcode('');
    setProduct(null);
    setMessage(null);
  }, []);

  const goManualCreate = useCallback(
    (code: string) => {
      router.replace(createFoodHref(code, date, mealType));
    },
    [date, mealType]
  );

  const handleLookup = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim();
      if (!isValidBarcode(code)) {
        lastRejectedCodeRef.current = code;
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        setMessage("That barcode doesn't look valid. Try again or enter it manually.");
        setPhase('scanning');
        scanLockedRef.current = false;
        return;
      }

      lastRejectedCodeRef.current = null;
      const current = runId.current + 1;
      runId.current = current;
      setBarcode(code);
      setMessage(null);
      setProduct(null);
      setManualOpen(false);
      setPhase('looking_up');
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

      try {
        const result = await lookupBarcode(code);
        if (!mounted.current || runId.current !== current) return;

        if (!result.ok) {
          setMessage(result.error ?? 'Barcode lookup failed. Try again.');
          setPhase('error');
          scanLockedRef.current = false;
          return;
        }

        if (!result.data) {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          setPhase('not_found');
          scanLockedRef.current = false;
          return;
        }

        if (result.data.source === 'local') {
          const food = await getFoodByBarcode(result.data.barcode);
          if (!mounted.current || runId.current !== current) return;
          if (food) {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            router.replace(foodEditHref(food.id, date, mealType));
            return;
          }
        }

        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setProduct(result.data);
        setPhase('found');
        scanLockedRef.current = false;
      } catch (error) {
        if (!mounted.current || runId.current !== current) return;
        setMessage(errorText(error));
        setPhase('error');
        scanLockedRef.current = false;
      }
    },
    [date, mealType]
  );

  const handleBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (result.data.trim() === lastRejectedCodeRef.current) return;
      if (scanLockedRef.current || phase !== 'scanning') return;
      scanLockedRef.current = true;
      void handleLookup(result.data).catch((error) => {
        if (!mounted.current) return;
        setMessage(errorText(error));
        setPhase('error');
      });
    },
    [handleLookup, phase]
  );

  const submitManual = useCallback(() => {
    if (scanLockedRef.current) return;
    scanLockedRef.current = true;
    void handleLookup(manualCode).catch((error) => {
      if (!mounted.current) return;
      setMessage(errorText(error));
      setPhase('error');
    });
  }, [handleLookup, manualCode]);

  const saveRemoteFood = useCallback(() => {
    if (!product || scanLockedRef.current) return;
    scanLockedRef.current = true;
    setPhase('looking_up');
    void (async () => {
      try {
        const saved = await upsertFood(productToFoodInput(product));
        if (!mounted.current) return;
        router.replace(foodEditHref(saved.id, date, mealType));
      } catch (error) {
        if (!mounted.current) return;
        setMessage(errorText(error));
        setPhase('error');
        scanLockedRef.current = false;
      }
    })();
  }, [date, mealType, product]);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/diary');
  }, []);

  const openManual = useCallback(() => {
    // Drop any message from a previous attempt so the sheet never opens showing
    // a stale complaint about a code the user has already moved on from.
    setMessage(null);
    setManualOpen(true);
  }, []);

  /**
   * Every outcome of a lookup. Rendered by BOTH the camera branch and the
   * permission-denied branch: manual entry is the only way to use this screen
   * without a camera, so a result that only the camera branch can display would
   * leave those users tapping "Look up" and seeing nothing at all.
   */
  const resultOverlays = (
    <>
      {phase === 'looking_up' ? (
        <View style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: colors.overlay }]}>
          <Card testID="barcode-looking-up">
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[typography.title, { color: colors.text, marginTop: spacing.md }]}>
              Looking up barcode…
            </Text>
            <Text style={[typography.caption, { color: colors.textMuted }]}>{barcode}</Text>
            <Button title="Cancel" variant="ghost" onPress={resetScan} testID="barcode-cancel" />
          </Card>
        </View>
      ) : null}

      {phase === 'found' && product ? (
        <View style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: colors.overlay }]}>
          <ProductCard product={product} onConfirm={saveRemoteFood} onRescan={resetScan} />
        </View>
      ) : null}

      {phase === 'not_found' ? (
        <View style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: colors.overlay }]}>
          <Card testID="barcode-not-found">
            <Text style={[typography.title, { color: colors.text }]}>Not in the database yet</Text>
            <Text style={[typography.body, { color: colors.textMuted, marginTop: spacing.xs }]}>
              Create it once with this barcode attached. Next time it will scan instantly offline.
            </Text>
            <Text style={[typography.mono, { color: colors.text, marginTop: spacing.md }]}>{barcode}</Text>
            <View style={styles.actions}>
              <Button title="Create food" onPress={() => goManualCreate(barcode)} testID="create-barcode-food" />
              <Button title="Try again" variant="secondary" onPress={resetScan} />
            </View>
          </Card>
        </View>
      ) : null}

      {phase === 'error' ? (
        <View style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: colors.overlay }]}>
          <Card testID="barcode-error">
            <Text style={[typography.title, { color: colors.text }]}>Lookup failed</Text>
            <Text style={[typography.body, { color: colors.textMuted, marginTop: spacing.xs }]}>
              {message ?? 'Try again.'}
            </Text>
            <View style={styles.actions}>
              <Button title="Try again" onPress={resetScan} />
              <Button title="Create food" variant="secondary" onPress={() => goManualCreate(barcode)} />
            </View>
          </Card>
        </View>
      ) : null}
    </>
  );

  const manualSheet = (
    <ManualBarcodeSheet
      visible={manualOpen}
      code={manualCode}
      // A rejected code leaves the sheet open, so its complaint has to appear
      // inside the sheet; the camera layer underneath is not visible.
      error={phase === 'scanning' ? message : null}
      onChangeCode={setManualCode}
      onClose={() => setManualOpen(false)}
      onSubmit={submitManual}
    />
  );

  if (!permission) {
    return (
      <Screen title="Barcode scan">
        <Text style={[typography.body, { color: colors.textMuted }]}>Checking camera access…</Text>
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen title="Barcode scan" subtitle="Scan packaged foods by UPC or EAN">
        {permission.canAskAgain ? (
          <Card testID="camera-rationale">
            <Text style={[typography.title, { color: colors.text }]}>Camera access needed</Text>
            <Text style={[typography.body, { color: colors.textMuted, marginTop: spacing.xs }]}>
              MacroTrack uses the camera to read the barcode on packaged foods.
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
              <Button title="Enter barcode" variant="secondary" onPress={openManual} />
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
                  : 'Turn the camera permission back on for MacroTrack in system settings, then come back here.'
              }
              actionLabel="Open Settings"
              onAction={() => {
                void Linking.openSettings();
              }}
            />
            <View style={styles.actions}>
              <Button title="Enter barcode" variant="secondary" onPress={openManual} />
              <Button title="Close" variant="ghost" onPress={close} />
            </View>
          </View>
        )}
        {resultOverlays}
        {manualSheet}
      </Screen>
    );
  }

  return (
    <View style={styles.root} testID="barcode-scan-screen">
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        flash={torch ? 'on' : 'off'}
        barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
        onBarcodeScanned={phase === 'scanning' ? handleBarcodeScanned : undefined}
      />

      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <View style={[styles.top, { paddingTop: spacing.xl }]}>
          <View style={styles.topRow}>
            <Button title="Close" variant="ghost" onPress={close} testID="close-barcode" />
            <Button
              title={torch ? 'Torch on' : 'Torch'}
              variant="secondary"
              onPress={() => setTorch((v) => !v)}
              testID="barcode-torch"
            />
          </View>
          <Text style={[typography.h3, styles.whiteText]}>Scan a barcode</Text>
          <Text style={[typography.caption, styles.whiteMuted]}>
            Line up the UPC or EAN inside the frame.
          </Text>
        </View>

        <View style={styles.reticleWrap} pointerEvents="none">
          <View
            testID="barcode-reticle"
            style={[styles.reticle, { borderColor: colors.primary, borderRadius: radius.lg }]}
          />
        </View>

        {message && phase === 'scanning' ? (
          <View style={[styles.feedback, { backgroundColor: colors.surface }]}>
            <Text testID="barcode-feedback" style={[typography.caption, { color: colors.warning }]}>
              {message}
            </Text>
          </View>
        ) : null}

        <View style={[styles.bottom, { paddingBottom: spacing.xl }]}>
          <Button
            title="Enter barcode"
            variant="secondary"
            onPress={openManual}
            testID="manual-barcode"
          />
          <Button title="Photo scan" variant="ghost" onPress={() => router.replace('/scan')} />
        </View>
      </View>

      {resultOverlays}
      {manualSheet}
    </View>
  );
}

function ProductCard({
  product,
  onConfirm,
  onRescan,
}: {
  product: BarcodeProduct;
  onConfirm: () => void;
  onRescan: () => void;
}): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();
  return (
    <Card testID="barcode-product-card">
      <Text style={[typography.title, { color: colors.text }]}>{product.name}</Text>
      {product.brand ? (
        <Text style={[typography.caption, { color: colors.textMuted }]}>{product.brand}</Text>
      ) : null}
      <Text style={[typography.caption, { color: colors.textMuted, marginTop: spacing.sm }]}>
        Per 100 g
      </Text>
      <Text testID="barcode-product-macros" style={[typography.body, { color: colors.text }]}>
        {formatEnergy(product.per100g.calories)} · P {formatMacroG(product.per100g.protein)} · C{' '}
        {formatMacroG(product.per100g.carbs)} · F {formatMacroG(product.per100g.fat)}
      </Text>
      <Text style={[typography.caption, { color: colors.warning, marginTop: spacing.sm }]}>
        Check the label before logging — public barcode data can be wrong.
      </Text>
      <View style={styles.actions}>
        <Button title="Save and log" onPress={onConfirm} testID="save-barcode-food" />
        <Button title="Scan again" variant="secondary" onPress={onRescan} />
      </View>
    </Card>
  );
}

function ManualBarcodeSheet({
  visible,
  code,
  error,
  onChangeCode,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  code: string;
  error: string | null;
  onChangeCode: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}): React.JSX.Element {
  return (
    <Sheet visible={visible} onClose={onClose} title="Enter barcode">
      <View testID="manual-barcode-sheet">
        <TextField
          testID="manual-barcode-input"
          label="Barcode"
          value={code}
          onChangeText={onChangeCode}
          placeholder="UPC or EAN"
          keyboardType="number-pad"
          error={error ?? undefined}
        />
        <View style={styles.actions}>
          <Button title="Look up" onPress={onSubmit} testID="manual-barcode-submit" />
          <Button title="Cancel" variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  bottom: {
    alignItems: 'center',
    bottom: 0,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    left: 0,
    paddingHorizontal: 16,
    position: 'absolute',
    right: 0,
  },
  feedback: {
    alignSelf: 'center',
    borderRadius: 12,
    marginHorizontal: 20,
    padding: 12,
  },
  overlay: { alignItems: 'center', justifyContent: 'center', padding: 20 },
  reticle: { borderWidth: 3, height: 180, width: '82%' },
  reticleWrap: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  root: { backgroundColor: '#000', flex: 1 },
  top: { left: 0, paddingHorizontal: 16, position: 'absolute', right: 0, top: 0, zIndex: 2 },
  topRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  whiteMuted: { color: 'rgba(255,255,255,0.82)', marginTop: 4, textAlign: 'center' },
  whiteText: { color: '#FFFFFF', marginTop: 12, textAlign: 'center' },
});
