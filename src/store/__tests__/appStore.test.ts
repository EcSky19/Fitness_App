import { DEFAULT_SETTINGS, useAppStore } from '@/store/appStore';
import { ACTIVITY_MULTIPLIERS, KCAL_PER_KG_FAT, MEAL_TYPES } from '@/types/constants';

const initialState = useAppStore.getState();

describe('appStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      ...initialState,
      profile: null,
      goal: null,
      settings: { ...DEFAULT_SETTINGS },
      isReady: false,
      dataVersion: 0,
    });
  });

  it('starts with the documented defaults', () => {
    const state = useAppStore.getState();
    expect(state.settings.weightUnit).toBe('lb');
    expect(state.settings.heightUnit).toBe('ft_in');
    expect(state.settings.energyUnit).toBe('kcal');
    expect(state.settings.addExerciseToTarget).toBe(true);
    expect(state.settings.theme).toBe('system');
    expect(state.selectedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(state.dataVersion).toBe(0);
  });

  it('becomes ready after bootstrap even without repositories', async () => {
    await useAppStore.getState().bootstrap();
    expect(useAppStore.getState().isReady).toBe(true);
    // `bootstrap()` kicks off food seeding in the background; let it finish so
    // it cannot run after the test environment is torn down.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('bumps dataVersion on writes', () => {
    useAppStore.getState().invalidate();
    expect(useAppStore.getState().dataVersion).toBe(1);

    useAppStore.getState().updateSettings({ theme: 'dark' });
    expect(useAppStore.getState().settings.theme).toBe('dark');
    expect(useAppStore.getState().settings.weightUnit).toBe('lb');
    expect(useAppStore.getState().dataVersion).toBe(2);
  });

  it('tracks the selected date', () => {
    useAppStore.getState().setSelectedDate('2026-03-01');
    expect(useAppStore.getState().selectedDate).toBe('2026-03-01');
  });
});

describe('shared constants', () => {
  it('exposes the canonical meal order and activity multipliers', () => {
    expect(MEAL_TYPES).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
    expect(ACTIVITY_MULTIPLIERS.sedentary).toBe(1.2);
    expect(ACTIVITY_MULTIPLIERS.very_active).toBe(1.9);
    expect(KCAL_PER_KG_FAT).toBe(7700);
  });
});
