import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAppStore } from '@/store/appStore';
import { useAuthStore } from '@/store/authStore';

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
                  name="scan-review"
                  options={{ presentation: 'modal', title: 'Review items' }}
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
              </>
            ) : null}
          </Stack>
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator size="large" />
          </View>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
