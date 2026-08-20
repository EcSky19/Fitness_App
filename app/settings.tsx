import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, Share, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';

import {
  Badge,
  Button,
  Card,
  Divider,
  SectionHeader,
  Screen,
  SegmentedControl,
  Sheet,
  TextField,
  useTheme,
} from '@/ui';
import { clearAllData, exportAllData, getDbStats, saveSettings } from '@/db/repositories';
import {
  HEALTH_PERMISSIONS,
  getHealthService,
  healthPlatformLabel,
  isHealthSupported,
} from '@/services/health';
import { clearApiKey, getApiKey, listVisionProviders, setApiKey } from '@/services/vision';
import { listBarcodeProviders } from '@/services/barcode';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useAppStore } from '@/store/appStore';
import type { AppSettings, HealthPermissionStatus, HeightUnit, WeightUnit } from '@/types';

import { AccountSection } from '@/features/auth/AuthUI';
import { SettingsRow } from '@/features/profile/SettingsRow';

interface VisionProviderInfo {
  id: string;
  label: string;
  requiresApiKey: boolean;
  configured: boolean;
}

interface SettingsData {
  providers: VisionProviderInfo[];
  keyMask: string | null;
  healthSupported: boolean;
  healthStatus: HealthPermissionStatus;
  stats: { label: string; value: string }[];
}

const EMPTY_DATA: SettingsData = {
  providers: [],
  keyMask: null,
  healthSupported: false,
  healthStatus: 'unavailable',
  stats: [],
};

const CONFIRM_WORD = 'DELETE';
const EXPORT_DESCRIPTION =
  'This JSON file contains your full MacroTrack health history: profile details, weight history, body fat, goals, the visible food catalogue, and every logged meal.';

/** Only ever shows the last 4 characters — the key itself never reaches the UI. */
function maskKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const tail = key.slice(-4);
  return `${'•'.repeat(8)}${tail}`;
}

function humanizeStatKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function normalizeStats(value: unknown): { label: string; value: string }[] {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
    .map(([k, v]) => ({ label: humanizeStatKey(k), value: String(v) }));
}

const HEALTH_STATUS_LABELS: Record<HealthPermissionStatus, string> = {
  granted: 'Connected',
  denied: 'Permission denied',
  unavailable: 'Not available on this device',
  undetermined: 'Not connected',
};

export default function SettingsScreen(): React.JSX.Element {
  const router = useRouter();
  const { colors, spacing, typography } = useTheme();

  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const setProfile = useAppStore((s) => s.setProfile);
  const setGoal = useAppStore((s) => s.setGoal);
  const invalidate = useAppStore((s) => s.invalidate);

  const [refreshToken, setRefreshToken] = useState(0);
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [clearSheetOpen, setClearSheetOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const { data, loading, reload } = useAsyncData<SettingsData>(
    async () => {
      const providers = (listVisionProviders() ?? []) as VisionProviderInfo[];
      const [rawKey, supported, stats] = await Promise.all([
        Promise.resolve(getApiKey(settings.visionProvider)).catch(() => null),
        Promise.resolve(isHealthSupported()).catch(() => false),
        Promise.resolve(getDbStats()).catch(() => ({})),
      ]);

      let healthStatus: HealthPermissionStatus = 'unavailable';
      if (supported) {
        try {
          const service = await Promise.resolve(getHealthService());
          healthStatus = await service.getPermissionStatus();
        } catch {
          healthStatus = 'undetermined';
        }
      }

      return {
        providers,
        keyMask: maskKey(rawKey),
        healthSupported: Boolean(supported),
        healthStatus,
        stats: normalizeStats(stats),
      };
    },
    [settings.visionProvider, refreshToken],
    EMPTY_DATA
  );

  const applySettings = useCallback(
    (patch: Partial<AppSettings>) => {
      void Haptics.selectionAsync();
      updateSettings(patch);
      void Promise.resolve(saveSettings(patch)).catch(() => undefined);
    },
    [updateSettings]
  );

  const activeProvider = useMemo(
    () => data.providers.find((p) => p.id === settings.visionProvider) ?? null,
    [data.providers, settings.visionProvider]
  );

  // Static registry, so it needs no async load and can never fail.
  const barcodeProviders = useMemo(() => listBarcodeProviders() ?? [], []);

  /* ---------------------------------------------------------------------- */
  /* Vision key                                                              */
  /* ---------------------------------------------------------------------- */

  const handleSaveKey = useCallback(async () => {
    const trimmed = keyInput.trim();
    if (trimmed.length === 0) return;
    setBusy('key');
    try {
      const result = await setApiKey(settings.visionProvider, trimmed);
      setKeyInput('');
      setRefreshToken((n) => n + 1);
      if (result?.persisted !== false) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert(
          'Key only saved for this session',
          'MacroTrack could not write to the device secure store. The key is usable until the app restarts, but it was not saved permanently.'
        );
      }
    } catch (error) {
      Alert.alert(
        'Could not save key',
        error instanceof Error ? error.message : 'The key could not be stored securely. Please try again.'
      );
    } finally {
      setBusy(null);
    }
  }, [keyInput, settings.visionProvider]);

  const handleClearKey = useCallback(async () => {
    setBusy('key');
    try {
      const result = await clearApiKey(settings.visionProvider);
      setKeyInput('');
      setRefreshToken((n) => n + 1);
      if (result?.persisted === false) {
        Alert.alert(
          'Could not clear persisted key',
          'The key was removed from this session, but MacroTrack could not update the device secure store. Please try again.'
        );
      }
    } catch {
      Alert.alert('Could not clear key', 'Please try again.');
    } finally {
      setBusy(null);
    }
  }, [settings.visionProvider]);

  /* ---------------------------------------------------------------------- */
  /* Health                                                                  */
  /* ---------------------------------------------------------------------- */

  const handleConnectHealth = useCallback(async () => {
    setBusy('health');
    try {
      const service = await Promise.resolve(getHealthService());
      const status = await service.requestPermissions();
      setRefreshToken((n) => n + 1);
      if (status !== 'granted') {
        Alert.alert(
          'Not connected',
          `${healthPlatformLabel()} did not grant access. You can still log everything manually.`
        );
      }
    } catch {
      Alert.alert('Could not connect', 'Health access is unavailable right now.');
    } finally {
      setBusy(null);
    }
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Data                                                                    */
  /* ---------------------------------------------------------------------- */

  const handleExport = useCallback(async () => {
    setBusy('export');
    try {
      const payload = await exportAllData();
      const json = JSON.stringify(payload, null, 2);
      if (Platform.OS !== 'android') {
        await Share.share({
          title: 'MacroTrack export',
          message: json,
        });
        return;
      }

      const file = new File(Paths.cache, `macrotrack-export-${Date.now()}.json`);
      file.write(json);
      const info = file.info();
      const contentUri =
        'contentUri' in info && typeof info.contentUri === 'string' && info.contentUri.length > 0
          ? info.contentUri
          : null;
      const uri = Platform.OS === 'android' ? contentUri ?? file.uri : file.uri;

      await Share.share({
        title: 'MacroTrack export',
        message: `MacroTrack export JSON file: ${uri}`,
      });
    } catch (error) {
      Alert.alert('Export failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  }, []);

  const askExport = useCallback(() => {
    if (Platform.OS !== 'android') {
      void handleExport();
      return;
    }

    Alert.alert('Export full health history?', EXPORT_DESCRIPTION, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Export JSON file', onPress: () => void handleExport() },
    ]);
  }, [handleExport]);

  const askClearAll = useCallback(() => {
    Alert.alert(
      'Clear all data?',
      'Every food entry, weigh-in, custom food, goal and your profile will be permanently deleted from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            setConfirmText('');
            setClearSheetOpen(true);
          },
        },
      ]
    );
  }, []);

  const handleClearAll = useCallback(async () => {
    if (confirmText.trim().toUpperCase() !== CONFIRM_WORD) return;
    setBusy('clear');
    try {
      await clearAllData();
      setProfile(null);
      setGoal(null);
      invalidate();
      setClearSheetOpen(false);
      setConfirmText('');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      router.replace('/onboarding');
    } catch (error) {
      Alert.alert('Could not clear data', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  }, [confirmText, invalidate, router, setGoal, setProfile]);

  const appVersion = Constants.expoConfig?.version ?? 'dev';

  return (
    <Screen
      title="Settings"
      scrollable
      padded
      refreshing={loading}
      onRefresh={reload}
      testID="settings-screen"
    >
      <AccountSection />

      {/* ---- Units ---- */}
      <SectionHeader title="Units" />
      <Card>
        <SettingsRow title="Weight" icon="barbell-outline" stacked testID="setting-weight-unit"
          right={
            <SegmentedControl<WeightUnit>
              options={[
                { label: 'Kilograms', value: 'kg' },
                { label: 'Pounds', value: 'lb' },
              ]}
              value={settings.weightUnit}
              onChange={(weightUnit) => applySettings({ weightUnit })}
              size="sm"
            />
          }
        />
        <Divider />
        <SettingsRow title="Height" icon="resize-outline" stacked testID="setting-height-unit"
          right={
            <SegmentedControl<HeightUnit>
              options={[
                { label: 'Centimetres', value: 'cm' },
                { label: 'Feet / inches', value: 'ft_in' },
              ]}
              value={settings.heightUnit}
              onChange={(heightUnit) => applySettings({ heightUnit })}
              size="sm"
            />
          }
        />
        <Divider />
        <SettingsRow title="Energy" icon="flame-outline" stacked testID="setting-energy-unit"
          right={
            <SegmentedControl<AppSettings['energyUnit']>
              options={[
                { label: 'kcal', value: 'kcal' },
                { label: 'kJ', value: 'kJ' },
              ]}
              value={settings.energyUnit}
              onChange={(energyUnit) => applySettings({ energyUnit })}
              size="sm"
            />
          }
        />
      </Card>

      {/* ---- Appearance ---- */}
      <SectionHeader title="Appearance" />
      <Card>
        <SettingsRow
          title="Theme"
          subtitle="System follows your device setting."
          icon="color-palette-outline"
          stacked
          testID="setting-theme"
          right={
            <SegmentedControl<AppSettings['theme']>
              options={[
                { label: 'System', value: 'system' },
                { label: 'Light', value: 'light' },
                { label: 'Dark', value: 'dark' },
              ]}
              value={settings.theme}
              onChange={(theme) => applySettings({ theme })}
              size="sm"
            />
          }
        />
      </Card>

      {/* ---- Calories ---- */}
      <SectionHeader title="Calories" />
      <Card>
        <SettingsRow
          title="Add exercise to my budget"
          subtitle={
            settings.addExerciseToTarget
              ? 'On: calories burned are added to the day, so a 300 kcal run raises your budget to target + 300.'
              : 'Off: your daily budget stays fixed at your target no matter how much you train.'
          }
          icon="walk-outline"
          testID="setting-exercise"
          toggle={{
            value: settings.addExerciseToTarget,
            onChange: (addExerciseToTarget) => applySettings({ addExerciseToTarget }),
          }}
        />
      </Card>

      {/* ---- AI / Vision ---- */}
      <SectionHeader title="AI photo analysis" />
      <Card>
        <SettingsRow
          title="Provider"
          subtitle="Used when you photograph a meal or a nutrition label."
          icon="sparkles-outline"
          stacked
          testID="setting-vision-provider"
          right={
            data.providers.length > 0 ? (
              <SegmentedControl<string>
                options={data.providers.map((p) => ({ label: p.label, value: p.id }))}
                value={settings.visionProvider}
                onChange={(visionProvider) => applySettings({ visionProvider })}
                size="sm"
              />
            ) : (
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                No providers available.
              </Text>
            )
          }
        />

        <Divider />

        <View style={{ paddingVertical: spacing.md }}>
          <View style={styles.rowBetween}>
            <Text style={[typography.title, { color: colors.text }]}>API key</Text>
            <Badge
              label={activeProvider?.configured ? 'Configured' : 'Not configured'}
              tone={activeProvider?.configured ? 'success' : 'neutral'}
              testID="vision-key-badge"
            />
          </View>

          {activeProvider && !activeProvider.requiresApiKey ? (
            <Text
              style={[typography.caption, { color: colors.textMuted, marginTop: spacing.sm }]}
              testID="vision-mock-note"
            >
              {activeProvider.label} runs on simulated data, so the whole app works with no key at
              all. Switch to a real provider when you want live analysis.
            </Text>
          ) : (
            <View style={{ marginTop: spacing.sm }}>
              {data.keyMask ? (
                <Text
                  style={[typography.mono, { color: colors.textMuted, marginBottom: spacing.sm }]}
                  testID="vision-key-mask"
                >
                  {`Saved key ${data.keyMask}`}
                </Text>
              ) : null}
              <TextField
                label={data.keyMask ? 'Replace key' : 'Paste your key'}
                value={keyInput}
                onChangeText={setKeyInput}
                placeholder="sk-..."
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                helper="Stored in the device secure store. It is never shown again after saving."
                testID="vision-key-input"
              />
              <View style={[styles.actions, { marginTop: spacing.md }]}>
                <Button
                  title="Save key"
                  size="sm"
                  onPress={() => void handleSaveKey()}
                  disabled={keyInput.trim().length === 0}
                  loading={busy === 'key'}
                  testID="vision-key-save"
                />
                <View style={{ width: spacing.sm }} />
                <Button
                  title="Clear"
                  size="sm"
                  variant="ghost"
                  onPress={() => void handleClearKey()}
                  disabled={!data.keyMask}
                  testID="vision-key-clear"
                />
              </View>
            </View>
          )}
        </View>
      </Card>

      {/* ---- Barcode ---- */}
      <SectionHeader title="Barcode scanning" />
      <Card>
        <SettingsRow
          title="Lookup source"
          subtitle="Scanned barcodes always check your own foods first, then this source."
          icon="barcode-outline"
          stacked
          testID="setting-barcode-provider"
          right={
            barcodeProviders.length > 0 ? (
              <SegmentedControl<string>
                options={barcodeProviders.map((p) => ({ label: p.label, value: p.id }))}
                value={settings.barcodeProvider}
                onChange={(barcodeProvider) => applySettings({ barcodeProvider })}
                size="sm"
              />
            ) : (
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                No providers available.
              </Text>
            )
          }
        />
      </Card>

      {/* ---- Health ---- */}
      <SectionHeader title="Health" />
      <Card>
        <SettingsRow
          title={healthPlatformLabel()}
          subtitle={HEALTH_STATUS_LABELS[data.healthStatus] ?? 'Not connected'}
          icon="heart-outline"
          iconColor={colors.protein}
          testID="setting-health-status"
          right={
            <Badge
              label={data.healthStatus === 'granted' ? 'Connected' : 'Off'}
              tone={data.healthStatus === 'granted' ? 'success' : 'neutral'}
            />
          }
        />
        <Divider />
        <SettingsRow
          title="Sync health data"
          subtitle="Pull steps, workouts and active energy into your activity tab."
          icon="sync-outline"
          testID="setting-health-sync"
          toggle={{
            value: settings.healthSyncEnabled,
            onChange: (healthSyncEnabled) => applySettings({ healthSyncEnabled }),
          }}
        />
        <Divider />
        <View style={{ paddingVertical: spacing.md }}>
          <Text style={[typography.label, { color: colors.textMuted }]}>Requested permissions</Text>
          {HEALTH_PERMISSIONS.map((permission) => (
            <Text
              key={permission}
              style={[typography.caption, { color: colors.textFaint, marginTop: spacing.xs }]}
            >
              {`· ${permission}`}
            </Text>
          ))}
          <View style={{ marginTop: spacing.md }}>
            <Button
              title={data.healthStatus === 'granted' ? 'Re-request permissions' : 'Connect'}
              variant="secondary"
              size="sm"
              onPress={() => void handleConnectHealth()}
              disabled={!data.healthSupported}
              loading={busy === 'health'}
              testID="health-connect"
            />
          </View>
          {!data.healthSupported ? (
            <Text style={[typography.caption, { color: colors.textFaint, marginTop: spacing.sm }]}>
              Health integration is not available on this device.
            </Text>
          ) : null}
        </View>
      </Card>

      {/* ---- Data ---- */}
      <SectionHeader title="Data" />
      <Card>
        <View style={{ paddingVertical: spacing.md }} testID="db-stats">
          <Text style={[typography.label, { color: colors.textMuted }]}>Stored on this device</Text>
          {data.stats.length === 0 ? (
            <Text style={[typography.caption, { color: colors.textFaint, marginTop: spacing.xs }]}>
              No data yet.
            </Text>
          ) : (
            data.stats.map((stat) => (
              <View key={stat.label} style={[styles.rowBetween, { marginTop: spacing.xs }]}>
                <Text style={[typography.caption, { color: colors.textMuted }]}>{stat.label}</Text>
                <Text style={[typography.mono, { color: colors.text }]}>{stat.value}</Text>
              </View>
            ))
          )}
        </View>
        <Divider />
        <SettingsRow
          title="Export data"
          subtitle="Share everything as a JSON file."
          icon="download-outline"
          testID="setting-export"
          right={
            <Button
              title="Export"
              size="sm"
              variant="secondary"
              onPress={askExport}
              loading={busy === 'export'}
              testID="data-export"
            />
          }
        />
        <Divider />
        <SettingsRow
          title="Clear all data"
          subtitle="Permanently deletes everything on this device."
          icon="trash-outline"
          iconColor={colors.danger}
          testID="setting-clear"
          right={
            <Button
              title="Clear"
              size="sm"
              variant="danger"
              onPress={askClearAll}
              testID="data-clear"
            />
          }
        />
        <Divider />
        <SettingsRow
          title="Version"
          icon="information-circle-outline"
          testID="setting-version"
          right={
            <Text style={[typography.mono, { color: colors.textMuted }]} testID="app-version">
              {appVersion}
            </Text>
          }
        />
      </Card>

      <View style={{ height: spacing.xxl }} />

      <Sheet
        visible={clearSheetOpen}
        onClose={() => setClearSheetOpen(false)}
        title="Confirm deletion"
      >
        <View style={{ gap: spacing.md }} testID="clear-confirm-sheet">
          <Text style={[typography.body, { color: colors.textMuted }]}>
            {`This cannot be undone. Type ${CONFIRM_WORD} to confirm.`}
          </Text>
          <TextField
            label={`Type ${CONFIRM_WORD}`}
            value={confirmText}
            onChangeText={setConfirmText}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={CONFIRM_WORD}
            testID="clear-confirm-input"
          />
          <View style={styles.actions}>
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => setClearSheetOpen(false)}
              testID="clear-cancel"
            />
            <View style={{ width: spacing.sm }} />
            <Button
              title="Delete everything"
              variant="danger"
              onPress={() => void handleClearAll()}
              disabled={confirmText.trim().toUpperCase() !== CONFIRM_WORD}
              loading={busy === 'clear'}
              testID="clear-confirm"
            />
          </View>
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
  rowBetween: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
});
