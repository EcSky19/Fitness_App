# MacroTrack deployment

MacroTrack is an Expo SDK 54 managed app (`expo ~54.0.36`, React Native 0.81.4) with package IDs:

- iOS: `com.macrotrack.app`
- Android: `com.macrotrack.app`

## Prerequisites

1. Install and authenticate EAS CLI:
   ```powershell
   npm install --global eas-cli
   eas login
   ```
2. Confirm the EAS CLI satisfies `eas.json`:
   ```powershell
   eas --version
   ```
   The configured minimum is `>= 22.0.0`.
3. Create/link the Expo project before using EAS Update or remote credentials:
   ```powershell
   eas init
   ```
   Do not hand-edit a guessed `owner` or EAS `projectId`.
4. Configure Apple Developer and Google Play credentials through EAS:
   ```powershell
   eas credentials
   ```

## Build profiles

`eas.json` defines:

- `development`: internal development-client build; Android outputs an APK.
- `preview`: internal test build; Android outputs an APK for sideloading.
- `production`: store build; Android outputs an AAB and production auto-increments store build numbers.

Build commands:

```powershell
eas build --profile development --platform android
eas build --profile development --platform ios

eas build --profile preview --platform android
eas build --profile preview --platform ios

eas build --profile production --platform android
eas build --profile production --platform ios
eas build --profile production --platform all
```

For a local machine build, append `--local`, for example:

```powershell
eas build --profile preview --platform android --local
```

Preview Android builds are APKs, so testers can download the EAS build artifact and sideload it. Preview iOS builds require Apple internal distribution credentials and registered devices unless your Apple account supports enterprise distribution.

> Note: the `development` profile sets `developmentClient: true`. This project does not currently declare `expo-dev-client` in `package.json`; add it in a separate dependency change before relying on development-client builds. Use `preview` for installable QA builds until then.

## Versioning and OTA updates

`app.json` now includes:

```json
"runtimeVersion": {
  "policy": "appVersion"
}
```

This makes OTA updates compatible only with builds that have the same `expo.version`. Bump `expo.version` whenever a native runtime change is shipped.

`eas.json` uses:

```json
"cli": {
  "version": ">= 22.0.0",
  "appVersionSource": "remote"
}
```

Production builds also set `autoIncrement: true`, so EAS manages/increments store build numbers remotely. Initial local values are `ios.buildNumber: "1"` and `android.versionCode: 1`.

No `updates` block was added because a correct EAS Update URL requires a real EAS project ID. After `eas init`, configure updates with:

```powershell
eas update:configure
```

Then publish JS-only updates with an explicit channel/branch strategy, for example:

```powershell
eas update --channel production --message "Describe the JS-only update"
```

## Splash screen

The `expo-splash-screen` config plugin uses `./assets/splash-icon.png`:

- Light background: `#E6F4FE`
- Dark background: `#0B1F2A`
- Image width: `200`
- Resize mode: `contain`

Test splash appearance on a release/preview build; Expo Go and development builds do not fully match standalone splash behavior on recent SDKs.

## Store asset validation

Validate PNG dimensions and alpha channels before submission. Current audit results:

| Asset | Required action |
| --- | --- |
| `assets/icon.png` | OK for iOS marketing icon: `1024x1024`, square, RGB PNG, no alpha. Keep it `1024x1024` and opaque. |
| `assets/splash-icon.png` | `1024x1024`, square, indexed PNG with `tRNS` transparency. Acceptable for splash artwork over configured backgrounds; do not use it as the iOS marketing icon unless exported opaque. |
| `assets/favicon.png` | `48x48`, square, RGBA PNG. Acceptable for web favicon; alpha is expected/allowed. |
| `assets/android-icon-foreground.png` | Must be regenerated before store submission: currently `512x512` RGBA. Use a `1024x1024` square PNG foreground layer with artwork inside the adaptive-icon safe zone. |
| `assets/android-icon-background.png` | Must be regenerated before store submission: currently `512x512` RGBA. Use a `1024x1024` square opaque RGB PNG background layer, or rely on `adaptiveIcon.backgroundColor` if no image layer is needed. |
| `assets/android-icon-monochrome.png` | Currently `432x432` RGBA. Verify against current Android themed-icon guidance before release; if using a PNG layer, keep it square and ensure the mask renders cleanly. |

## Store submission

Replace every placeholder in `eas.json` before submitting:

- `submit.production.android.serviceAccountKeyPath`: replace `./credentials/google-play-service-account.REPLACE_WITH_REAL_JSON` with the real local Google Play service-account JSON path.
- `submit.production.ios.appleId`: replace `REPLACE_WITH_APPLE_ID_EMAIL`.
- `submit.production.ios.ascAppId`: replace `REPLACE_WITH_APP_STORE_CONNECT_APP_ID`.
- `submit.production.ios.appleTeamId`: replace `REPLACE_WITH_APPLE_TEAM_ID`.
- `submit.production.ios.sku`: replace `REPLACE_WITH_UNIQUE_ASC_SKU`.

Submit the latest successful production build:

```powershell
eas submit --profile production --platform android
eas submit --profile production --platform ios
```

Android currently submits as a draft to the internal track.

## Resolved: Android Health Connect permissions

**Decision: health integration is deferred to a later release (option 2 below).**

`app.json` now declares only `android.permission.CAMERA`, and the iOS
`NSHealthShareUsageDescription` / `NSHealthUpdateUsageDescription` strings have
been removed. Both stores reject health permissions that are not backed by
working functionality, and this build has none: `react-native-health` and
`react-native-health-connect` are not dependencies.

Two related changes went with it, so the app does not merely lack the
permissions but behaves correctly without them:

- A release build with no native library now uses
  `src/services/health/unavailableHealth.ts` instead of the simulated provider.
  The simulator reports itself available and grants permission on request; in a
  user's hands that meant tapping **Connect**, being told it worked, and then
  seeing invented workouts counted against a real calorie budget.
- `HealthConnectCard` hides the Connect button and the "MacroTrack will read"
  list in the unavailable state, and points at manual logging instead.

Manual workout logging is unaffected and remains the supported way to record
burn in this release.

### To re-enable health in a future release

1. Add the native library (`npx expo install react-native-health` for iOS,
   `react-native-health-connect` for Android) and prebuild.
2. Restore the Android `android.permission.health.*` entries and the iOS
   `NSHealth*` usage strings in `app.json`, **in the same change**.
3. Complete Google Play's Health Connect declaration form and make sure the
   in-app privacy policy link is live.
4. Verify `getHealthService().platform` reports `healthkit` / `health_connect`
   — not `unavailable` — on a real device build.

## Pre-submission checklist

- [ ] `app.json` and `eas.json` parse as valid JSON.
- [ ] `npx tsc --noEmit` passes.
- [ ] `npx expo export -p android` succeeds.
- [x] Health Connect release blocker is resolved (deferred; permissions removed).
- [ ] Store assets are validated: iOS icon is `1024x1024` opaque RGB/no alpha; Android adaptive foreground/background are `1024x1024` square PNGs; no unintended alpha-bearing asset is used where stores require opacity.
- [ ] Splash screen checked on preview/release Android and iOS builds.
- [ ] `expo.version` bumped for any native runtime change.
- [ ] EAS project initialized; no guessed `owner` or `projectId`.
- [ ] Apple and Google credentials configured.
- [ ] Submit placeholders replaced with real values.
- [ ] Privacy policy URL and store listings are complete and accurate.
