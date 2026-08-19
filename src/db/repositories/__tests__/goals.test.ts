import { getActiveGoal, listGoals, saveGoal } from '@/db/repositories';
import type { Goal } from '@/types';

import { setupTestDb, teardownTestDb, useTestAccount } from './testDb';

describe('goals repository', () => {
  beforeEach(async () => {
    await setupTestDb();
    await useTestAccount('test-account-a');
  });

  afterEach(async () => {
    await teardownTestDb();
  });

  it('returns null when no goal exists', async () => {
    await expect(getActiveGoal()).resolves.toBeNull();
    await expect(listGoals()).resolves.toEqual([]);
  });

  it('creates a goal with defaults and marks it active', async () => {
    const goal = await saveGoal({ type: 'cut', rateKgPerWeek: -0.5 });

    expect(goal.id).toEqual(expect.any(String));
    expect(goal.type).toBe('cut');
    expect(goal.rateKgPerWeek).toBe(-0.5);
    expect(goal.macroSplit).toBe('balanced');
    expect(goal.isActive).toBe(true);
    expect(goal.isManualOverride).toBe(false);
    expect(goal.targets).toEqual({ calories: 2000, protein: 150, carbs: 200, fat: 67 });

    const active = await getActiveGoal();
    expect(active).toEqual(goal);
  });

  it('keeps exactly one active goal', async () => {
    const first = await saveGoal({ type: 'cut', startedAt: '2026-01-01' });
    const second = await saveGoal({ type: 'bulk', startedAt: '2026-02-01' });
    const third = await saveGoal({ type: 'maintain', startedAt: '2026-03-01' });

    const goals = await listGoals();
    expect(goals).toHaveLength(3);
    expect(goals.filter((g: Goal) => g.isActive).map((g) => g.id)).toEqual([third.id]);

    const active = await getActiveGoal();
    expect(active?.id).toBe(third.id);
    expect(active?.type).toBe('maintain');

    // Re-activating an older goal deactivates the newest one.
    const reactivated = await saveGoal({ id: first.id, isActive: true });
    expect(reactivated.type).toBe('cut');
    const afterReactivate = await listGoals();
    expect(afterReactivate.filter((g) => g.isActive).map((g) => g.id)).toEqual([first.id]);
    expect(second.isActive).toBe(true); // returned snapshot, not re-read
  });

  it('updates an existing goal in place', async () => {
    const created = await saveGoal({
      type: 'bulk',
      rateKgPerWeek: 0.25,
      targets: { calories: 2800, protein: 180, carbs: 300, fat: 90 },
      macroSplit: 'high_protein',
      isManualOverride: true,
      startedAt: '2026-04-01',
    });

    const updated = await saveGoal({ id: created.id, targets: { ...created.targets, calories: 3000 } });

    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.targets).toEqual({ calories: 3000, protein: 180, carbs: 300, fat: 90 });
    expect(updated.macroSplit).toBe('high_protein');
    expect(updated.isManualOverride).toBe(true);
    expect(updated.startedAt).toBe('2026-04-01');

    await expect(listGoals()).resolves.toHaveLength(1);
  });

  it('does not deactivate others when saving an inactive goal', async () => {
    const active = await saveGoal({ type: 'cut' });
    await saveGoal({ type: 'bulk', isActive: false });

    const goals = await listGoals();
    expect(goals.filter((g) => g.isActive).map((g) => g.id)).toEqual([active.id]);
  });
});
