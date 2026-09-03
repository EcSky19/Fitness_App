/**
 * Dashboard screen tests.
 *
 * Every collaborating UI/domain module is mocked with a faithful
 * implementation of its published contract so assertions can target exact
 * rendered strings, while the I/O boundaries (`@/db/repositories`,
 * `@/services/health`) and navigation are stubbed. `useAsyncData` and the app
 * store are used for real. `dashboardIntegration.test.tsx` is the counterpart
 * that renders the real UI kit and domain engine.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

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
  WeightLog,
} from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

jest.mock('@/ui', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  const h = React.createElement;

  const shiftISO = (date: string, delta: number): string => {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + delta);
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const theme = {
    colors: {
      bg: '#0b0b0f',
      surface: '#15151c',
      surfaceAlt: '#1f1f28',
      border: '#2a2a35',
      text: '#f5f5f7',
      textMuted: '#a1a1ad',
      textFaint: '#6e6e7a',
      primary: '#4ade80',
      primaryDim: '#123322',
      onPrimary: '#04140b',
      protein: '#f87171',
      carbs: '#60a5fa',
      fat: '#fbbf24',
      calories: '#fb923c',
      success: '#22c55e',
      warning: '#f59e0b',
      danger: '#ef4444',
      overlay: 'rgba(0,0,0,0.6)',
    },
    spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
    radius: { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 },
    typography: {},
    isDark: true,
  };

  return {
    useTheme: () => theme,
    hexToRgba: (hex: string) => hex,

    Screen: ({ title, subtitle, headerRight, children }: any) =>
      h(View, { testID: 'screen' }, [
        title ? h(Text, { key: 't' }, title) : null,
        subtitle ? h(Text, { key: 's' }, subtitle) : null,
        headerRight ? h(View, { key: 'hr' }, headerRight) : null,
        h(View, { key: 'c' }, children),
      ]),

    Card: ({ children, onPress }: any) =>
      onPress
        ? h(Pressable, { onPress, testID: 'card' }, children)
        : h(View, { testID: 'card' }, children),

    Button: ({ title, onPress, disabled }: any) =>
      h(
        Pressable,
        { onPress, disabled, accessibilityRole: 'button', accessibilityLabel: title },
        h(Text, null, title)
      ),

    SegmentedControl: () => null,

    ProgressRing: ({ progress, children }: any) =>
      h(View, { testID: 'progress-ring' }, [
        h(Text, { key: 'p', testID: 'progress-ring-value' }, String(progress)),
        h(View, { key: 'c' }, children),
      ]),

    MacroBar: ({ protein, carbs, fat }: any) =>
      h(Text, { testID: 'macro-bar' }, `${protein}|${carbs}|${fat}`),

    StatTile: ({ label, value, sublabel, onPress }: any) =>
      h(Pressable, { onPress, testID: 'stat-tile' }, [
        h(Text, { key: 'l' }, label),
        h(Text, { key: 'v' }, String(value)),
        sublabel ? h(Text, { key: 's' }, sublabel) : null,
      ]),

    LineChart: ({ data }: any) =>
      h(Text, { testID: 'line-chart' }, `points:${Array.isArray(data) ? data.length : 0}`),

    ListRow: ({ title, subtitle, meta, right, onPress, onLongPress }: any) =>
      h(View, { testID: 'list-row' }, [
        h(Pressable, { key: 'p', onPress, onLongPress, accessibilityLabel: title }, [
          h(Text, { key: 't' }, title),
          subtitle ? h(Text, { key: 's' }, subtitle) : null,
          meta ? h(Text, { key: 'm' }, meta) : null,
        ]),
        right ? h(View, { key: 'r' }, right) : null,
      ]),

    EmptyState: ({ title, message, actionLabel, onAction }: any) =>
      h(View, { testID: 'empty-state' }, [
        h(Text, { key: 't' }, title),
        message ? h(Text, { key: 'm' }, message) : null,
        actionLabel
          ? h(
              Pressable,
              { key: 'a', onPress: onAction, accessibilityLabel: actionLabel },
              h(Text, null, actionLabel)
            )
          : null,
      ]),

    Sheet: ({ children }: any) => h(View, null, children),
    Chip: ({ label }: any) => h(Text, null, label),
    SectionHeader: ({ title, right }: any) =>
      h(View, { testID: 'section-header' }, [
        h(Text, { key: 't' }, title),
        right ? h(View, { key: 'r' }, right) : null,
      ]),
    Divider: () => h(View, null),
    Badge: ({ label }: any) => h(Text, null, label),

    DateStepper: ({ date, onChange }: any) =>
      h(View, { testID: 'date-stepper' }, [
        h(Text, { key: 'd' }, date),
        h(
          Pressable,
          {
            key: 'prev',
            accessibilityLabel: 'Previous day',
            onPress: () => onChange(shiftISO(date, -1)),
          },
          h(Text, null, 'prev')
        ),
        h(
          Pressable,
          {
            key: 'next',
            accessibilityLabel: 'Next day',
            onPress: () => onChange(shiftISO(date, 1)),
          },
          h(Text, null, 'next')
        ),
      ]),
  };
});

jest.mock('@/domain', () => {
  const KG_PER_LB = 0.45359237;

  const iso = (d: Date): string => {
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const addDaysISO = (date: string, n: number): string => {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + n);
    return iso(d);
  };

  const emptyMacros = (): Macros => ({ calories: 0, protein: 0, carbs: 0, fat: 0 });

  const sumMacros = (list: { macros?: Macros }[]): Macros =>
    list.reduce((acc: Macros, item) => {
      const m = item.macros;
      return {
        calories: acc.calories + (m?.calories ?? 0),
        protein: acc.protein + (m?.protein ?? 0),
        carbs: acc.carbs + (m?.carbs ?? 0),
        fat: acc.fat + (m?.fat ?? 0),
      };
    }, emptyMacros());

  return {
    emptyMacros,
    sumMacros,
    todayISO: () => iso(new Date()),
    addDaysISO,
    computeLoggingStreak: (dates: string[], referenceDate: string) => {
      const logged = new Set(dates);
      let cursor = referenceDate;
      if (!logged.has(cursor)) {
        cursor = addDaysISO(cursor, -1);
        if (!logged.has(cursor)) return 0;
      }
      let streak = 0;
      while (logged.has(cursor)) {
        streak += 1;
        cursor = addDaysISO(cursor, -1);
      }
      return streak;
    },
    computeLongestStreak: (dates: string[], referenceDate: string) => {
      const sorted = [...new Set(dates)].filter((d) => d <= referenceDate).sort();
      if (sorted.length === 0) return 0;
      let longest = 1;
      let current = 1;
      for (let i = 1; i < sorted.length; i++) {
        const prevPlusOne = addDaysISO(sorted[i - 1], 1);
        current = sorted[i] === prevPlusOne ? current + 1 : 1;
        longest = Math.max(longest, current);
      }
      return longest;
    },
    isFutureISO: (date: string) => date > iso(new Date()),
    formatDateLabel: (date: string) => date,
    lastNDaysISO: (n: number, end?: string) => {
      const anchor = end ?? iso(new Date());
      return Array.from({ length: n }, (_, i) => addDaysISO(anchor, -(n - 1 - i)));
    },
    macrosToCalories: (m: Macros) => m.protein * 4 + m.carbs * 4 + m.fat * 9,
    roundTo: (n: number, dp = 0) => Number(n.toFixed(dp)),
    clamp: (n: number, min: number, max: number) => Math.min(Math.max(n, min), max),
    calcAge: () => 30,
    formatEnergy: (kcal: number) => `${Math.round(kcal)} kcal`,
    toDisplayWeight: (kg: number, unit: string) => (unit === 'lb' ? kg / KG_PER_LB : kg),
    formatWeight: (kg: number, unit: string) =>
      unit === 'lb' ? `${(kg / KG_PER_LB).toFixed(1)} lb` : `${kg.toFixed(1)} kg`,
    weightTrend: (logs: { weightKg: number }[]) => {
      if (logs.length < 2) return { changeKg: 0, ratePerWeekKg: 0, direction: 'flat' };
      const changeKg = logs[logs.length - 1].weightKg - logs[0].weightKg;
      const direction = changeKg > 0.1 ? 'up' : changeKg < -0.1 ? 'down' : 'flat';
      return { changeKg, ratePerWeekKg: changeKg, direction };
    },
    buildTargetsForProfile: () => ({ calories: 2200, protein: 165, carbs: 220, fat: 73 }),
    buildDailySummary: ({
      date,
      entries,
      exercises,
      targets,
      addExerciseToTarget,
    }: {
      date: string;
      entries: FoodEntry[];
      exercises: ExerciseEntry[];
      targets: MacroTargets;
      addExerciseToTarget?: boolean;
    }) => {
      const rows = entries ?? [];
      const consumed = sumMacros(rows);
      const meals = ['breakfast', 'lunch', 'dinner', 'snack'];
      const byMeal: Record<string, unknown> = {};
      for (const meal of meals) {
        byMeal[meal] = sumMacros(rows.filter((e) => e.mealType === meal));
      }
      const exerciseBurned = (exercises ?? []).reduce(
        (total, e) => total + (e.caloriesBurned ?? 0),
        0
      );
      const includeExercise = Boolean(addExerciseToTarget);
      return {
        date,
        consumed,
        byMeal,
        exerciseBurned,
        targets,
        netCalories: consumed.calories - exerciseBurned,
        remainingCalories:
          targets.calories - consumed.calories + (includeExercise ? exerciseBurned : 0),
        entryCount: rows.length,
      };
    },
  };
});

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
    data: { importedWorkouts: 1, activeEnergyKcal: 412, steps: 8321 },
  })),
  healthPlatformLabel: jest.fn(() => 'Apple Health'),
}));

jest.mock('expo-router', () => {
  const push = jest.fn();
  const replace = jest.fn();
  const back = jest.fn();
  return {
    useRouter: () => ({ push, replace, back, navigate: push }),
    router: { push, replace, back, navigate: push },
    useLocalSearchParams: () => ({}),
    __push: push,
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const COLORS = { danger: '#ef4444', warning: '#f59e0b' };

const repos = jest.requireMock('@/db/repositories') as Record<string, jest.Mock>;
const health = jest.requireMock('@/services/health') as Record<string, jest.Mock>;
const routerMock = jest.requireMock('expo-router') as { __push: jest.Mock };

function isoOf(d: Date): ISODate {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftISO(date: ISODate, delta: number): ISODate {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return isoOf(d);
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

function makeExercise(id: string, name: string, kcal: number, min: number): ExerciseEntry {
  return {
    id,
    date: TODAY,
    name,
    category: 'cardio',
    durationMin: min,
    caloriesBurned: kcal,
    source: 'manual',
    externalId: null,
    notes: null,
    loggedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeWeightLog(date: ISODate, weightKg: number): WeightLog {
  return {
    id: `w-${date}`,
    date,
    weightKg,
    bodyFatPct: null,
    note: null,
    source: 'manual',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

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

const GOAL_2000 = makeGoal({ calories: 2000, protein: 150, carbs: 200, fat: 67 });

const FULL_DAY_ENTRIES: FoodEntry[] = [
  makeEntry('e1', 'Greek yogurt', 'breakfast', macros(220, 20, 18, 6)),
  makeEntry('e2', 'Banana', 'breakfast', macros(105, 1, 27, 0)),
  makeEntry('e3', 'Chicken salad', 'lunch', macros(480, 42, 22, 24)),
  makeEntry('e4', 'Salmon and rice', 'dinner', macros(560, 35, 55, 20)),
  makeEntry('e5', 'Almonds', 'snack', macros(85, 3, 3, 7)),
];

const FULL_DAY_EXERCISES: ExerciseEntry[] = [makeExercise('x1', 'Morning run', 300, 35)];

interface SeedOptions {
  entries?: FoodEntry[];
  exercises?: ExerciseEntry[];
  weightLogs?: WeightLog[];
  loggedDates?: ISODate[];
}

function seedRepositories(options: SeedOptions = {}): void {
  const entries = options.entries ?? [];
  const exercises = options.exercises ?? [];
  repos.listEntriesByDate.mockResolvedValue(entries);
  repos.listExercisesByDate.mockResolvedValue(exercises);
  repos.listEntriesByDateRange.mockResolvedValue(entries);
  repos.listExercisesByDateRange.mockResolvedValue(exercises);
  repos.listLoggedDates.mockResolvedValue(options.loggedDates ?? []);
  repos.listWeightLogs.mockResolvedValue(options.weightLogs ?? []);
}

function seedStore(overrides: {
  profile?: UserProfile | null;
  goal?: Goal | null;
  settings?: Partial<AppSettings>;
  selectedDate?: ISODate;
}): void {
  useAppStore.setState({
    profile: overrides.profile ?? null,
    goal: overrides.goal ?? null,
    settings: { ...DEFAULT_SETTINGS, ...(overrides.settings ?? {}) },
    selectedDate: overrides.selectedDate ?? TODAY,
    isReady: true,
    dataVersion: 0,
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderDashboard(): Promise<void> {
  render(<TodayScreen />);
  await settle();
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

/** Resolves the effective `color` of a (possibly nested) RN style prop. */
function styleColor(style: unknown): string | undefined {
  if (!style) return undefined;
  if (Array.isArray(style)) {
    let found: string | undefined;
    for (const item of style) {
      const color = styleColor(item);
      if (color) found = color;
    }
    return found;
  }
  if (typeof style === 'object') {
    const color = (style as { color?: unknown }).color;
    return typeof color === 'string' ? color : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TodayScreen', () => {
  beforeEach(() => {
    seedRepositories();
    seedStore({});
    health.syncHealthDay.mockResolvedValue({
      ok: true,
      data: { importedWorkouts: 1, activeEnergyKcal: 412, steps: 8321 },
    });
    health.healthPlatformLabel.mockReturnValue('Apple Health');
  });

  it('renders a full day of data', async () => {
    seedRepositories({
      entries: FULL_DAY_ENTRIES,
      exercises: FULL_DAY_EXERCISES,
      weightLogs: [makeWeightLog('2026-07-25', 83.4), makeWeightLog(TODAY, 82)],
    });
    seedStore({ profile: PROFILE, goal: GOAL_2000, settings: { weightUnit: 'kg' } });

    await renderDashboard();

    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByTestId('date-stepper')).toBeTruthy();

    // Hero: 2000 goal - 1450 food + 300 exercise = 850 left.
    expect(screen.getByText('850')).toBeTruthy();
    expect(screen.getByText('kcal left')).toBeTruthy();
    expect(screen.getByText('2,000 goal - 1,450 food + 300 exercise = 850')).toBeTruthy();
    expect(screen.getByLabelText('Eaten 1,450 kcal')).toBeTruthy();
    expect(screen.getByLabelText('Burned 300 kcal')).toBeTruthy();
    expect(screen.getByText('73% of goal')).toBeTruthy();

    // Macros.
    expect(screen.getByText('101 / 150 g')).toBeTruthy();
    expect(screen.getByText('67%')).toBeTruthy();
    expect(screen.getByText('125 / 200 g')).toBeTruthy();
    expect(screen.getByTestId('macro-bar').props.children).toBe('101|125|57');

    // Meals.
    expect(screen.getByText('Breakfast')).toBeTruthy();
    expect(screen.getByText('Greek yogurt, Banana')).toBeTruthy();
    expect(screen.getByText('325 kcal · 2 items')).toBeTruthy();
    expect(screen.getByText('Snacks')).toBeTruthy();

    // Quick actions.
    expect(screen.getByLabelText('Scan food')).toBeTruthy();
    expect(screen.getByLabelText('Add food')).toBeTruthy();
    expect(screen.getByLabelText('Log exercise')).toBeTruthy();
    expect(screen.getByLabelText('Log weight')).toBeTruthy();

    // Weight snapshot + weekly strip.
    expect(screen.getByText('82.0 kg')).toBeTruthy();
    expect(screen.getByText('-1.4 kg over 7 days')).toBeTruthy();
    expect(screen.getByTestId('line-chart').props.children).toBe('points:2');
    expect(screen.getByText('Last 7 days')).toBeTruthy();
  });

  it('renders empty states when nothing is logged', async () => {
    seedStore({ profile: PROFILE, goal: GOAL_2000 });

    await renderDashboard();

    expect(screen.getByText('Nothing logged yet')).toBeTruthy();
    expect(screen.getByText('No weight logged')).toBeTruthy();
    expect(screen.getByText('Nothing logged in the last 7 days.')).toBeTruthy();
    expect(screen.getByText('2,000')).toBeTruthy();
    expect(screen.getByText('kcal left')).toBeTruthy();
    expect(screen.getByText('0% of goal')).toBeTruthy();
    expect(screen.queryByText(/day streak/)).toBeNull();
  });

  it('renders the logging streak once loggedDates resolves', async () => {
    seedRepositories({ loggedDates: [TODAY, shiftISO(TODAY, -1), shiftISO(TODAY, -2)] });
    seedStore({ profile: PROFILE, goal: GOAL_2000 });

    await renderDashboard();
    await waitFor(() => expect(screen.getByText('3 day streak')).toBeTruthy());
    expect(screen.getByText('Log something today to keep it going')).toBeTruthy();
  });

  it('shows the personal best when a past run beats the current streak', async () => {
    seedRepositories({
      loggedDates: [
        TODAY,
        // A 4-day run two weeks back beats today's 1-day run.
        shiftISO(TODAY, -14),
        shiftISO(TODAY, -15),
        shiftISO(TODAY, -16),
        shiftISO(TODAY, -17),
      ],
    });
    seedStore({ profile: PROFILE, goal: GOAL_2000 });

    await renderDashboard();
    await waitFor(() => expect(screen.getByText('1 day streak')).toBeTruthy());
    expect(screen.getByText('Best: 4 days')).toBeTruthy();
  });

  it('shows the onboarding CTA when there is no profile', async () => {
    seedStore({ profile: null, goal: null });

    await renderDashboard();

    expect(screen.getByText('Set up your profile to get calorie targets')).toBeTruthy();
    expect(screen.getByText('No calorie target set yet')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Set up profile'));
    expect(routerMock.__push).toHaveBeenCalledWith('/onboarding');
  });

  it('derives targets from the profile when there is no goal', async () => {
    seedStore({ profile: PROFILE, goal: null });

    await renderDashboard();

    expect(screen.queryByText('Set up your profile to get calorie targets')).toBeNull();
    expect(screen.getByText('2,200')).toBeTruthy();
    expect(screen.getByText('2,200 goal - 0 food + 0 exercise = 2,200')).toBeTruthy();
  });

  it('renders over-budget styling when consumed exceeds the target', async () => {
    seedRepositories({ entries: [makeEntry('e1', 'Pizza', 'dinner', macros(2500, 90, 260, 100))] });
    seedStore({ profile: PROFILE, goal: GOAL_2000 });

    await renderDashboard();

    const heroValue = screen.getByText('500');
    const overLabel = screen.getByText('kcal over');
    expect(styleColor(heroValue.props.style)).toBe(COLORS.danger);
    expect(styleColor(overLabel.props.style)).toBe(COLORS.danger);

    const carbsOver = screen.getByText('+60g over');
    expect(styleColor(carbsOver.props.style)).toBe(COLORS.warning);
    expect(screen.getByText('+33g over')).toBeTruthy();
    expect(screen.queryByText('kcal left')).toBeNull();
  });

  it('excludes exercise from the budget when addExerciseToTarget is false', async () => {
    seedRepositories({ entries: FULL_DAY_ENTRIES, exercises: FULL_DAY_EXERCISES });
    seedStore({ profile: PROFILE, goal: GOAL_2000, settings: { addExerciseToTarget: false } });

    await renderDashboard();

    expect(screen.getByText('550')).toBeTruthy();
    expect(screen.getByText('2,000 goal - 1,450 food = 550')).toBeTruthy();
    expect(screen.getByText('Exercise is not added to your budget')).toBeTruthy();
    expect(screen.queryByText('850')).toBeNull();
  });

  it('includes exercise in the budget when addExerciseToTarget is true', async () => {
    seedRepositories({ entries: FULL_DAY_ENTRIES, exercises: FULL_DAY_EXERCISES });
    seedStore({ profile: PROFILE, goal: GOAL_2000, settings: { addExerciseToTarget: true } });

    await renderDashboard();

    expect(screen.getByText('850')).toBeTruthy();
    expect(screen.queryByText('550')).toBeNull();
    expect(screen.queryByText('Exercise is not added to your budget')).toBeNull();
  });

  it('never renders NaN or Infinity when the calorie target is zero', async () => {
    seedRepositories({ entries: FULL_DAY_ENTRIES, exercises: FULL_DAY_EXERCISES });
    seedStore({ profile: null, goal: makeGoal({ calories: 0, protein: 0, carbs: 0, fat: 0 }) });

    await renderDashboard();

    const tree = collectText(screen.toJSON()).join(' | ');
    expect(tree).not.toMatch(/NaN/);
    expect(tree).not.toMatch(/Infinity/);

    expect(screen.getByTestId('progress-ring-value').props.children).toBe('0');
    expect(screen.getByText('kcal eaten')).toBeTruthy();
    expect(screen.getByText('No calorie target set yet')).toBeTruthy();
    // Hero value and the "Eaten" flank both fall back to the consumed total.
    expect(screen.getAllByText('1,450')).toHaveLength(2);
    expect(screen.getByText('101 g')).toBeTruthy();
  });

  it('routes to food search with the date and meal from a meal row', async () => {
    seedRepositories({ entries: FULL_DAY_ENTRIES });
    seedStore({ profile: PROFILE, goal: GOAL_2000 });

    await renderDashboard();

    fireEvent.press(screen.getByLabelText('Add food to lunch'));

    expect(routerMock.__push).toHaveBeenCalledWith({
      pathname: '/food-search',
      params: { date: TODAY, mealType: 'lunch' },
    });
  });

  it('opens the diary when a meal row is tapped or long-pressed', async () => {
    seedRepositories({ entries: FULL_DAY_ENTRIES });
    seedStore({ profile: PROFILE, goal: GOAL_2000 });

    await renderDashboard();

    fireEvent.press(screen.getByLabelText('Dinner'));
    expect(routerMock.__push).toHaveBeenCalledWith('/(tabs)/diary');

    fireEvent(screen.getByLabelText('Dinner'), 'longPress');
    expect(routerMock.__push).toHaveBeenCalledTimes(2);
  });

  it('routes scanning to the inferred meal for the selected date', async () => {
    seedStore({ profile: PROFILE, goal: GOAL_2000 });

    await renderDashboard();

    fireEvent.press(screen.getByLabelText('Scan food'));

    expect(routerMock.__push).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/scan',
        params: expect.objectContaining({ date: TODAY }),
      })
    );
  });

  it('never advances the selected date beyond today', async () => {
    seedStore({ profile: PROFILE, goal: null, selectedDate: TODAY });

    await renderDashboard();

    fireEvent.press(screen.getByLabelText('Next day'));
    expect(useAppStore.getState().selectedDate).toBe(TODAY);

    fireEvent.press(screen.getByLabelText('Previous day'));
    expect(useAppStore.getState().selectedDate).not.toBe(TODAY);
    await settle();
  });

  it('shows the settings prompt when health sync is disabled', async () => {
    seedStore({ profile: PROFILE, goal: null, settings: { healthSyncEnabled: false } });

    await renderDashboard();

    expect(screen.getByText('Connect Apple Health')).toBeTruthy();
    expect(health.syncHealthDay).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('Health settings'));
    expect(routerMock.__push).toHaveBeenCalledWith('/settings');
  });

  it('renders synced health metrics when health sync is enabled', async () => {
    seedRepositories({ exercises: FULL_DAY_EXERCISES });
    seedStore({ profile: PROFILE, goal: null, settings: { healthSyncEnabled: true } });

    await renderDashboard();

    await waitFor(() => expect(health.syncHealthDay).toHaveBeenCalledWith(TODAY));
    await waitFor(() => expect(screen.getByText('8,321')).toBeTruthy());
    expect(screen.getByText('412')).toBeTruthy();
    expect(screen.getByText('35')).toBeTruthy();
    expect(screen.getByText('Apple Health · 1 workout imported')).toBeTruthy();
    await settle();
  });

  it('surfaces a health sync failure without breaking the screen', async () => {
    health.syncHealthDay.mockResolvedValue({ ok: false, error: 'Permission denied' });
    seedStore({ profile: PROFILE, goal: null, settings: { healthSyncEnabled: true } });

    await renderDashboard();

    await waitFor(() => expect(screen.getByText('Permission denied')).toBeTruthy());
    expect(screen.getByText('Today')).toBeTruthy();
    await settle();
  });

  it('ignores a slow health sync for a day the user already moved off', async () => {
    seedStore({ profile: PROFILE, goal: null, settings: { healthSyncEnabled: true } });

    // Hold the first day's sync open so it can resolve *after* the day the user
    // actually navigated to. Active energy feeds the calorie budget, so a stale
    // win here shows the wrong burn under the wrong date.
    let releaseStale: (() => void) | null = null;
    health.syncHealthDay
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseStale = () =>
              resolve({ ok: true, data: { importedWorkouts: 0, activeEnergyKcal: 412, steps: 8321 } });
          })
      )
      .mockResolvedValueOnce({
        ok: true,
        data: { importedWorkouts: 0, activeEnergyKcal: 150, steps: 2222 },
      });

    await renderDashboard();
    await waitFor(() => expect(health.syncHealthDay).toHaveBeenCalledWith(TODAY));

    fireEvent.press(screen.getByLabelText('Previous day'));
    await waitFor(() => expect(health.syncHealthDay).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('2,222')).toBeTruthy());

    await act(async () => {
      releaseStale?.();
      await Promise.resolve();
    });

    expect(screen.getByText('2,222')).toBeTruthy();
    expect(screen.queryByText('8,321')).toBeNull();
    await settle();
  });
});
