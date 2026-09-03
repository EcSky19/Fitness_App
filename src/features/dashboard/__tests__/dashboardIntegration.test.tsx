/**
 * Dashboard integration test.
 *
 * Renders the real `@/ui` kit, the real `@/domain` engine and the real
 * `useAsyncData` hook, mocking only the I/O boundaries (`@/db/repositories`,
 * `@/services/health`) and navigation. This is the counterpart to
 * `dashboard.test.tsx`, which stubs the UI kit for precise assertions.
 */
import { act, render, screen, waitFor } from '@testing-library/react-native';

import TodayScreen from '../../../../app/(tabs)/index';
import { DEFAULT_SETTINGS, useAppStore } from '@/store/appStore';
import type {
  AppSettings,
  ExerciseEntry,
  FoodEntry,
  Goal,
  ISODate,
  Macros,
  MacroTargets,
  MealType,
  UserProfile,
} from '@/types';

jest.mock('@/db/repositories', () => ({
  listEntriesByDate: jest.fn(async () => []),
  listExercisesByDate: jest.fn(async () => []),
  listEntriesByDateRange: jest.fn(async () => []),
  listExercisesByDateRange: jest.fn(async () => []),
  listWeightLogs: jest.fn(async () => []),
  listLoggedDates: jest.fn(async () => []),
  getLatestWeight: jest.fn(async () => null),
  getProfile: jest.fn(async () => null),
  getActiveGoal: jest.fn(async () => null),
  deleteFoodEntry: jest.fn(async () => {}),
}));

jest.mock('@/services/health', () => ({
  syncHealthDay: jest.fn(async () => ({
    ok: true,
    data: { importedWorkouts: 0, activeEnergyKcal: 0, steps: 0 },
  })),
  healthPlatformLabel: jest.fn(() => 'Apple Health'),
}));

jest.mock('expo-router', () => {
  const push = jest.fn();
  return {
    useRouter: () => ({ push, replace: jest.fn(), back: jest.fn(), navigate: push }),
    router: { push },
    useLocalSearchParams: () => ({}),
    __push: push,
  };
});

const repos = jest.requireMock('@/db/repositories') as Record<string, jest.Mock>;

function isoOf(d: Date): ISODate {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const TODAY: ISODate = isoOf(new Date());
const NOW = '2026-08-19T12:00:00.000Z';

function macros(calories: number, protein: number, carbs: number, fat: number): Macros {
  return { calories, protein, carbs, fat };
}

function makeEntry(id: string, name: string, mealType: MealType, m: Macros): FoodEntry {
  return {
    id,
    date: TODAY,
    mealType,
    foodId: null,
    name,
    brand: null,
    quantity: 1,
    unit: 'serving',
    servingLabel: '1 serving',
    gramsTotal: 100,
    macros: m,
    photoUri: null,
    source: 'custom',
    visionConfidence: null,
    wasEdited: false,
    loggedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const EXERCISE: ExerciseEntry = {
  id: 'x1',
  date: TODAY,
  name: 'Morning run',
  category: 'cardio',
  durationMin: 35,
  caloriesBurned: 300,
  source: 'manual',
  externalId: null,
  notes: null,
  loggedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};

const ENTRIES: FoodEntry[] = [
  makeEntry('e1', 'Greek yogurt', 'breakfast', macros(220, 20, 18, 6)),
  makeEntry('e2', 'Banana', 'breakfast', macros(105, 1, 27, 0)),
  makeEntry('e3', 'Chicken salad', 'lunch', macros(480, 42, 22, 24)),
  makeEntry('e4', 'Salmon and rice', 'dinner', macros(560, 35, 55, 20)),
  makeEntry('e5', 'Almonds', 'snack', macros(85, 3, 3, 7)),
];

const PROFILE: UserProfile = {
  id: 'p1',
  name: 'Alex',
  sex: 'male',
  birthDate: '1996-04-02',
  heightCm: 180,
  currentWeightKg: 82,
  goalWeightKg: 76,
  activityLevel: 'moderate',
  weightUnit: 'kg',
  heightUnit: 'cm',
  onboardedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};

function makeGoal(targets: MacroTargets): Goal {
  return {
    id: 'g1',
    type: 'cut',
    rateKgPerWeek: -0.5,
    macroSplit: 'balanced',
    targets,
    isManualOverride: false,
    startedAt: TODAY,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function seedStore(overrides: {
  profile?: UserProfile | null;
  goal?: Goal | null;
  settings?: Partial<AppSettings>;
}): void {
  useAppStore.setState({
    profile: overrides.profile ?? null,
    goal: overrides.goal ?? null,
    settings: { ...DEFAULT_SETTINGS, ...(overrides.settings ?? {}) },
    selectedDate: TODAY,
    isReady: true,
    dataVersion: 0,
  });
}

async function renderDashboard(): Promise<void> {
  render(<TodayScreen />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() => expect(repos.listEntriesByDate).toHaveBeenCalled());
}

/** Collects every rendered string (text children + accessibility labels). */
function collectText(node: unknown): string[] {
  if (node === null || node === undefined) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(collectText);
  if (typeof node !== 'object') return [];

  const record = node as { props?: Record<string, unknown>; children?: unknown };
  const out: string[] = [];
  const label = record.props?.accessibilityLabel;
  if (typeof label === 'string') out.push(label);
  return out.concat(collectText(record.children));
}

describe('TodayScreen (real UI kit + domain)', () => {
  beforeEach(() => {
    repos.listEntriesByDate.mockResolvedValue([]);
    repos.listExercisesByDate.mockResolvedValue([]);
    repos.listEntriesByDateRange.mockResolvedValue([]);
    repos.listExercisesByDateRange.mockResolvedValue([]);
    repos.listWeightLogs.mockResolvedValue([]);
    seedStore({});
  });

  it('composes the whole dashboard from real components', async () => {
    repos.listEntriesByDate.mockResolvedValue(ENTRIES);
    repos.listEntriesByDateRange.mockResolvedValue(ENTRIES);
    repos.listExercisesByDate.mockResolvedValue([EXERCISE]);
    repos.listExercisesByDateRange.mockResolvedValue([EXERCISE]);
    seedStore({
      profile: PROFILE,
      goal: makeGoal({ calories: 2000, protein: 150, carbs: 200, fat: 67 }),
    });

    await renderDashboard();

    // Hero, computed by the real buildDailySummary.
    expect(screen.getByText('850')).toBeTruthy();
    expect(screen.getByText('kcal left')).toBeTruthy();
    expect(screen.getByText('2,000 goal - 1,450 food + 300 exercise = 850')).toBeTruthy();

    // Macros card.
    expect(screen.getByText('101 / 150 g')).toBeTruthy();
    expect(screen.getByText('MACROS')).toBeTruthy();

    // Meals card.
    expect(screen.getByText('Breakfast')).toBeTruthy();
    expect(screen.getByText('Greek yogurt, Banana')).toBeTruthy();
    expect(screen.getByText('325 kcal · 2 items')).toBeTruthy();

    // Remaining sections.
    expect(screen.getByText('ACTIVITY')).toBeTruthy();
    expect(screen.getByText('WEIGHT')).toBeTruthy();
    expect(screen.getByText('LAST 7 DAYS')).toBeTruthy();
    expect(screen.getByLabelText('Scan food')).toBeTruthy();
  });

  it('renders the onboarding CTA and safe zeroes with no profile or goal', async () => {
    seedStore({ profile: null, goal: null });

    await renderDashboard();

    expect(screen.getByText('Set up your profile to get calorie targets')).toBeTruthy();
    expect(screen.getByText('No calorie target set yet')).toBeTruthy();
    expect(screen.getByText('Nothing logged yet')).toBeTruthy();

    const tree = collectText(screen.toJSON()).join(' | ');
    expect(tree).not.toMatch(/NaN/);
    expect(tree).not.toMatch(/Infinity/);
  });
});
