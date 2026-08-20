import React, { useCallback } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';

import { Card, Divider, ListRow, Screen, SectionHeader, useTheme } from '@/ui';

type PolicyBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] };

interface PolicySection {
  title: string;
  blocks: PolicyBlock[];
}

// Replace these with the real publisher identity before store submission; see
// the pre-submission checklist in DEPLOYMENT.md.
const LAST_UPDATED = '2026-08-20';
const RESPONSIBLE_ENTITY = 'The MacroTrack developer';
const CONTACT = 'support@macrotrack.app';

const POLICY_SECTIONS: PolicySection[] = [
  {
    title: 'Overview',
    blocks: [
      {
        type: 'paragraph',
        text: 'MacroTrack is a local-first nutrition and activity tracking app. Most data you enter or connect stays on your device. MacroTrack does not operate a backend server for accounts or sync.',
      },
      {
        type: 'paragraph',
        text: 'This policy explains what data MacroTrack handles, where it is stored, and the limited cases where information leaves your device.',
      },
    ],
  },
  {
    title: 'Information stored on your device',
    blocks: [
      {
        type: 'paragraph',
        text: 'MacroTrack stores app data in on-device SQLite. Local account session information and API keys are stored with the device secure storage service where available.',
      },
      {
        type: 'bullets',
        items: [
          'Local account details, including email address, display name, password hash, password salt, and recovery question data.',
          'Profile details such as height, weight, sex, birth date, activity level, and goals.',
          'Food entries, custom foods, recipes, meal logs, nutrition values, and the food and recipe photos you choose to keep.',
          'Exercise entries, weight logs, app settings, selected providers, and saved AI provider API keys.',
        ],
      },
      {
        type: 'paragraph',
        text: 'Your local account is only an on-device account. MacroTrack does not create a cloud account, upload your account database, or sync your data to a MacroTrack server.',
      },
    ],
  },
  {
    title: 'Health data',
    blocks: [
      {
        type: 'paragraph',
        text: 'This release does not read from or write to Apple HealthKit or Android Health Connect. MacroTrack requests no health permissions, and no health platform integration is enabled. Workouts and calories burned are only what you enter yourself.',
      },
      {
        type: 'paragraph',
        text: 'If that integration is enabled in a future release, MacroTrack may read steps, active energy, workouts or exercise, distance, and weight, depending on the permissions you grant, and may write weight entries back to the health platform when you choose to use that feature.',
      },
      {
        type: 'paragraph',
        text: 'Health data is used inside the app for tracking and calculations and is stored on your device. MacroTrack does not sell health data, use it for advertising, or send it to a MacroTrack backend.',
      },
    ],
  },
  {
    title: 'What leaves your device',
    blocks: [
      {
        type: 'paragraph',
        text: 'By default, MacroTrack uses a demo on-device vision provider. In that default mode, food photos are not uploaded for analysis.',
      },
      {
        type: 'paragraph',
        text: 'If you select OpenAI or Google Gemini and save your own API key, MacroTrack sends the selected food photo or nutrition label image to that provider for analysis.',
      },
      {
        type: 'paragraph',
        text: 'When barcode scanning cannot match a food stored locally, MacroTrack queries the selected barcode provider. By default, this is Open Food Facts, and the scanned barcode number is sent over the network to look up product details.',
      },
    ],
  },
  {
    title: 'What MacroTrack does not collect',
    blocks: [
      {
        type: 'paragraph',
        text: 'MacroTrack does not include analytics, advertising, tracking SDKs, telemetry, or crash-reporting SDKs. MacroTrack does not sell your data and does not use your health or nutrition data for ads.',
      },
    ],
  },
  {
    title: 'Retention, export, and deletion',
    blocks: [
      {
        type: 'paragraph',
        text: 'Data remains on your device until you delete it, delete your account, uninstall the app, or your operating system removes app data.',
      },
      {
        type: 'bullets',
        items: [
          'Export your data as JSON in the app.',
          'Clear app data for the current account in the app.',
          'Delete your local account and its associated data in the app.',
        ],
      },
      {
        type: 'paragraph',
        text: 'Deleting local data does not delete data you previously sent to a third party, shared in an export, stored in device backups, or wrote to Apple HealthKit or Android Health Connect.',
      },
    ],
  },
  {
    title: 'Your choices and rights',
    blocks: [
      {
        type: 'paragraph',
        text: `MacroTrack supports local export and deletion in the app. For questions or requests that cannot be handled in-app, contact: ${CONTACT}.`,
      },
      {
        type: 'paragraph',
        text: 'You control optional permissions such as camera, photo library, and Health access through your device settings. You can also remove saved AI provider API keys in the app.',
      },
    ],
  },
  {
    title: "Children's privacy",
    blocks: [
      {
        type: 'paragraph',
        text: `MacroTrack is not intended for children under 13, and it does not knowingly collect data from children. If you believe a child has provided personal information in MacroTrack, delete the local account/data from the device and contact: ${CONTACT}.`,
      },
    ],
  },
];

const THIRD_PARTY_LINKS = [
  { title: 'OpenAI privacy policy', url: 'https://openai.com/policies/privacy-policy' },
  { title: 'Google privacy policy', url: 'https://policies.google.com/privacy' },
  { title: 'Open Food Facts privacy policy', url: 'https://world.openfoodfacts.org/privacy' },
  { title: 'Apple privacy policy', url: 'https://www.apple.com/legal/privacy/' },
];

async function openExternalUrl(url: string): Promise<void> {
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) throw new Error('Unsupported URL');
    await Linking.openURL(url);
  } catch {
    Alert.alert('Could not open link', `Open this address in your browser:\n${url}`);
  }
}

export default function PrivacyScreen(): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();

  const handleOpen = useCallback((url: string) => {
    void openExternalUrl(url);
  }, []);

  return (
    <Screen title="Privacy" subtitle="How MacroTrack handles your data" padded testID="privacy-screen">
      <Card testID="privacy-summary-card">
        <Text accessibilityRole="header" style={[typography.h3, { color: colors.text }]}>Privacy Policy</Text>
        <Text style={[typography.caption, styles.metaText, { color: colors.textMuted }]}>Last updated: {LAST_UPDATED}</Text>
        <Text style={[typography.caption, { color: colors.textMuted }]}>Responsible entity: {RESPONSIBLE_ENTITY}</Text>
        <Text style={[typography.body, styles.paragraph, { color: colors.text }]}>MacroTrack is local-first: your account, nutrition history, settings, and Health-derived data are stored on this device unless you choose a feature that sends specific data to a third party.</Text>
      </Card>

      {POLICY_SECTIONS.map((section) => (
        <View key={section.title}>
          <SectionHeader title={section.title} />
          <Card testID={`privacy-section-${section.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
            {section.blocks.map((block, blockIndex) => {
              if (block.type === 'paragraph') {
                return (
                  <Text key={`${section.title}-${blockIndex}`} style={[typography.body, styles.paragraph, { color: colors.text }]}>
                    {block.text}
                  </Text>
                );
              }
              return (
                <View key={`${section.title}-${blockIndex}`} style={styles.bulletGroup}>
                  {block.items.map((item) => (
                    <View key={item} style={styles.bulletRow}>
                      <Text style={[typography.body, styles.bullet, { color: colors.textMuted }]}>•</Text>
                      <Text style={[typography.body, styles.bulletText, { color: colors.text }]}>{item}</Text>
                    </View>
                  ))}
                </View>
              );
            })}
          </Card>
        </View>
      ))}

      <SectionHeader title="Third-party services" />
      <Card padded={false} testID="privacy-third-party-links">
        {THIRD_PARTY_LINKS.map((link, index) => (
          <View key={link.url}>
            {index > 0 ? <Divider /> : null}
            <ListRow
              title={link.title}
              subtitle={link.url}
              leftIcon="open-outline"
              onPress={() => handleOpen(link.url)}
              testID={`privacy-link-${index}`}
            />
          </View>
        ))}
      </Card>

      <View style={{ height: spacing.xxl }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  bullet: {
    marginRight: 8,
  },
  bulletGroup: {
    marginTop: 4,
  },
  bulletRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    marginTop: 6,
  },
  bulletText: {
    flex: 1,
  },
  metaText: {
    marginTop: 8,
  },
  paragraph: {
    marginTop: 10,
  },
});
