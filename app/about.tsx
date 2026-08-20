import React, { useCallback } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';

import { Card, Divider, ListRow, Screen, SectionHeader, useTheme } from '@/ui';
import { SCHEMA_VERSION } from '@/db/schema';

const LICENSE_URL = 'https://opensource.org/license/mit';

function readBuildNumber(): string {
  const nativeBuild = Constants.nativeBuildVersion;
  if (typeof nativeBuild === 'string' && nativeBuild.length > 0) return nativeBuild;

  const iosBuild = Constants.expoConfig?.ios?.buildNumber;
  if (typeof iosBuild === 'string' && iosBuild.length > 0) return iosBuild;

  const androidVersionCode = Constants.expoConfig?.android?.versionCode;
  if (typeof androidVersionCode === 'number') return String(androidVersionCode);

  return 'Not set';
}

async function openExternalUrl(url: string): Promise<void> {
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) throw new Error('Unsupported URL');
    await Linking.openURL(url);
  } catch {
    Alert.alert('Could not open link', `Open this address in your browser:\n${url}`);
  }
}

export default function AboutScreen(): React.JSX.Element {
  const router = useRouter();
  const { colors, spacing, typography } = useTheme();

  const appName = Constants.expoConfig?.name ?? 'MacroTrack';
  const version = Constants.expoConfig?.version ?? 'Not set';
  const buildNumber = readBuildNumber();

  const handleOpenLicenses = useCallback(() => {
    void openExternalUrl(LICENSE_URL);
  }, []);

  return (
    <Screen title="About" subtitle="MacroTrack app information" padded testID="about-screen">
      <Card testID="about-summary-card">
        <Text accessibilityRole="header" style={[typography.h2, { color: colors.text }]}>{appName}</Text>
        <Text style={[typography.body, styles.description, { color: colors.textMuted }]}>MacroTrack helps you track meals, macros, weight, activity, and goals with local-first storage.</Text>
        <View style={[styles.badge, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
          <Text style={[typography.label, { color: colors.text }]}>Your data is stored only on this device.</Text>
        </View>
      </Card>

      <SectionHeader title="Support details" />
      <Card padded={false} testID="about-support-card">
        <ListRow title="Version" meta={version} leftIcon="information-circle-outline" testID="about-version" />
        <Divider />
        <ListRow title="Build" meta={buildNumber} leftIcon="construct-outline" testID="about-build-number" />
        <Divider />
        <ListRow title="Local schema" meta={`v${SCHEMA_VERSION}`} leftIcon="server-outline" testID="about-schema-version" />
      </Card>

      <SectionHeader title="Privacy and licences" />
      <Card padded={false} testID="about-links-card">
        <ListRow
          title="Privacy policy"
          subtitle="View the in-app privacy policy."
          leftIcon="shield-checkmark-outline"
          onPress={() => router.push('./privacy')}
          testID="about-privacy-policy"
        />
        <Divider />
        <ListRow
          title="Open-source licences"
          subtitle="MacroTrack is distributed under the MIT licence and uses open-source packages."
          leftIcon="document-text-outline"
          onPress={handleOpenLicenses}
          testID="about-open-source-licenses"
        />
      </Card>

      <SectionHeader title="Data storage" />
      <Card testID="about-data-storage-card">
        <Text accessibilityRole="header" style={[typography.h3, { color: colors.text }]}>Local-first by design</Text>
        <Text style={[typography.body, styles.description, { color: colors.text }]}>MacroTrack does not use a backend account service or cloud sync. Food photos leave the device only when you choose OpenAI or Google Gemini for AI analysis, and barcode numbers are sent to Open Food Facts only for network product lookup.</Text>
      </Card>

      <View style={{ height: spacing.xxl }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  description: {
    marginTop: 8,
  },
});
