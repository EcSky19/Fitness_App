/**
 * Route smoke tests.
 *
 * Every expo-router route module must export a real component that mounts
 * without throwing. Screens run against a REAL in-memory SQLite database (the
 * same harness the repository tests use) so this also proves the screen ->
 * repository -> `@/db/client` wiring resolves end to end.
 *
 * Only the platform edges are mocked: navigation, the health platform and the
 * vision provider.
 */
import { act, render, screen } from '@testing-library/react-native';
import React from 'react';

import { setupTestDb, teardownTestDb } from '@/db/repositories/__tests__/testDb';
import { todayISO } from '@/db/client';
import { DEFAULT_SETTINGS, useAppStore } from '@/store/appStore';

jest.mock('expo-router', () => {
  const ReactLib = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');

  const container = (name: string) => {
    const Component = ({ children }: { children?: React.ReactNode }) =>
      ReactLib.createElement(View, { testID: `router-${name}` }, children);
    Component.displayName = name;
    return Component;
  };

  const ScreenStub = (): null => null;
  const Stack = Object.assign(container('Stack'), { Screen: ScreenStub });
  const Tabs = Object.assign(container('Tabs'), { Screen: ScreenStub });

  const router = {
    push: jest.fn(),
    replace: jest.fn(),
    navigate: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
    setParams: jest.fn(),
    dismissAll: jest.fn(),
  };

  return {
    __esModule: true,
    Stack,
    Tabs,
    router,
    useRouter: () => router,
    useNavigation: () => ({ setOptions: jest.fn() }),
    useLocalSearchParams: () => ({}),
    useGlobalSearchParams: () => ({}),
    useSegments: () => [],
    usePathname: () => '/',
    useFocusEffect: (callback: () => void) => {
      ReactLib.useEffect(() => {
        callback();
      }, [callback]);
    },
    Link: container('Link'),
    Redirect: (): null => null,
  };
});

jest.mock('@/services/health', () => {
  const actual = jest.requireActual('@/services/health') as Record<string, unknown>;
  const summary = (date: string) => ({
    date,
    steps: 0,
    activeEnergyKcal: 0,
    restingEnergyKcal: 0,
    exerciseMinutes: 0,
    distanceMeters: 0,
    workouts: [],
  });

  return {
    ...actual,
    isHealthSupported: jest.fn(() => false),
    healthPlatformLabel: jest.fn(() => 'Health'),
    getHealthService: jest.fn(() => ({
      platform: 'mock',
      isAvailable: jest.fn(async () => false),
      getPermissionStatus: jest.fn(async () => 'undetermined'),
      requestPermissions: jest.fn(async () => 'denied'),
      getDaySummary: jest.fn(async (date: string) => summary(date)),
      getRange: jest.fn(async () => []),
      getLatestWeightKg: jest.fn(async () => null),
      writeWeight: jest.fn(async () => false),
    })),
    syncHealthDay: jest.fn(async () => ({ ok: false, error: 'Health disabled in tests' })),
    syncHealthRange: jest.fn(async () => ({ ok: false, error: 'Health disabled in tests' })),
  };
});

jest.mock('@/services/vision', () => {
  const actual = jest.requireActual('@/services/vision') as Record<string, unknown>;
  return {
    ...actual,
    analyzeImage: jest.fn(async () => ({ ok: false, error: 'Vision disabled in tests' })),
    imageUriToBase64: jest.fn(async () => ({ base64: '', mimeType: 'image/jpeg' })),
    getApiKey: jest.fn(async () => null),
    setApiKey: jest.fn(async () => undefined),
    clearApiKey: jest.fn(async () => undefined),
  };
});

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

// The real provider renders nothing until it has measured the window, so give
// it static metrics — otherwise the root layout's children never mount here.
jest.mock('react-native-safe-area-context', () => {
  const ReactLib = require('react') as typeof import('react');
  const actual = jest.requireActual(
    'react-native-safe-area-context'
  ) as typeof import('react-native-safe-area-context');

  const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
  };

  const SafeAreaProvider = ({ children }: { children?: React.ReactNode }) =>
    ReactLib.createElement(actual.SafeAreaProvider, { initialMetrics: metrics }, children);

  return { ...actual, SafeAreaProvider };
});

import RootLayout from '../_layout';
import TabsLayout from '../(tabs)/_layout';
import ActivityScreen from '../(tabs)/activity';
import DiaryScreen from '../(tabs)/diary';
import TodayScreen from '../(tabs)/index';
import ProfileScreen from '../(tabs)/profile';
import WeightScreen from '../(tabs)/weight';
import FoodEditScreen from '../food-edit';
import FoodSearchScreen from '../food-search';
import OnboardingScreen from '../onboarding';
import ScanReviewScreen from '../scan-review';
import ScanScreen from '../scan';
import SettingsScreen from '../settings';

/** Route path -> module default export, mirroring the `app/` directory. */
const ROUTES: [string, React.ComponentType<Record<string, never>>][] = [
  ['app/_layout.tsx', RootLayout],
  ['app/(tabs)/_layout.tsx', TabsLayout],
  ['app/(tabs)/index.tsx', TodayScreen],
  ['app/(tabs)/diary.tsx', DiaryScreen],
  ['app/(tabs)/activity.tsx', ActivityScreen],
  ['app/(tabs)/weight.tsx', WeightScreen],
  ['app/(tabs)/profile.tsx', ProfileScreen],
  ['app/scan.tsx', ScanScreen],
  ['app/scan-review.tsx', ScanReviewScreen],
  ['app/food-search.tsx', FoodSearchScreen],
  ['app/food-edit.tsx', FoodEditScreen],
  ['app/onboarding.tsx', OnboardingScreen],
  ['app/settings.tsx', SettingsScreen],
];

async function mount(Component: React.ComponentType<Record<string, never>>): Promise<void> {
  render(<Component {...({} as Record<string, never>)} />);
  // Let the mount-time repository reads settle before the tree is asserted on.
  await act(async () => {
    await Promise.resolve();
  });
}

beforeAll(async () => {
  await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(() => {
  useAppStore.setState({
    profile: null,
    goal: null,
    settings: { ...DEFAULT_SETTINGS },
    selectedDate: todayISO(),
    isReady: true,
    dataVersion: 0,
  });
});

describe('route modules', () => {
  it.each(ROUTES)('%s exports a component', (_path, Component) => {
    expect(typeof Component).toBe('function');
  });

  it.each(ROUTES)('%s mounts without throwing', async (_path, Component) => {
    await mount(Component);
    expect(screen.toJSON()).not.toBeNull();
  });
});

describe('root layout', () => {
  it('shows a loading state until bootstrap finishes, then renders the stack', async () => {
    useAppStore.setState({ isReady: false });

    render(<RootLayout />);
    expect(screen.queryByTestId('router-Stack')).toBeNull();

    await act(async () => {
      await useAppStore.getState().bootstrap();
    });
    expect(useAppStore.getState().isReady).toBe(true);
    expect(screen.getByTestId('router-Stack')).toBeTruthy();
  });
});

describe('today screen', () => {
  it('renders the dashboard header and the quick actions', async () => {
    await mount(TodayScreen);

    // Both the screen title and the date stepper label today as "Today".
    expect(screen.getAllByText('Today').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Scan food').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Add food').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Log weight').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });
});
