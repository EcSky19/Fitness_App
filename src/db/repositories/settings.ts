/**
 * Settings repository — a `key -> JSON` table so new settings never need a
 * migration. Only keys declared on `AppSettings` are read back.
 *
 * SCOPED PER ACCOUNT (migration 3): the primary key is `(account_id, key)`, so
 * every account holds its own copy of every setting. Signed-out calls read and write nothing; only migration-era
 * unclaimed rows use the legacy sentinel before `claimLegacyData` adopts them.
 */
import type { AppSettings } from '@/types';
import { runInTransaction } from '@/db/client';
import { ACCOUNT_ID_COLUMN } from '@/db/schema';
import { getCurrentAccountId } from '@/services/auth/currentAccount';
import { ensureReady, invalidateStore, upsertSql, type SettingsRow } from './mappers';

const SETTINGS_COLUMNS = [ACCOUNT_ID_COLUMN, 'key', 'value'];

/**
 * Conflict target is the composite primary key, NOT `key` alone — `ON
 * CONFLICT(key)` no longer matches any unique index and would fail at runtime.
 */
const SETTINGS_UPSERT_SQL = upsertSql('settings', SETTINGS_COLUMNS, 'account_id, key');

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

/** Persisted settings for the signed-in account. Unknown or corrupt keys are ignored. */
export async function getSettings(): Promise<Partial<AppSettings>> {
  const db = await ensureReady();
  const accountId = getCurrentAccountId();
  if (!accountId) return {};
  const rows = await db.getAllAsync<SettingsRow>(
    'SELECT key, value FROM settings WHERE account_id = ?;',
    accountId
  );

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
  const accountId = getCurrentAccountId();
  if (!accountId) return;

  await runInTransaction(db, async () => {
    for (const [key, value] of entries) {
      await db.runAsync(SETTINGS_UPSERT_SQL, accountId, key, JSON.stringify(value));
    }
  });

  invalidateStore();
}
