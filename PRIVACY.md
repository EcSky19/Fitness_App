# MacroTrack Privacy Policy

Last updated: 2026-08-20

Entity responsible for this app: The MacroTrack developer

Contact: support@macrotrack.app

## Overview

MacroTrack is a local-first nutrition and activity tracking app. Most data you enter or connect stays on your device. MacroTrack does not operate a backend server for accounts or sync.

This policy explains what data MacroTrack handles, where it is stored, and the limited cases where information leaves your device.

## Information MacroTrack stores on your device

MacroTrack stores app data in on-device SQLite using `expo-sqlite`. Local account session information and API keys are stored with the device secure storage service using `expo-secure-store` where available.

Data stored locally may include:

- Local account details, including email address, display name, password hash, password salt, and recovery question data.
- Profile details you enter, such as height, weight, sex, birth date, activity level, and goals.
- Food entries, custom foods, recipes, meal logs, nutrition values, and food photos you choose to keep with entries.
- Exercise entries and weight logs.
- App settings, including selected units, theme, selected barcode provider, selected vision provider, and Health integration settings.
- API keys you choose to save for OpenAI or Google Gemini vision analysis.

Your local account is only an on-device account. MacroTrack does not create a cloud account, upload your account database, or sync your data to a MacroTrack server.

## Health data

**This release does not read from or write to Apple HealthKit or Android Health Connect.** MacroTrack requests no health permissions, and no health platform integration is enabled. Workouts and calories burned are only what you enter yourself. The rest of this section describes how health data would be handled if that integration is enabled in a future release.

If you connect Apple HealthKit or Android Health Connect, MacroTrack may read steps, active energy, workouts or exercise, distance, and weight, depending on the permissions you grant. MacroTrack can also write weight entries back to the health platform when you choose to use that feature.

Health data read from Apple HealthKit or Android Health Connect is used inside the app for tracking and calculations and is stored on your device. MacroTrack does not sell health data, use it for advertising, or send it to a MacroTrack backend.

You can deny or revoke Health permissions in the operating system at any time. If Health access is off, you can still use MacroTrack manually.

## What leaves your device

MacroTrack only sends data off the device in these situations:

### AI photo analysis

By default, MacroTrack uses a demo on-device vision provider. In that default mode, food photos are not uploaded for analysis.

If you select a real AI vision provider and save your own API key, MacroTrack sends the selected food photo or nutrition label image to that provider for analysis:

- OpenAI, when OpenAI is selected.
- Google Gemini, when Google Gemini is selected.

Those providers process the image and return estimated nutrition information or label text. Their processing is governed by their own terms and privacy policies.

### Barcode lookup

When barcode scanning cannot match a food stored locally, MacroTrack queries the selected barcode provider. By default, this is Open Food Facts. That request sends the scanned barcode number to Open Food Facts over the network so MacroTrack can look up product details.

## Third-party services

MacroTrack may interact with these third-party services depending on the features you use:

- OpenAI: https://openai.com/policies/privacy-policy
- Google Gemini / Google APIs: https://policies.google.com/privacy
- Open Food Facts: https://world.openfoodfacts.org/privacy
- Apple HealthKit: https://www.apple.com/legal/privacy/
- Android Health Connect / Google: https://policies.google.com/privacy

MacroTrack does not control these services. Review their policies before using features that send data to them.

## What MacroTrack does not collect

MacroTrack does not include analytics, advertising, tracking SDKs, telemetry, or crash-reporting SDKs. MacroTrack does not sell your data and does not use your health or nutrition data for ads.

## Data retention and deletion

Data remains on your device until you delete it, delete your account, uninstall the app, or your operating system removes app data.

Inside the app, you can:

- Export your data as JSON.
- Clear app data for the current account.
- Delete your local account and its associated data.

Because MacroTrack does not run a backend account service, deleting local data removes the app's copy on that device but does not delete data that you previously chose to send to a third party, share in an export, store in device backups, or write to Apple HealthKit or Android Health Connect. Manage those copies through the relevant service or operating system.

## Your choices and rights

Depending on your location, you may have rights to access, export, correct, or delete personal data. MacroTrack supports local export and deletion in the app. For questions or requests that cannot be handled in-app, contact: support@macrotrack.app.

You control optional permissions such as camera, photo library, and Health access through your device settings. You can also remove saved AI provider API keys in the app.

## Children's privacy

MacroTrack is not intended for children under 13, and it does not knowingly collect data from children. If you believe a child has provided personal information in MacroTrack, delete the local account/data from the device and contact: support@macrotrack.app.

## Changes to this policy

This policy may be updated as MacroTrack changes. The updated policy should be posted with a new "Last updated" date.
