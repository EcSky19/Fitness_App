/**
 * The in-memory current session — deliberately a LEAF module.
 *
 * WHY IT IS SEPARATE FROM `@/services/auth`: the repository layer must call
 * `getCurrentAccountId()` on every query, INCLUDING from `@/db/repositories/admin`
 * (`exportAllData`, `getDbStats`, `clearAllData`). `@/services/auth` imports
 * `@/db/repositories/accounts`, so a repository importing it would risk a cycle
 * (`repositories/index` -> `admin` -> `services/auth` -> `repositories/accounts`).
 * This module imports nothing at runtime — only `import type`, which the compiler
 * erases — so ANY module in the app can import it safely.
 *
 * CONTRACT FOR THE REPOSITORY LAYER
 *   `getCurrentAccountId()` is SYNCHRONOUS. It never touches the database, never
 *   awaits, and never throws. It returns:
 *     - the signed-in account's id, or
 *     - `null` when nobody is signed in.
 *
 *   What a repository must do with `null`: treat it as "no scope available" and
 *   read/write NOTHING that belongs to an account. Return an empty list, `null`,
 *   or 0 rather than falling back to an unscoped query — an unscoped query is
 *   precisely the cross-account leak the scoping work exists to close. The one
 *   deliberate exception is SEED foods (`foods.account_id IS NULL AND
 *   source = 'seed'`), which are shared by every account and readable while
 *   signed out.
 *
 *   Row ids are NOT a substitute for an `account_id` predicate. `newId()` in
 *   `@/db/client` is `nanoid/non-secure`, i.e. `Math.random()`-backed and
 *   therefore predictable, so `WHERE id = ?` on its own authorises nothing.
 *   Every scoped `SELECT`, `UPDATE` and `DELETE` needs
 *   `WHERE id = ? AND account_id = ?` — the `UPDATE`/`DELETE` by-id paths most
 *   of all, since those are the easiest to overlook.
 */
import type { AuthSession, ID } from '@/types';

let currentSession: AuthSession | null = null;

/** The signed-in session, or `null`. Synchronous by contract. */
export function getCurrentSession(): AuthSession | null {
  return currentSession;
}

/**
 * The signed-in account id, or `null` when signed out. Synchronous by contract —
 * safe to call on every query from anywhere, including `@/db/repositories/admin`.
 */
export function getCurrentAccountId(): ID | null {
  return currentSession?.accountId ?? null;
}

/**
 * Replaces the in-memory session WITHOUT touching SecureStore.
 * Internal + test hook; screens should use signIn / signOut / switchAccount.
 */
export function setCurrentSession(session: AuthSession | null): void {
  currentSession = session;
}
