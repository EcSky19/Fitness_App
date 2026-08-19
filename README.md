# MacroTrack

A complete offline-first fitness and nutrition tracker built with **Expo SDK 54**, **TypeScript** and **expo-router**.

MacroTrack turns three tracking pillars into one daily number you can act on:

| Pillar | What it captures |
| --- | --- |
| **Nutrition** | Everything you eat, by meal, with per-entry macros |
| **Activity** | Workouts you log plus steps / active energy from the health platform |
| **Body weight** | Daily weigh-ins with an EMA trend line and goal projection |

On top of those sits **goal setting**: your profile (age, sex, height, weight, activity level) produces a BMR → TDEE estimate, your goal (lose / maintain / gain, at a chosen pace) turns that into a calorie target, and a macro split turns the calorie target into protein/carb/fat grams. Every screen then reports against those targets.

Everything is stored locally in SQLite. There is no account, no server and no network requirement — the only optional network call is the AI photo analysis, which is off by default.

---

## Feature tour

### Today (`app/(tabs)/index.tsx`)
- **Calorie hero** — target, consumed, burned and remaining for the selected day, with a progress ring and an over/under badge.
- **Macro summary** — protein / carbs / fat consumed vs target with progress bars.
- **Meals summary** — calories per meal (breakfast / lunch / dinner / snack) and a jump into the diary.
- **Activity card** — steps, active energy and logged workouts for the day.
- **Weight snapshot** — latest weigh-in, EMA trend and distance to your goal weight.
- **Weekly strip** — the last 7 days of calories vs target at a glance; tap it to jump into the diary.
- **Quick actions** — Scan, Add food, Exercise, Weight.
- **Onboarding prompt** — shown as a fallback when no profile/goal exists yet.
- A **date stepper** at the top changes the selected day for the whole app (the diary shares it).

### Diary (`app/(tabs)/diary.tsx`)
- Date stepper (previous / next day, labelled *Today* / *Yesterday* / `Mon, Jan 5`) shared with the dashboard through the store.
- Day totals header: consumed, burned, remaining and macro breakdown.
- One section per meal with a `+` that opens food search pre-filled with that date and meal.
- Tap an entry for **Edit**, **Duplicate**, **Copy to another meal** or **Delete**.
- Quick add (calories-only entry) and custom-food creation for things that are not in the catalogue.

### Activity (`app/(tabs)/activity.tsx`)
- Burn summary for the day: active energy from the health platform plus calories from logged workouts.
- Weekly burn chart.
- Log a workout by picking an activity from the built-in **MET table** and entering a duration — calories are computed from MET × body weight × time.
- Health connect card: request permissions, sync a day/range, or see that simulated data is in use.

### Weight (`app/(tabs)/weight.tsx`)
- Hero card with current weight, change since the first log and progress toward the goal.
- Chart of raw weigh-ins with the exponential moving average overlaid.
- Stats row (7/30-day change, average, projected goal date).
- Full history list with edit/delete, and a log sheet that defaults to your display unit.

### Profile (`app/(tabs)/profile.tsx`)
- Body stats (birth date, sex, height, current weight) with unit-aware editors.
- Goal editor: goal type, pace (kg/week), activity level and macro split preset — with a live plan breakdown showing BMR, TDEE, the calorie delta and the resulting targets.
- Target summary card, and a link into **Settings**.

### Settings (`app/settings.tsx`)
- **Units** — weight (kg/lb), height (cm/ft-in), energy (kcal/kJ).
- **Appearance** — light / dark / system.
- **Calories** — whether exercise is added to your daily budget.
- **AI photo analysis** — pick the vision provider and store its API key.
- **Health** — connection status, permission requests, and a sync toggle.
- **Data** — export everything as JSON, or clear all data (typed confirmation).

### Scan (`app/scan.tsx` → `app/scan-review.tsx`)
Photograph a plate or a nutrition label (or pick an image from the library), then review every detected item before anything is written: include/exclude items, change quantity/unit/multiplier, fix a calorie/macro mismatch, or open a single item in the full editor. "Log N items" writes them all to the chosen date and meal in one transaction.

---

## Quick start

```bash
npm install
npx expo start
```

Then press `a` / `i`, or scan the QR code with **Expo Go**.

Expo Go is enough for everything except the real health integrations (see below), which need a **development build**:

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

The food catalogue (387 foods) is seeded into SQLite on first launch, so search works immediately and offline.

---

## Vision / AI setup

**Nothing is required to use the app.** The vision service defaults to a `mock` provider that runs entirely on-device and returns plausible demo detections, so the scan flow is fully usable with zero configuration. If a real provider is selected but has no API key, analysis silently falls back to the mock provider and records a warning rather than failing.

Two real providers are implemented: **OpenAI** and **Google Gemini**.

### Option A — from the app (recommended)

`/settings` → **AI photo analysis** → pick a provider → paste the API key → **Save key**. Keys are written to **expo-secure-store** (Keychain / Keystore), never to the database or to app config. The row shows *Configured* / *Not configured*, and **Clear** removes the key.

### Option B — from `.env`

Copy `.env.example` to `.env` (values are inlined at build time, so restart the bundler after editing):

```bash
# 'mock' | 'openai' | 'gemini'
EXPO_PUBLIC_VISION_PROVIDER=mock

EXPO_PUBLIC_OPENAI_API_KEY=
EXPO_PUBLIC_OPENAI_MODEL=gpt-4o-mini

EXPO_PUBLIC_GEMINI_API_KEY=
EXPO_PUBLIC_GEMINI_MODEL=gemini-2.0-flash
```

The active provider is resolved in this order: explicit argument → app settings → `EXPO_PUBLIC_VISION_PROVIDER` → `mock`. API keys resolve SecureStore first, then the environment variable.

---

## Health setup

By default `getHealthService()` returns a **simulated** provider: deterministic steps, active energy and workouts, so the Activity tab, sync flows and tests all work on any device (including Expo Go and web) with no native modules.

Neither health library is a dependency of this project. To enable real data you need a development build:

```bash
npx expo install react-native-health          # iOS  (Apple HealthKit)
npx expo install react-native-health-connect  # Android (Health Connect)
```

Then add the libraries' config plugins to the `expo.plugins` array in `app.json` (the iOS `NSHealth*UsageDescription` strings and the Android `android.permission.health.*` permissions are already present), and rebuild:

```bash
npx expo prebuild
npx expo run:ios      # or: npx expo run:android
```

`src/services/health/nativeModule.ts` detects the installed library at runtime through a guarded, non-static `require()` and upgrades the service automatically — no code change is needed. If your build strips that lookup, register the module explicitly once in `app/_layout.tsx`:

```ts
import AppleHealthKit from 'react-native-health';
import { registerNativeHealthModule } from '@/services/health';

registerNativeHealthModule(AppleHealthKit);
```

> **HealthKit cannot work in Expo Go** — it requires native entitlements, so a custom dev build (or a release build) is mandatory. The same applies to Health Connect on Android.

---

## Architecture

```
       app/                      expo-router routes — layout, tabs, modals
         │  screens compose features, read route params, own navigation
         ▼
       src/features/<area>/      screen-level components + hooks (state machines,
         │                       forms, drafts) — the only place with UI state
         ▼
       src/ui/                   19 design-system components + theme tokens
         │
         ├── src/domain/         PURE functions: BMR/TDEE, targets, macro math,
         │                       units, dates, EMA/trend, MET burn — no I/O
         ├── src/services/       vision (mock/OpenAI/Gemini), health
         │                       (HealthKit/Health Connect/simulated), food search
         ▼
       src/db/                   SQLite schema, migrations, repositories
       src/store/                zustand: profile, goal, settings, selected date,
                                 isReady, dataVersion
```

```
app/
  _layout.tsx           root Stack, bootstrap(), first-run redirect to /onboarding
  (tabs)/_layout.tsx    Today · Diary · Activity · Weight · Profile
  (tabs)/index.tsx      dashboard          scan.tsx          camera + analysis
  (tabs)/diary.tsx      food log           scan-review.tsx   review detections
  (tabs)/activity.tsx   workouts + health  food-search.tsx   catalogue search
  (tabs)/weight.tsx     weigh-ins          food-edit.tsx     entry editor
  (tabs)/profile.tsx    body + goal        onboarding.tsx    6-step setup
                                           settings.tsx      preferences
src/
  types/       shared contract (Profile, Goal, Food, FoodEntry, ...)
  domain/      dates, units, nutrition, goals, weight, exercise
  db/          schema.ts, client.ts, repositories/
  services/    vision/, health/, foodSearch.ts
  data/        foods.seed.ts (387 foods)
  ui/          components/ + theme.ts
  features/    dashboard, diary, scan, activity, weight, profile
  store/       appStore.ts (zustand)
  hooks/       useAsyncData.ts
```

**Rules that keep this honest:**

- **Screens never do nutrition math.** Anything numeric — calorie targets, macro scaling, unit conversion, BMI, EMA, MET burn — lives in `@/domain` and is imported. `src/domain` is pure and has no React, no SQLite and no platform imports, which is why it is the most heavily unit-tested layer.
- **Screens never talk to SQLite directly except through `@/db/repositories`.** Repositories own SQL, mapping and validation.
- **Every write invalidates.** Repository writes call `invalidateStore()`, which bumps `dataVersion` in the store; `useAsyncData` watches `dataVersion` and refetches, so a logged food shows up on the dashboard and in the diary without a manual reload.
- **Startup is centralised.** `bootstrap()` in `src/store/appStore.ts` initialises the database, kicks off food seeding (fire-and-forget, guarded), then loads profile, goal and settings. It always ends with `isReady = true`, even if the database is unavailable, so the app can never hang on a splash screen.

---

## Data model

SQLite (`expo-sqlite`), created and migrated by `src/db/schema.ts`:

| Table | Holds |
| --- | --- |
| `profile` | Single row: birth date, sex, height (cm), activity level, `onboardedAt` |
| `goals` | Goal type, target weight (kg), rate (kg/week), calorie + macro targets, macro split, active flag |
| `foods` | Catalogue: name, brand, per-100 g macros, serving definitions, source, optional barcode |
| `food_entries` | One logged item: date, meal, name, quantity/unit, grams, macros, source, optional `food_id` → `foods` |
| `exercise_entries` | Date, activity, duration, calories, source (`manual` / `healthkit` / `health_connect`) |
| `weight_logs` | Date + weight in kg (+ optional note) |
| `settings` | Key/value: units, theme, health toggle, vision provider, exercise-in-budget |
| `_migrations` | Applied migration ids |

**Units:** weights are always stored in **kilograms** and heights in **centimetres**; energy is stored in **kcal**. Conversion to lb / ft-in / kJ happens only at the display boundary via `@/domain/units` (`toDisplayWeight`, `formatWeight`, `formatHeight`, `formatEnergy`, …). Dates are ISO `YYYY-MM-DD` strings in local time.

---

## Testing

```bash
npm test                 # full suite
npm test -- src/domain   # one directory
npm run typecheck
```

- Preset `jest-expo`, with `@testing-library/react-native` for component tests.
- Repository and flow tests run against a **real in-memory SQLite database** (Node's `node:sqlite`, wrapped to look like `expo-sqlite`) rather than mocks, so schema and foreign keys are exercised.
- `app/__tests__/smoke.test.tsx` mounts every route module; `app/__tests__/flows.test.tsx` drives the end-to-end journeys (scan → review → log → diary, food search → editor → log, and the invalidate/refetch cycle).
- Native modules (camera, secure store, haptics, gesture handler, safe-area) are stubbed centrally in `jest.setup.js`.

To verify a production bundle actually builds:

```bash
npx expo export -p android
npx expo export -p ios
```

---

## Known limitations / next steps

- **No cloud sync and no auth.** All data lives on the device; the only backup is Settings → *Export data* (JSON). Reinstalling the app loses everything.
- **Barcode lookup is a stub.** The schema, the `barcode` column and `getFoodByBarcode()` exist, but there is no barcode scanner UI and no product database behind it.
- **Photo portion estimates are approximate.** Vision models guess grams from a single 2D image; always sanity-check the quantity in the review screen before logging.
- **MET-based burn figures are estimates.** They use a generic MET table and your body weight, not heart rate or device sensors, and can differ noticeably from what a watch reports.
- **Health sync is read-mostly.** Steps, active energy and workouts are pulled in; only weight can be written back, and only on platforms that support it.
- No widgets, notifications/reminders, recipes or meal planning yet.
