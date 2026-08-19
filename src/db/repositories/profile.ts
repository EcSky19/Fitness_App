/**
 * Profile repository — one row PER ACCOUNT (migration 3).
 *
 * `profile.id` used to be the literal singleton `'me'`, which meant every
 * account shared one row and biometrics bled across accounts. The row is now
 * selected by `account_id` (`UNIQUE`, `NOT NULL`); `id` stays a surrogate
 * primary key so `UserProfile.id` and the `ON CONFLICT(id)` upsert are
 * unchanged. `PROFILE_ID` remains the id used for the pre-auth row.
 */
import { nowISO, todayISO } from '@/db/client';
import { ACCOUNT_ID_COLUMN, COLUMNS } from '@/db/schema';
import { getCurrentAccountId } from '@/services/auth/currentAccount';
import type { UserProfile } from '@/types';
import {
  ensureReady,
  invalidateStore,
  profileToRow,
  requireCurrentAccountId,
  rowToProfile,
  stripUndefined,
  toBindValues,
  upsertSql,
  type ProfileRow,
} from './mappers';

/** The id given to the profile written before any account exists. */
export const PROFILE_ID = 'me';

const PROFILE_COLUMNS = COLUMNS.profile.join(', ');
const PROFILE_UPSERT_COLUMNS = [...COLUMNS.profile, ACCOUNT_ID_COLUMN];
const PROFILE_UPSERT_SQL = upsertSql('profile', PROFILE_UPSERT_COLUMNS);

function defaultProfile(now: string): UserProfile {
  return {
    id: PROFILE_ID,
    name: '',
    sex: 'male',
    birthDate: todayISO(),
    heightCm: 170,
    currentWeightKg: 70,
    goalWeightKg: null,
    activityLevel: 'moderate',
    weightUnit: 'lb',
    heightUnit: 'ft_in',
    onboardedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** The stored profile for the signed-in account, or `null` when there is none. */
export async function getProfile(): Promise<UserProfile | null> {
  const db = await ensureReady();
  const accountId = getCurrentAccountId();
  if (!accountId) return null;
  // Scoped by account_id ONLY. The old "fall back to the oldest row" branch is
  // gone: with several accounts on the device it handed the caller somebody
  // else's biometrics.
  const row = await db.getFirstAsync<ProfileRow>(
    `SELECT ${PROFILE_COLUMNS} FROM profile WHERE account_id = ? LIMIT 1;`,
    accountId
  );
  return row ? rowToProfile(row) : null;
}

/**
 * Upserts the signed-in account's profile. Missing fields fall back to the
 * existing row, or to sane defaults when the profile does not exist yet.
 */
export async function saveProfile(patch: Partial<UserProfile>): Promise<UserProfile> {
  const db = await ensureReady();
  const now = nowISO();
  const scope = requireCurrentAccountId('saveProfile');
  const existing = await getProfile();
  const base = existing ?? defaultProfile(now);

  const next: UserProfile = {
    ...base,
    ...stripUndefined(patch),
    // One row per account: a new account gets its own id rather than colliding
    // with the pre-auth `'me'` row (whose `ON CONFLICT(id)` would overwrite it).
    id: existing?.id ?? scope,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const row = { ...profileToRow(next), [ACCOUNT_ID_COLUMN]: scope };
  await db.runAsync(PROFILE_UPSERT_SQL, ...toBindValues(row, PROFILE_UPSERT_COLUMNS));

  invalidateStore();
  return next;
}
