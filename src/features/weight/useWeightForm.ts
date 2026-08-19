/**
 * Log / edit weight form state.
 *
 * The canonical value is ALWAYS `weightKg`. The display value is a derived
 * projection of it, so flipping the unit segmented control never mutates the
 * stored number (no lossy kg -> lb -> kg round trip).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import * as Haptics from 'expo-haptics';

import { addWeightLog, saveProfile, updateWeightLog } from '@/db/repositories';
import {
  fromDisplayWeight,
  isFutureISO,
  roundTo,
  toDisplayWeight,
  todayISO,
} from '@/domain';
import { getHealthService } from '@/services/health';
import { useAppStore } from '@/store/appStore';
import type { ISODate, WeightLog, WeightUnit } from '@/types';

/** A jump bigger than this warns (does not block). ~11 lb. */
export const BIG_CHANGE_KG = 5;

export const BIG_CHANGE_MESSAGE = "That's a big change, is it correct?";

const DISPLAY_DECIMALS = 1;

export interface UseWeightFormOptions {
  /** Existing log being edited; `null`/omitted creates a new one. */
  log?: WeightLog | null;
  /** Most recent log, used for the prefill, the warning baseline and profile sync. */
  latestLog?: WeightLog | null;
  /** Overrides the prefill (e.g. a value imported from Health). */
  prefillKg?: number | null;
  /** Re-seeds the form when it flips to `true` (sheet opened). */
  active?: boolean;
  onSaved?: (saved: { date: ISODate; weightKg: number }) => void;
}

export interface UseWeightFormResult {
  unit: WeightUnit;
  setUnit: (unit: WeightUnit) => void;
  /** Value shown in the input, in `unit`. */
  displayWeight: number | null;
  setDisplayWeight: (value: number | null) => void;
  /** Canonical value that will be persisted. */
  weightKg: number | null;
  date: ISODate;
  setDate: (date: ISODate) => void;
  shiftDate: (days: number) => void;
  bodyFatPct: number | null;
  setBodyFatPct: (value: number | null) => void;
  note: string;
  setNote: (value: string) => void;
  /** Non-blocking "that's a big jump" notice. */
  warning: string | null;
  dateError: string | null;
  error: string | null;
  saving: boolean;
  isEditing: boolean;
  canSave: boolean;
  reset: () => void;
  submit: () => Promise<boolean>;
}

function toDisplay(weightKg: number | null, unit: WeightUnit): number | null {
  if (weightKg == null || !Number.isFinite(weightKg)) return null;
  const converted = toDisplayWeight(weightKg, unit);
  return Number.isFinite(converted) ? roundTo(converted, DISPLAY_DECIMALS) : null;
}

function seedKg(options: UseWeightFormOptions): number | null {
  if (options.log) return options.log.weightKg;
  if (options.prefillKg != null && Number.isFinite(options.prefillKg)) return options.prefillKg;
  if (options.latestLog) return options.latestLog.weightKg;
  return null;
}

export function useWeightForm(options: UseWeightFormOptions = {}): UseWeightFormResult {
  const { log = null, latestLog = null, prefillKg = null, active = true, onSaved } = options;

  const unit = useAppStore((state) => state.settings.weightUnit);
  const healthSyncEnabled = useAppStore((state) => state.settings.healthSyncEnabled);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const setProfile = useAppStore((state) => state.setProfile);
  const invalidate = useAppStore((state) => state.invalidate);

  const initialKg = seedKg({ log, latestLog, prefillKg });

  const [weightKg, setWeightKg] = useState<number | null>(initialKg);
  const [displayWeight, setDisplayValue] = useState<number | null>(() => toDisplay(initialKg, unit));
  const [date, setDateValue] = useState<ISODate>(log?.date ?? todayISO());
  const [bodyFatPct, setBodyFatPct] = useState<number | null>(log?.bodyFatPct ?? null);
  const [note, setNote] = useState<string>(log?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previousUnit = useRef<WeightUnit>(unit);

  /** Unit flip: keep the canonical kg, re-project the display value. */
  useEffect(() => {
    if (previousUnit.current === unit) return;
    previousUnit.current = unit;
    setDisplayValue(toDisplay(weightKg, unit));
  }, [unit, weightKg]);

  const reset = useCallback(() => {
    const seed = seedKg({ log, latestLog, prefillKg });
    setWeightKg(seed);
    setDisplayValue(toDisplay(seed, unit));
    setDateValue(log?.date ?? todayISO());
    setBodyFatPct(log?.bodyFatPct ?? null);
    setNote(log?.note ?? '');
    setError(null);
    setSaving(false);
  }, [log, latestLog, prefillKg, unit]);

  const wasActive = useRef(active);
  const seedKey = `${log?.id ?? 'new'}:${prefillKg ?? ''}:${latestLog?.id ?? ''}`;
  const lastSeedKey = useRef(seedKey);

  useEffect(() => {
    const becameActive = active && !wasActive.current;
    const seedChanged = seedKey !== lastSeedKey.current;
    wasActive.current = active;
    lastSeedKey.current = seedKey;
    if (active && (becameActive || seedChanged)) reset();
    // `reset` is stable per seed; re-running on every render would clobber typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, seedKey]);

  const setUnit = useCallback(
    (next: WeightUnit) => {
      if (next === unit) return;
      updateSettings({ weightUnit: next });
    },
    [unit, updateSettings]
  );

  const setDisplayWeight = useCallback(
    (value: number | null) => {
      setDisplayValue(value);
      if (value == null || !Number.isFinite(value)) {
        setWeightKg(null);
        return;
      }
      const kg = fromDisplayWeight(value, unit);
      setWeightKg(Number.isFinite(kg) ? kg : null);
    },
    [unit]
  );

  const setDate = useCallback((next: ISODate) => {
    setDateValue(next);
  }, []);

  const shiftDate = useCallback((days: number) => {
    setDateValue((current) => {
      const base = new Date(`${current}T00:00:00`);
      if (Number.isNaN(base.getTime())) return current;
      base.setDate(base.getDate() + days);
      const iso = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(
        base.getDate()
      ).padStart(2, '0')}`;
      return isFutureISO(iso) ? current : iso;
    });
  }, []);

  const dateError = isFutureISO(date) ? 'You cannot log a weight in the future.' : null;

  /** Baseline for the "big change" notice: the newest log that is not this one. */
  const referenceKg = useMemo(() => {
    if (latestLog && latestLog.id !== log?.id) return latestLog.weightKg;
    if (log) return log.weightKg;
    return latestLog?.weightKg ?? null;
  }, [latestLog, log]);

  const warning = useMemo(() => {
    if (weightKg == null || referenceKg == null) return null;
    return Math.abs(weightKg - referenceKg) > BIG_CHANGE_KG ? BIG_CHANGE_MESSAGE : null;
  }, [weightKg, referenceKg]);

  const canSave =
    weightKg != null && Number.isFinite(weightKg) && weightKg > 0 && dateError == null && !saving;

  const savingRef = useRef(false);

  const submit = useCallback(async (): Promise<boolean> => {
    // `saving` only disables the button on the next render, so a double tap
    // inside one batch has to be rejected synchronously.
    if (savingRef.current) return false;
    if (weightKg == null || !Number.isFinite(weightKg) || weightKg <= 0) {
      setError('Enter a weight first.');
      return false;
    }
    if (isFutureISO(date)) {
      setError('You cannot log a weight in the future.');
      return false;
    }

    savingRef.current = true;
    setSaving(true);
    setError(null);

    const trimmedNote = note.trim();
    const payload = {
      date,
      weightKg,
      bodyFatPct: bodyFatPct != null && Number.isFinite(bodyFatPct) ? bodyFatPct : null,
      note: trimmedNote.length > 0 ? trimmedNote : null,
    };

    try {
      if (log) {
        await updateWeightLog(log.id, payload);
      } else {
        await addWeightLog({ ...payload, source: 'manual' });
      }

      const profile = useAppStore.getState().profile;
      const isNewest = !latestLog || date >= latestLog.date;
      if (profile && isNewest) {
        const nextProfile = { ...profile, currentWeightKg: weightKg };
        try {
          await saveProfile(nextProfile);
          setProfile(nextProfile);
        } catch (profileError) {
          console.warn('[useWeightForm] profile weight sync failed', profileError);
        }
      }

      if (healthSyncEnabled) {
        try {
          await getHealthService().writeWeight(weightKg, date);
        } catch (healthError) {
          console.warn('[useWeightForm] health write failed', healthError);
        }
      }

      invalidate();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onSaved?.({ date, weightKg });
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this weigh-in.');
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [
    weightKg,
    date,
    note,
    bodyFatPct,
    log,
    latestLog,
    healthSyncEnabled,
    invalidate,
    onSaved,
    setProfile,
  ]);

  return {
    unit,
    setUnit,
    displayWeight,
    setDisplayWeight,
    weightKg,
    date,
    setDate,
    shiftDate,
    bodyFatPct,
    setBodyFatPct,
    note,
    setNote,
    warning,
    dateError,
    error,
    saving,
    isEditing: log != null,
    canSave,
    reset,
    submit,
  };
}

export default useWeightForm;
