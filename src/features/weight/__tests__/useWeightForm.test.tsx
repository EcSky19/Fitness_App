import { act, renderHook, waitFor } from '@testing-library/react-native';

import { DEFAULT_SETTINGS, useAppStore } from '@/store/appStore';
import type { WeightLog } from '@/types';

import { BIG_CHANGE_MESSAGE, useWeightForm } from '../useWeightForm';
import { makeProfile, makeWeightLog } from '../testSupport';

jest.mock('@/db/repositories', () => require('../testSupport').repositoriesMockFactory());
jest.mock('@/services/health', () => require('../testSupport').healthMockFactory());

const repos = jest.requireMock('@/db/repositories') as {
  addWeightLog: jest.Mock;
  updateWeightLog: jest.Mock;
  saveProfile: jest.Mock;
};
const health = jest.requireMock('@/services/health') as {
  getHealthService: jest.Mock;
  __service: { writeWeight: jest.Mock };
};

const KG_PER_LB = 0.45359237;

function isoDaysFromNow(days: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

const TODAY = isoDaysFromNow(0);

function latest(weightKg: number, daysAgo = 3): WeightLog {
  return makeWeightLog({ id: 'latest', date: isoDaysFromNow(-daysAgo), weightKg });
}

function setUnit(unit: 'kg' | 'lb'): void {
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, weightUnit: unit } });
}

beforeEach(() => {
  repos.addWeightLog.mockResolvedValue(undefined);
  repos.updateWeightLog.mockResolvedValue(undefined);
  repos.saveProfile.mockResolvedValue(undefined);
  health.__service.writeWeight.mockResolvedValue(true);
  useAppStore.setState({
    profile: null,
    settings: { ...DEFAULT_SETTINGS, weightUnit: 'kg', healthSyncEnabled: false },
    dataVersion: 0,
  });
});

describe('unit conversion', () => {
  it('round-trips kg -> lb -> kg without losing precision', () => {
    setUnit('kg');
    const { result } = renderHook(() => useWeightForm());

    act(() => result.current.setDisplayWeight(70.4));
    expect(result.current.weightKg).toBe(70.4);

    act(() => result.current.setUnit('lb'));
    expect(result.current.unit).toBe('lb');
    expect(result.current.displayWeight).toBeCloseTo(155.2, 1);
    expect(result.current.weightKg).toBe(70.4);

    act(() => result.current.setUnit('kg'));
    expect(result.current.displayWeight).toBe(70.4);
    expect(result.current.weightKg).toBe(70.4);
  });

  it('persists the unit preference through the store', () => {
    setUnit('kg');
    const { result } = renderHook(() => useWeightForm());

    act(() => result.current.setUnit('lb'));
    expect(useAppStore.getState().settings.weightUnit).toBe('lb');
  });

  it('prefills the latest weight in the display unit', () => {
    setUnit('lb');
    const { result } = renderHook(() => useWeightForm({ latestLog: latest(80) }));

    expect(result.current.weightKg).toBe(80);
    expect(result.current.displayWeight).toBeCloseTo(176.4, 1);
  });

  it('converts pounds to kilograms on save', async () => {
    setUnit('lb');
    const { result } = renderHook(() => useWeightForm());

    act(() => result.current.setDisplayWeight(154.32));
    await act(async () => {
      await result.current.submit();
    });

    expect(repos.addWeightLog).toHaveBeenCalledTimes(1);
    const payload = repos.addWeightLog.mock.calls[0][0];
    expect(payload.weightKg).toBeCloseTo(154.32 * KG_PER_LB, 10);
    expect(payload.date).toBe(TODAY);
    expect(payload.source).toBe('manual');
    expect(payload.bodyFatPct).toBeNull();
    expect(payload.note).toBeNull();
  });
});

describe('big change warning', () => {
  it('warns above ~5 kg but never blocks saving', () => {
    setUnit('kg');
    const { result } = renderHook(() => useWeightForm({ latestLog: latest(80) }));

    act(() => result.current.setDisplayWeight(84));
    expect(result.current.warning).toBeNull();

    act(() => result.current.setDisplayWeight(86));
    expect(result.current.warning).toBe(BIG_CHANGE_MESSAGE);
    expect(result.current.canSave).toBe(true);
  });

  it('uses the same kg threshold when entering pounds', () => {
    setUnit('lb');
    const { result } = renderHook(() => useWeightForm({ latestLog: latest(80) }));

    act(() => result.current.setDisplayWeight(186));
    expect(result.current.warning).toBeNull();

    act(() => result.current.setDisplayWeight(200));
    expect(result.current.warning).toBe(BIG_CHANGE_MESSAGE);
  });

  it('has no warning without an earlier weigh-in', () => {
    const { result } = renderHook(() => useWeightForm());
    act(() => result.current.setDisplayWeight(120));
    expect(result.current.warning).toBeNull();
  });
});

describe('dates', () => {
  it('rejects a future date', async () => {
    const { result } = renderHook(() => useWeightForm());

    act(() => result.current.setDisplayWeight(80));
    act(() => result.current.setDate(isoDaysFromNow(1)));

    expect(result.current.dateError).not.toBeNull();
    expect(result.current.canSave).toBe(false);

    let saved = true;
    await act(async () => {
      saved = await result.current.submit();
    });

    expect(saved).toBe(false);
    expect(repos.addWeightLog).not.toHaveBeenCalled();
  });

  it('never steps past today', () => {
    const { result } = renderHook(() => useWeightForm());

    act(() => result.current.shiftDate(1));
    expect(result.current.date).toBe(TODAY);

    act(() => result.current.shiftDate(-1));
    expect(result.current.date).toBe(isoDaysFromNow(-1));
    expect(result.current.dateError).toBeNull();
  });
});

describe('submit', () => {
  it('updates the profile weight and bumps dataVersion', async () => {
    useAppStore.setState({ profile: makeProfile({ currentWeightKg: 80 }) });
    const versionBefore = useAppStore.getState().dataVersion;
    const { result } = renderHook(() => useWeightForm({ latestLog: latest(80) }));

    act(() => result.current.setDisplayWeight(79.2));
    await act(async () => {
      await result.current.submit();
    });

    expect(repos.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ currentWeightKg: 79.2 })
    );
    expect(useAppStore.getState().profile?.currentWeightKg).toBe(79.2);
    expect(useAppStore.getState().dataVersion).toBeGreaterThan(versionBefore);
  });

  it('does not overwrite the profile weight when back-filling an older day', async () => {
    useAppStore.setState({ profile: makeProfile({ currentWeightKg: 80 }) });
    const { result } = renderHook(() => useWeightForm({ latestLog: latest(80, 1) }));

    act(() => result.current.setDisplayWeight(85));
    act(() => result.current.setDate(isoDaysFromNow(-5)));
    await act(async () => {
      await result.current.submit();
    });

    expect(repos.addWeightLog).toHaveBeenCalled();
    expect(repos.saveProfile).not.toHaveBeenCalled();
  });

  it('writes to the health service only when sync is enabled', async () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, weightUnit: 'kg', healthSyncEnabled: true },
    });
    const { result } = renderHook(() => useWeightForm());

    act(() => result.current.setDisplayWeight(72.5));
    await act(async () => {
      await result.current.submit();
    });

    expect(health.__service.writeWeight).toHaveBeenCalledWith(72.5, TODAY);
  });

  it('still saves when the health write fails', async () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, weightUnit: 'kg', healthSyncEnabled: true },
    });
    health.__service.writeWeight.mockRejectedValue(new Error('denied'));
    const { result } = renderHook(() => useWeightForm());

    act(() => result.current.setDisplayWeight(72.5));
    let saved = false;
    await act(async () => {
      saved = await result.current.submit();
    });

    expect(saved).toBe(true);
    expect(repos.addWeightLog).toHaveBeenCalled();
  });

  it('updates an existing log instead of adding a duplicate', async () => {
    const existing = makeWeightLog({
      id: 'log-1',
      date: isoDaysFromNow(-2),
      weightKg: 81,
      note: 'morning',
      bodyFatPct: 20,
    });
    const { result } = renderHook(() => useWeightForm({ log: existing, latestLog: existing }));

    await waitFor(() => expect(result.current.weightKg).toBe(81));
    expect(result.current.note).toBe('morning');
    expect(result.current.bodyFatPct).toBe(20);
    expect(result.current.isEditing).toBe(true);

    act(() => result.current.setDisplayWeight(80.5));
    await act(async () => {
      await result.current.submit();
    });

    expect(repos.updateWeightLog).toHaveBeenCalledWith(
      'log-1',
      expect.objectContaining({ weightKg: 80.5, date: existing.date, note: 'morning' })
    );
    expect(repos.addWeightLog).not.toHaveBeenCalled();
  });

  it('refuses to save without a weight', async () => {
    const { result } = renderHook(() => useWeightForm());

    expect(result.current.canSave).toBe(false);
    let saved = true;
    await act(async () => {
      saved = await result.current.submit();
    });

    expect(saved).toBe(false);
    expect(result.current.error).not.toBeNull();
    expect(repos.addWeightLog).not.toHaveBeenCalled();
  });

  it('surfaces repository failures', async () => {
    repos.addWeightLog.mockRejectedValue(new Error('db is locked'));
    const { result } = renderHook(() => useWeightForm());

    act(() => result.current.setDisplayWeight(70));
    let saved = true;
    await act(async () => {
      saved = await result.current.submit();
    });

    expect(saved).toBe(false);
    expect(result.current.error).toBe('db is locked');
  });

  it('writes one weigh-in when save is double tapped', async () => {
    const onSaved = jest.fn();
    const { result } = renderHook(() => useWeightForm({ onSaved }));

    act(() => result.current.setDisplayWeight(70));

    const outcomes: boolean[] = [];
    await act(async () => {
      // Both taps land in the same batch, before `saving` can re-render.
      const first = result.current.submit();
      const second = result.current.submit();
      outcomes.push(await first, await second);
    });

    expect(repos.addWeightLog).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([true, false]);
  });
});
