/**
 * Profile repository — a singleton row (`id = 'me'`) holding the user's
 * biometrics and unit preferences.
 */
import { nowISO, todayISO } from '@/db/client';
import type { UserProfile } from '@/types';
import {
  ensureReady,
  invalidateStore,
  profileToRow,
  rowToProfile,
  stripUndefined,
  type ProfileRow,
} from './mappers';

/** The singleton profile row id. */
export const PROFILE_ID = 'me';

const PROFILE_COLUMNS =
  'id, name, sex, birth_date, height_cm, current_weight_kg, goal_weight_kg, activity_level, ' +
  'weight_unit, height_unit, onboarded_at, created_at, updated_at';

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

/** The stored profile, or `null` when onboarding has never run. */
export async function getProfile(): Promise<UserProfile | null> {
  const db = await ensureReady();
  const row = await db.getFirstAsync<ProfileRow>(
    `SELECT ${PROFILE_COLUMNS} FROM profile WHERE id = ? LIMIT 1;`,
    PROFILE_ID
  );
  if (row) return rowToProfile(row);

  // Defensive: imported/legacy data may carry a different primary key.
  const fallback = await db.getFirstAsync<ProfileRow>(
    `SELECT ${PROFILE_COLUMNS} FROM profile ORDER BY created_at ASC LIMIT 1;`
  );
  return fallback ? rowToProfile(fallback) : null;
}

/**
 * Upserts the singleton profile. Missing fields fall back to the existing row,
 * or to sane defaults when the profile does not exist yet.
 */
export async function saveProfile(patch: Partial<UserProfile>): Promise<UserProfile> {
  const db = await ensureReady();
  const now = nowISO();
  const existing = await getProfile();
  const base = existing ?? defaultProfile(now);

  const next: UserProfile = {
    ...base,
    ...stripUndefined(patch),
    id: existing?.id ?? PROFILE_ID,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const row = profileToRow(next);
  await db.runAsync(
    `INSERT OR REPLACE INTO profile (${PROFILE_COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    row.id,
    row.name,
    row.sex,
    row.birth_date,
    row.height_cm,
    row.current_weight_kg,
    row.goal_weight_kg,
    row.activity_level,
    row.weight_unit,
    row.height_unit,
    row.onboarded_at,
    row.created_at,
    row.updated_at
  );

  invalidateStore();
  return next;
}
