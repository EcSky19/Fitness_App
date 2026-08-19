/**
 * Settings repository — a `key -> JSON` table so new settings never need a
 * migration. Only keys declared on `AppSettings` are read back.
 */
import type { AppSettings } from '@/types';
import { ensureReady, invalidateStore, type SettingsRow } from './mappers';

/** Every persisted settings key (mirrors `AppSettings`). */
export const SETTINGS_KEYS: (keyof AppSettings)[] = [
  'weightUnit',
  'heightUnit',
  'energyUnit',
  'visionProvider',
  'healthSyncEnabled',
  'addExerciseToTarget',
  'theme',
];

const KNOWN_KEYS = new Set<string>(SETTINGS_KEYS);

/** Persisted settings. Unknown or corrupt keys are ignored. */
export async function getSettings(): Promise<Partial<AppSettings>> {
  const db = await ensureReady();
  const rows = await db.getAllAsync<SettingsRow>('SELECT key, value FROM settings;');

  const settings: Record<string, unknown> = {};
  for (const row of rows ?? []) {
    if (!KNOWN_KEYS.has(row.key)) continue;
    try {
      settings[row.key] = JSON.parse(row.value) as unknown;
    } catch {
      // Corrupt value — fall back to the in-app default.
    }
  }
  return settings as Partial<AppSettings>;
}

/** Writes the given settings keys in one transaction. */
export async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  const db = await ensureReady();
  const entries = Object.entries(patch ?? {}).filter(
    ([key, value]) => KNOWN_KEYS.has(key) && value !== undefined
  );
  if (entries.length === 0) return;

  await db.withTransactionAsync(async () => {
    for (const [key, value] of entries) {
      await db.runAsync(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);',
        key,
        JSON.stringify(value)
      );
    }
  });

  invalidateStore();
}
