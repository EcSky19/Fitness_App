import { useEffect, useRef, type ReactElement } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppStore } from '@/store/appStore';
import { useAuthStore } from '@/store/authStore';
// Imported from the module directly, not the `@/ui` barrel: the boundary must
// stay usable even if the UI kit or theme is what crashed.
import { ErrorBoundary } from '@/ui/components/ErrorBoundary';

/**
 * Shown when SQLite could not be opened or migrated.
 *
 * Without this the app looks completely healthy while every write fails, so
 * someone could log days of meals that were never stored. Deliberately styled
 * with literal colours and no UI-kit imports: the theme layer reads settings
 * from the same database that just failed.
 */
function StorageBanner(): ReactElement | null {
  const storageAvailable = useAppStore((s) => s.storageAvailable);
  const insets = useSafeAreaInsets();

  if (storageAvailable) return null;

  return (
    <View
      style={[styles.banner, { paddingTop: insets.top + 8 }]}
      accessibilityRole="alert"
      accessibilityLabel="Storage unavailable. Changes you make are not being saved."
      testID="storage-unavailable-banner"
    >
      <Text style={styles.bannerTitle}>Storage unavailable</Text>
      <Text style={styles.bannerBody}>
        MacroTrack can&apos;t open its database, so nothing you log is being saved. Restart the app;
        if this keeps happening, free up device storage.
      </Text>
    </View>
  );
}

/**
 * First-run gate: a user with no profile (or one that never finished
 * onboarding) is sent to `/onboarding` once bootstrap has loaded the database.
 *
 * It runs at most once per launch, so backing out lands on the tabs — where the
 * dashboard onboarding card remains as the fallback entry point — and manual
 * visits to `/onboarding` are never redirected away.
 */
function useFirstRunRedirect(isReady: boolean, isSignedIn: boolean, accountId: string | null): void {
  const router = useRouter();
  const segments = useSegments();
  const profile = useAppStore((s) => s.profile);
  const handledRef = useRef(false);
  const accountRef = useRef<string | null>(null);

  useEffect(() => {
    if (accountRef.current !== accountId) {
      accountRef.current = accountId;
      handledRef.current = false;
    }
    if (!isSignedIn || !isReady || handledRef.current) return;
    handledRef.current = true;

    const needsOnboarding = profile === null || profile.onboardedAt == null;
    if (!needsOnboarding || segments[0] === 'onboarding' || segments[0] === '(auth)') return;

    router.replace('/onboarding');
  }, [accountId, isReady, isSignedIn, profile, router, segments]);
}

function useAuthRedirect(isReady: boolean, isSignedIn: boolean): void {
  const router = useRouter();
  const segments = useSegments();
  const profile = useAppStore((s) => s.profile);

  useEffect(() => {
    const root = segments[0];
    if (!isSignedIn) {
      if (root !== '(auth)') router.replace('/(auth)/sign-in');
      return;
    }

    if (!isReady) return;

    const needsOnboarding = profile === null || profile.onboardedAt == null;
    if (root === '(auth)') {
      router.replace(needsOnboarding ? '/onboarding' : '/(tabs)');
    }
  }, [isReady, isSignedIn, profile, router, segments]);
}

export default function RootLayout() {
  const isReady = useAppStore((s) => s.isReady);
  const status = useAuthStore((s) => s.status);
  const session = useAuthStore((s) => s.session);
  const restore = useAuthStore((s) => s.restore);

  useEffect(() => {
    void restore();
  }, [restore]);

  const isSignedIn = status === 'signed_in';
  const readyToRender = status !== 'loading' && (!isSignedIn || isReady);

  useAuthRedirect(isReady, isSignedIn);
  useFirstRunRedirect(isReady, isSignedIn, session?.accountId ?? null);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <ErrorBoundary>
          <View style={styles.root}>
            <StorageBanner />
            {readyToRender ? (
              <Stack>
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            {isSignedIn ? (
              <>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen
                  name="scan"
                  options={{ presentation: 'fullScreenModal', headerShown: false }}
                />
                <Stack.Screen
                  name="barcode-scan"
                  options={{ presentation: 'fullScreenModal', headerShown: false }}
                />
                <Stack.Screen
                  name="scan-review"
                  options={{ presentation: 'modal', title: 'Review items' }}
                />
                <Stack.Screen
                  name="recipes"
                  options={{ presentation: 'modal', title: 'Recipes' }}
                />
                <Stack.Screen
                  name="recipe-edit"
                  options={{ presentation: 'modal', title: 'Edit recipe' }}
                />
                <Stack.Screen
                  name="food-search"
                  options={{ presentation: 'modal', title: 'Add food' }}
                />
                <Stack.Screen
                  name="food-edit"
                  options={{ presentation: 'modal', title: 'Edit food' }}
                />
                <Stack.Screen name="onboarding" options={{ headerShown: false }} />
                <Stack.Screen name="settings" options={{ title: 'Settings' }} />
                <Stack.Screen name="privacy" options={{ title: 'Privacy' }} />
                <Stack.Screen name="about" options={{ title: 'About' }} />
              </>
            ) : null}
              </Stack>
            ) : (
              <View style={styles.loading}>
                <ActivityIndicator size="large" />
              </View>
            )}
          </View>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  banner: {
    backgroundColor: '#7F1D1D',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  bannerTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  bannerBody: { color: '#FECACA', fontSize: 13, marginTop: 2, lineHeight: 18 },
});
