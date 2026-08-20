# MacroTrack

MacroTrack is a local-first calorie, macro, activity and weight tracker built with **Expo SDK 54**, **React Native**, **TypeScript** and **expo-router**.

The app has **no server**. Local email/password accounts live in the device SQLite database so several people can use one device without sharing diaries, goals, foods, settings or photos. The only optional network calls are AI food-photo analysis calls to OpenAI or Gemini when the user enables a real vision provider.

| Pillar | What it captures |
| --- | --- |
| **Nutrition** | Meals, custom foods, scanned/vision entries, per-entry calories and macros |
| **Activity** | Manually logged workouts plus optional health-platform steps, active energy and workouts |
| **Body weight** | Daily weigh-ins, body-fat notes, EMA trend and goal projection |
| **Goals** | BMR/TDEE-derived calorie targets and protein/carb/fat grams from the selected macro split |

---

## Feature tour

### Auth (`app/(auth)/*`, `app/_layout.tsx`)
- Email + password accounts are fully offline and stored locally.
- Sessions are restored from `expo-secure-store`; app routes are gated in `app/_layout.tsx`.
- Sign-up can save an optional security question. **If a user sets no security question and forgets their password, that account's data is unrecoverable. There is no server-side reset.**
- Sign-in uses one generic error for unknown email and wrong password, with an in-memory lockout after repeated failures.
- Settings includes account switching, sign out, password change and account deletion.

### Today (`app/(tabs)/index.tsx`)
- Calorie target, consumed, burned and remaining for the selected day.
- Macro progress for protein, carbs and fat.
- Meal summary, activity card, weight snapshot, weekly calorie strip and quick actions.
- Onboarding prompt when the signed-in account has no completed profile.

### Diary (`app/(tabs)/diary.tsx`)
- Date stepper shared with the dashboard.
- Day totals and one section per meal.
- Add, edit, duplicate, copy-to-meal and delete food entries.
- Quick add and custom-food creation for items not in the catalogue.
- Copy yesterday's meal into today in one tap, or save a logged meal as a reusable saved meal.

### Recipes and saved meals (`app/recipes.tsx` → `app/recipe-edit.tsx`)
- **Saved meals** are combinations you log as-is, like your usual breakfast.
- **Recipes** are bulk dishes divided into servings, like a pot of chilli; logging scales every ingredient by `servings / recipe.servings`.
- Browse, search, filter by kind and star favourites.
- Build from scratch or from entries you already logged, then reorder/edit ingredients with live totals.
- Logging expands the recipe into real, individually editable diary entries in one transaction.

### Activity (`app/(tabs)/activity.tsx`)
- Daily burn summary from logged workouts plus optional health active energy.
- Weekly burn chart.
- Manual workout logging from a built-in MET table.
- Health connection card for permissions, day/range sync and simulated-data fallback.

### Weight (`app/(tabs)/weight.tsx`)
- Current weight, change from first log and goal progress.
- Raw weigh-ins plus EMA trend chart.
- 7/30-day stats, projected goal date and editable history.
- Weight writes back to the health platform when available and enabled.

### Profile (`app/(tabs)/profile.tsx`)
- Unit-aware body stats editors.
- Goal type, pace, activity level and macro split editor.
- Live BMR/TDEE, calorie delta and macro-target breakdown.

### Settings (`app/settings.tsx`)
- Account management.
- Units, theme and exercise-budget preferences.
- AI provider/key storage.
- Barcode lookup source.
- Health status, permissions and sync toggle.
- Data export as JSON and account-scoped data clearing.

### Scan (`app/scan.tsx` → `app/scan-review.tsx`)
Take or pick a food image, analyze it with the mock/OpenAI/Gemini provider, review every detected item, adjust quantities/macros and log the chosen items in one transaction. Food photos are copied under `document/food-entry-photos/<accountId>/` and deleted when the entry or the signed-in account's data is deleted.

### Barcode (`app/barcode-scan.tsx`)
Scan a product barcode with the camera, or type it in when the label is damaged. Lookup checks your own foods first (so a rescan is instant and works offline), then the configured provider — Open Food Facts by default, which needs no API key. A miss is treated as "create this food" rather than an error, and network failures are reported separately from a genuine not-found. Confirmed products are saved to your catalogue and reused on the next scan.

---

## Quick start

```bash
npm install
npx expo start
```

Then press `a` / `i`, or scan the QR code with **Expo Go**.

Expo Go is enough for the simulated health provider and the rest of the JavaScript app. Real HealthKit / Health Connect integrations require a development build:

```bash
npx expo prebuild
npx expo run:android   # or: npx expo run:ios  (macOS only)
```

### Scripts

| Script | Does |
| --- | --- |
| `npm start` | `expo start` |
| `npm run android` | `expo start --android` |
| `npm run ios` | `expo start --ios` |
| `npm run web` | `expo start --web` |
| `npm test` | Jest (`jest-expo` preset) |
| `npm run typecheck` | `tsc --noEmit` |

The built-in food catalogue currently contains **387 foods** and is seeded into SQLite on first launch.

---

## Vision / AI setup

No setup is required. The default `mock` provider runs without a network key and returns plausible demo detections, so the scan flow works offline. If a real provider is selected but has no usable key, analysis falls back to mock data and records a warning.

Two real providers are implemented: **OpenAI** and **Google Gemini**.

### Recommended: enter the key in Settings

Go to Settings → **AI photo analysis**, choose a provider, paste the API key and save. Keys are stored in `expo-secure-store` under `macrotrack.vision.<providerId>` and are not written to SQLite or app config. If SecureStore is unavailable, the key is only cached for the current process and the UI warns the user.

### Development-only `.env` fallback

Copy `.env.example` to `.env` only for local development. Metro inlines `EXPO_PUBLIC_*` values into the JavaScript bundle at build time. They are **not secrets**; anyone with the APK or JS bundle can extract them.

Use `.env` keys only as throwaway, rate-capped development keys. Never put a real production key in a distributed build. Runtime code also gates `EXPO_PUBLIC_OPENAI_API_KEY` and `EXPO_PUBLIC_GEMINI_API_KEY` behind `__DEV__`, so release builds ignore those inlined key fallbacks.

```bash
EXPO_PUBLIC_VISION_PROVIDER=mock
EXPO_PUBLIC_OPENAI_API_KEY=
EXPO_PUBLIC_OPENAI_MODEL=gpt-4o-mini
EXPO_PUBLIC_GEMINI_API_KEY=
EXPO_PUBLIC_GEMINI_MODEL=gemini-2.0-flash
```

Provider resolution is: explicit argument → app settings → `EXPO_PUBLIC_VISION_PROVIDER` → `mock`. API-key resolution is SecureStore/cache first, then the `__DEV__`-only environment fallback.

---

## Health setup

By default `getHealthService()` returns a deterministic simulated provider, so Activity, sync flows and tests work on any device without native health libraries.

Neither native health library is a dependency of this project. To enable real health data, add the relevant library to a development build and add its config plugin to `app.json`:

```bash
npx expo install react-native-health          # iOS / Apple HealthKit
npx expo install react-native-health-connect  # Android / Health Connect
```

The current native permission declarations are:

- iOS `NSHealthShareUsageDescription` and `NSHealthUpdateUsageDescription`, plus camera/photo-library strings.
- Android `CAMERA`, health reads for steps, active calories, total calories, exercise, distance and weight, plus `WRITE_WEIGHT`.

`src/services/health/nativeModule.ts` detects an installed native library through a guarded optional `require()` and upgrades the service automatically. If a build strips that lookup, register the native module explicitly in `app/_layout.tsx` with `registerNativeHealthModule(...)`.

HealthKit and Health Connect do not work in Expo Go; use a custom dev build or release build.

---

## Architecture

```
app/                      expo-router routes, auth gate, tabs, modals
src/features/<area>/      screen-level components, hooks and UI state
src/ui/                   design-system components and theme tokens
src/domain/               pure nutrition, goal, unit, date, EMA and MET math
src/services/             auth, vision, health and food-search services
src/db/                   SQLite schema, migrations and repositories
src/store/                zustand app/auth stores, selected date, cache invalidation
src/data/                 built-in food seed catalogue
```

Key rules:

- Screens do not do nutrition math; `src/domain` owns calculations and has no React/SQLite/platform imports.
- Screens use repositories instead of raw SQLite.
- Public repository APIs deliberately do **not** accept `accountId`. Repositories resolve the active account internally via synchronous `getCurrentAccountId()` from `src/services/auth/currentAccount.ts`.
- Every write invalidates the app store, bumping `dataVersion` so `useAsyncData` screens refetch.
- `useAuthStore` resets app data on sign-in, sign-out and account switch so cached rows from another account cannot bleed into the current UI.
- Startup is centralized: auth restore happens from the root layout; app bootstrap initializes SQLite, seeds foods and loads the signed-in account's profile/goal/settings.

Important auth modules:

- `src/services/auth/index.ts` — sign-up/sign-in/session/account-management contract.
- `src/services/auth/password.ts` — hashing, verification, validation and rehash detection.
- `src/services/auth/sessionStorage.ts` — SecureStore-backed session descriptor.
- `src/services/auth/currentAccount.ts` — synchronous current account for repositories.
- `src/store/authStore.ts` — zustand auth state and cache reset.
- `src/db/repositories/accounts.ts` — account rows, credential fields and legacy data claiming.

---

## Data model

SQLite is created and migrated by `src/db/schema.ts`. Current `SCHEMA_VERSION` is **3**.

| Table | Holds |
| --- | --- |
| `accounts` | Local accounts: normalized email, display name, password derivation fields, optional security question/answer derivation and login timestamps |
| `profile` | One profile per account: sex, birth date, height, current/goal weight, units and onboarding state |
| `goals` | Account-scoped goal history, active goal, calorie target and macro targets |
| `foods` | Shared seed foods plus account-scoped custom/scanned foods, per-100 g macros, serving data, favorite/usage fields and optional barcode |
| `food_entries` | Account-scoped logged meals with date, meal type, quantity, grams, macros, optional `food_id`, optional photo URI and vision metadata |
| `exercise_entries` | Account-scoped manual or health-imported workouts with date, duration, calories, source and optional external id |
| `weight_logs` | Account-scoped date, weight kg, optional body-fat percentage/note and source |
| `settings` | Account-scoped key/value preferences with `PRIMARY KEY (account_id, key)` |
| `recipes` | Account-scoped saved meals and recipes: kind, servings, default meal type, notes, favorite/usage fields and cached totals |
| `recipe_items` | Ingredients belonging to a recipe: name, quantity, unit, grams, macros, sort order and optional `food_id` |
| `_migrations` | Applied migration ids |

Schema history:

- Migration 1 created the original single-user tables.
- Migration 2 added `accounts` and nullable `account_id` columns to `profile`, `goals`, `food_entries`, `exercise_entries`, `weight_logs`, `settings` and `foods`.
- Migration 3 rebuilt `settings` with `PRIMARY KEY (account_id, key)`, rebuilt `profile` with a surrogate `id` plus `account_id NOT NULL UNIQUE`, and added unique indexes on `COALESCE(account_id, '')` for `weight_logs(date)` and `foods(barcode)`.
- Migration 4 added `recipes` and `recipe_items`, both with `account_id NOT NULL` and `ON DELETE CASCADE` to `accounts`.

Legacy-upgrade rule: rows from the pre-accounts app are claimed by the **first** account created on the device (`claimLegacyData`). Later accounts start empty. Tests cover upgrading a v1 database without row loss.

Maintainer warning: unclaimed legacy rows have a split sentinel. Rebuilt tables (`profile`, `settings`) use `account_id = ''`; ALTERed tables use `account_id IS NULL`. Code that needs to match unclaimed rows must use the exported `UNCLAIMED_ACCOUNT_SQL`, not a bare `IS NULL`. `foods` is special: `account_id IS NULL AND source = 'seed'` means a shared built-in food visible to every account, not claimable user data.

Units: weights are stored in kilograms, heights in centimetres and energy in kcal. Display conversion happens at the UI boundary via `src/domain/units`. Dates are local `YYYY-MM-DD` strings.

---

## Local account security posture

- Passwords and security answers are stretched with `expo-crypto` SHA-256, per-account CSPRNG salt and stored algorithm/iteration metadata.
- Current password algorithm: `sha256-iter-v2`; legacy verifiable algorithm: `sha256-iter-v1`; default iterations: `10_000`; salt length: 16 bytes.
- `needsRehash()` upgrades older/weaker derivations after a successful sign-in.
- Password comparison is constant-time over the compared strings.
- Unknown-email and wrong-password sign-ins return the same `INVALID_CREDENTIALS_MESSAGE`.
- Lockout state is in memory only. It is a UI/shoulder-surfing guard, not protection against an attacker with the decrypted SQLite file.
- This is not end-to-end encryption. A compromised/unlocked device or extracted app sandbox can expose the local database.

---

## Data export and deletion

Settings → **Export data** creates a JSON snapshot for the signed-in account. It includes that account's profile, goals, entries, workouts, weight logs and settings, plus the visible food catalogue (shared seed foods and that account's foods). On Android the app writes a cache file and shares its URI instead of placing the full plaintext health history in an intent extra; the confirmation dialog states what the file contains.

Settings → **Clear all data** deletes the signed-in account's profile, goals, custom foods, entries, workouts, weight logs and settings, and best-effort deletes food photo files referenced by that account's food entries. Account deletion also removes that account's recovery data. Shared seed foods and other accounts are left alone.

---

## Testing

```bash
npm test
npm test -- src/domain
npm run typecheck
```

- Preset: `jest-expo`.
- Component tests use `@testing-library/react-native`.
- Repository and flow tests use a real in-memory SQLite adapter (`node:sqlite` wrapped to look like `expo-sqlite`).
- Route smoke tests mount every route module; flow tests cover scan/review/log, food search/editor/log and invalidate/refetch behavior.
- Native modules are stubbed centrally in `jest.setup.js`.

Production bundle checks:

```bash
npx expo export -p android
npx expo export -p ios
```

---

## Known limitations / next steps

- **No cloud sync.** Accounts are local to one device. Export produces JSON, but there is no in-app import/restore flow.
- **No server password recovery.** If an account has no security question and the password is forgotten, that account's data is unrecoverable.
- **Barcode coverage depends on Open Food Facts.** It is a crowd-sourced database, so entries can be missing, incomplete or wrong. Products are always shown for review before they are saved, and anything you confirm is stored locally and reused.
- **Photo portion estimates are approximate.** Vision models infer grams from a single 2D image; review quantities before logging.
- **MET-based burn figures are estimates.** Manual workout calories use a generic MET table and body weight, not heart-rate/device-sensor data.
- **Health sync is read-mostly.** Steps, active energy and workouts are imported; only weight is written back.
- No widgets, notifications/reminders or multi-day meal planning yet.
