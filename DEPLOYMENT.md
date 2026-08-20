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

Android currently submits as a draft to the internal track. Move it through Google Play tracks only after the release blocker below is resolved.

## Release blocker: Android Health Connect permissions

`app.json` lines 37-46 request Android Health Connect permissions:

- `android.permission.health.READ_STEPS`
- `android.permission.health.READ_ACTIVE_CALORIES_BURNED`
- `android.permission.health.READ_TOTAL_CALORIES_BURNED`
- `android.permission.health.READ_EXERCISE`
- `android.permission.health.READ_DISTANCE`
- `android.permission.health.READ_WEIGHT`
- `android.permission.health.WRITE_WEIGHT`

The shipped app resolves health data through an optional native module loader (`src/services/health/nativeModule.ts`) and falls back to a simulated provider because `react-native-health` / `react-native-health-connect` are not dependencies. Google Play can reject apps that request Health Connect permissions without genuine declared functionality, a completed Health Connect declaration form, and an in-app privacy policy link.

Choose one option before Google Play submission:

1. **Ship real Health Connect support.** Add the appropriate native Health Connect library in a separate dependency/code change, implement real permission/data flows, add an in-app privacy policy link, keep app.json lines 39-45, and complete the Google Play Health Connect declaration.
2. **Defer health integration for the first release.** Remove the Health Connect entries from app.json lines 39-45 and keep only `android.permission.CAMERA` in the Android permissions array. Also remove or adjust store copy that claims Health Connect integration.

Do not submit to Google Play with the current Health Connect permissions unless option 1 is completed.

## Pre-submission checklist

- [ ] `app.json` and `eas.json` parse as valid JSON.
- [ ] `npx tsc --noEmit` passes.
- [ ] `npx expo export -p android` succeeds.
- [ ] Health Connect release blocker is resolved.
- [ ] Store assets are validated: iOS icon is `1024x1024` opaque RGB/no alpha; Android adaptive foreground/background are `1024x1024` square PNGs; no unintended alpha-bearing asset is used where stores require opacity.
- [ ] Splash screen checked on preview/release Android and iOS builds.
- [ ] `expo.version` bumped for any native runtime change.
- [ ] EAS project initialized; no guessed `owner` or `projectId`.
- [ ] Apple and Google credentials configured.
- [ ] Submit placeholders replaced with real values.
- [ ] Privacy policy URL and store listings are complete and accurate.
