import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { addFoodEntries, upsertFood } from '@/db/repositories';
import { addDaysISO, formatDateLabel, isValidISODate, todayISO } from '@/domain';
import { DetectedItemCard } from '@/features/scan/DetectedItemCard';
import { ReviewTotalsFooter } from '@/features/scan/ReviewTotalsFooter';
import { looksLikeKeyError } from '@/features/scan/ScanErrorCard';
import {
  buildDrafts,
  itemToFoodDraft,
  parseVisionPayload,
  useScanReview,
  type ReviewItem,
} from '@/features/scan/useScanReview';
import { getVisionProviderLabel } from '@/services/vision';
import { useAppStore } from '@/store/appStore';
import { MEAL_LABELS, MEAL_TYPES } from '@/types/constants';
import type { ISODate, MealType } from '@/types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  KeyboardAvoider,
  ListRow,
  Screen,
  SegmentedControl,
  Sheet,
  useTheme,
} from '@/ui';

const MEAL_OPTIONS: { label: string; value: MealType }[] = MEAL_TYPES.map((meal) => ({
  label: MEAL_LABELS[meal],
  value: meal,
}));

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function coerceMeal(value: string | string[] | undefined): MealType | null {
  const raw = firstParam(value);
  return raw && (MEAL_TYPES as string[]).includes(raw) ? (raw as MealType) : null;
}

/**
 * A `date` param is untrusted (deep link, restored nav state). Anything that is
 * not a real calendar day is rejected: `food_entries.date` is written verbatim
 * and the diary filters on an exact match, so a stray timestamp, locale format
 * or impossible day would log the meal where nothing ever queries.
 */
function coerceDate(value: string | string[] | undefined): ISODate | null {
  const raw = firstParam(value)?.trim();
  return raw && isValidISODate(raw) ? raw : null;
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  return 'Something went wrong while saving. Please try again.';
}

export default function ScanReviewScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{
    payload?: string;
    date?: string;
    mealType?: string;
    photoUri?: string;
  }>();
  const { colors, spacing, typography, radius } = useTheme();

  const selectedDate = useAppStore((s) => s.selectedDate);
  const energyUnit = useAppStore((s) => s.settings.energyUnit);

  const result = useMemo(() => parseVisionPayload(params.payload), [params.payload]);
  const photoUri = firstParam(params.photoUri) ?? null;

  const [date, setDate] = useState<ISODate>(coerceDate(params.date) ?? selectedDate);
  const [mealType, setMealType] = useState<MealType>(coerceMeal(params.mealType) ?? 'lunch');
  const [warningsHidden, setWarningsHidden] = useState(false);
  const [photoSheet, setPhotoSheet] = useState(false);
  const [dateSheet, setDateSheet] = useState(false);
  const [saveAsCustom, setSaveAsCustom] = useState(false);
  const [logging, setLogging] = useState(false);
  const loggingRef = useRef(false);
  const [logError, setLogError] = useState<string | null>(null);

  const review = useScanReview(result);
  const mode = result?.mode ?? 'food_photo';

  const dateOptions = useMemo(() => {
    const base = todayISO();
    const options = [0, -1, -2, -3].map((offset) => addDaysISO(base, offset));
    return options.includes(date) ? options : [date, ...options];
  }, [date]);

  const openInEditor = useCallback(
    (item: ReviewItem) => {
      const draft = buildDrafts([{ ...item, included: true }], {
        date,
        mealType,
        photoUri,
        mode,
      })[0];
      if (!draft) return;
      const href =
        `/food-edit?draft=${encodeURIComponent(JSON.stringify(draft))}` +
        `&date=${encodeURIComponent(date)}&mealType=${encodeURIComponent(mealType)}`;
      router.push(href as Href);
    },
    [date, mealType, mode, photoUri]
  );

  const handleLog = useCallback(async () => {
    // `logging` only disables the button on the next render; a double tap has
    // to be rejected synchronously or the batch is written twice.
    if (!review.canLog || loggingRef.current) return;
    loggingRef.current = true;
    setLogging(true);
    setLogError(null);
    try {
      const drafts = buildDrafts(review.items, { date, mealType, photoUri, mode });
      await addFoodEntries(drafts);

      if (saveAsCustom) {
        for (const item of review.includedItems) {
          await upsertFood(itemToFoodDraft(item, mode));
        }
      }

      useAppStore.getState().invalidate();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (router.canDismiss()) router.dismissAll();
      router.replace('/(tabs)/diary');
    } catch (error) {
      setLogError(errorText(error));
    } finally {
      loggingRef.current = false;
      setLogging(false);
    }
  }, [
    date,
    mealType,
    mode,
    photoUri,
    review.canLog,
    review.includedItems,
    review.items,
    saveAsCustom,
  ]);

  if (!result) {
    return (
      <Screen title="Review items">
        <EmptyState
          icon="alert-circle-outline"
          title="We couldn't read that scan"
          message="The results got lost on the way to this screen. Take the photo again and we'll have another go."
          actionLabel="Scan again"
          onAction={() => router.replace('/scan')}
          testID="payload-error"
        />
        <View style={styles.centeredAction}>
          <Button
            title="Close"
            variant="ghost"
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)/diary');
            }}
          />
        </View>
      </Screen>
    );
  }

  const warnings = warningsHidden ? [] : result.warnings;
  const showSettingsCta = warnings.some(
    (w) => looksLikeKeyError(w) || /simulat|mock|sample data/i.test(w)
  );

  return (
    <KeyboardAvoider>
      <View style={styles.root}>
        <Screen scrollable padded>
          <Card testID="scan-summary">
            <View style={styles.summaryRow}>
              {photoUri ? (
                <Pressable
                  accessibilityRole="imagebutton"
                  accessibilityLabel="View the scanned photo"
                  onPress={() => setPhotoSheet(true)}
                  testID="photo-thumbnail"
                >
                  <Image
                    source={{ uri: photoUri }}
                    style={[styles.thumb, { borderRadius: radius.md }]}
                  />
                </Pressable>
              ) : null}

              <View style={styles.summaryText}>
                <Text style={[typography.title, { color: colors.text }]}>
                  {result.items.length === 1
                    ? '1 item detected'
                    : `${result.items.length} items detected`}
                </Text>
                <Text style={[typography.caption, { color: colors.textMuted }]} testID="provider-line">
                  {`${getVisionProviderLabel(result.provider)}${
                    result.modelId ? ` · ${result.modelId}` : ''
                  }`}
                </Text>
                <View style={{ marginTop: spacing.xs }}>
                  <Badge
                    label={mode === 'nutrition_label' ? 'Nutrition label' : 'Food photo'}
                    tone="primary"
                  />
                </View>
              </View>
            </View>

            <Text style={[typography.label, { color: colors.textMuted, marginTop: spacing.lg }]}>
              Meal
            </Text>
            <View style={{ marginTop: spacing.sm }}>
              <SegmentedControl<MealType>
                options={MEAL_OPTIONS}
                value={mealType}
                onChange={setMealType}
                size="sm"
              />
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Change date, currently ${formatDateLabel(date)}`}
              onPress={() => setDateSheet(true)}
              style={[styles.dateRow, { marginTop: spacing.md }]}
              testID="date-picker"
            >
              <Text style={[typography.body, { color: colors.textMuted }]}>Date</Text>
              <Text style={[typography.body, { color: colors.primary }]}>
                {formatDateLabel(date)}
              </Text>
            </Pressable>
          </Card>

          {warnings.length > 0 ? (
            <Card style={{ marginTop: spacing.md }} testID="warnings-card">
              <Text style={[typography.title, { color: colors.warning }]}>Heads up</Text>
              {warnings.map((warning) => (
                <Text
                  key={warning}
                  style={[typography.body, { color: colors.textMuted, marginTop: spacing.xs }]}
                >
                  {warning}
                </Text>
              ))}
              <View style={styles.warningActions}>
                {showSettingsCta ? (
                  <Button
                    title="Open Settings"
                    size="sm"
                    variant="secondary"
                    icon="key-outline"
                    onPress={() => router.push('/settings')}
                  />
                ) : null}
                <Button
                  title="Dismiss"
                  size="sm"
                  variant="ghost"
                  onPress={() => setWarningsHidden(true)}
                  testID="dismiss-warnings"
                />
              </View>
            </Card>
          ) : null}

          <View style={{ marginTop: spacing.lg }}>
            {review.items.map((item, index) => (
              <DetectedItemCard
                key={item.id}
                item={item}
                index={index}
                onChangeName={(value) => review.setName(item.id, value)}
                onChangeQuantity={(value) => review.setQuantity(item.id, value)}
                onChangeGrams={(value) => review.setGrams(item.id, value)}
                onChangeUnit={(unit) => review.setUnit(item.id, unit)}
                onChangeMacro={(key, value) => review.setMacro(item.id, key, value)}
                onMultiply={(factor) => review.applyMultiplier(item.id, factor)}
                onFixCalories={() => review.fixCalories(item.id)}
                onToggleInclude={() => review.toggleIncluded(item.id)}
                onDelete={() => review.removeItem(item.id)}
                onOpenInEditor={() => openInEditor(item)}
              />
            ))}
          </View>

          {review.items.length === 0 ? (
            <EmptyState
              icon="restaurant-outline"
              title="Nothing left to log"
              message="Add an item by hand, or scan again."
              actionLabel="Scan again"
              onAction={() => router.replace('/scan')}
            />
          ) : null}

          <Button
            title="Add item"
            icon="add-circle-outline"
            variant="secondary"
            fullWidth
            onPress={review.addItem}
            testID="add-item"
          />

          {logError ? (
            <Text
              style={[typography.body, { color: colors.danger, marginTop: spacing.md }]}
              testID="log-error"
            >
              {logError}
            </Text>
          ) : null}

          <View style={styles.bottomSpacer} />
        </Screen>

        <ReviewTotalsFooter
          totals={review.totals}
          includedCount={review.includedCount}
          energyUnit={energyUnit}
          saveAsCustom={saveAsCustom}
          onToggleSaveAsCustom={() => setSaveAsCustom((v) => !v)}
          onLog={() => {
            void handleLog();
          }}
          logging={logging}
          disabled={!review.canLog}
          hint={review.validationError}
        />

        <Sheet visible={photoSheet} onClose={() => setPhotoSheet(false)} title="Scanned photo">
          {photoUri ? (
            <Image
              source={{ uri: photoUri }}
              style={[styles.fullPhoto, { borderRadius: radius.md }]}
              resizeMode="contain"
            />
          ) : null}
        </Sheet>

        <Sheet visible={dateSheet} onClose={() => setDateSheet(false)} title="Log to which day?">
          {dateOptions.map((option) => (
            <ListRow
              key={option}
              title={formatDateLabel(option)}
              meta={option === date ? 'Selected' : undefined}
              leftIcon="calendar-outline"
              onPress={() => {
                setDate(option);
                setDateSheet(false);
              }}
              testID={`date-option-${option}`}
            />
          ))}
        </Sheet>
      </View>
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  bottomSpacer: { height: 24 },
  centeredAction: { alignItems: 'center', marginTop: 12 },
  dateRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  fullPhoto: { height: 380, width: '100%' },
  root: { flex: 1 },
  summaryRow: { flexDirection: 'row', gap: 12 },
  summaryText: { flex: 1, justifyContent: 'center' },
  thumb: { height: 72, width: 72 },
  warningActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
});
