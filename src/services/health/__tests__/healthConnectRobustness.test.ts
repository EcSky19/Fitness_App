/**
 * Health Connect aggregates records from every installed data source, so a
 * single buggy source app can put a non-finite value (NaN/Infinity) into the
 * record list alongside perfectly good data. One bad record must never erase
 * the user's real totals for the day.
 *
 * The HealthKit provider already guards every extracted number with
 * `Number.isFinite` (see `pickNumber`); these tests hold the Health Connect
 * provider to the same contract.
 */
import type { ISODate } from '@/types';

import { HealthConnectService } from '../healthConnect';
import { dayWindow } from '../types';

const DATE: ISODate = '2026-03-10';
const WINDOW = dayWindow(DATE);
const START = WINDOW?.startISO as string;
const END = WINDOW?.endISO as string;

function serviceReturning(records: Record<string, unknown[]>): HealthConnectService {
  return new HealthConnectService({
    initialize: jest.fn(async () => true),
    getSdkStatus: jest.fn(async () => 3),
    getGrantedPermissions: jest.fn(async () => [{ accessType: 'read', recordType: 'Steps' }]),
    readRecords: jest.fn(async (recordType: string) => ({ records: records[recordType] ?? [] })),
    insertRecords: jest.fn(async () => ['id']),
  });
}

describe('HealthConnectService robustness to a single corrupt record', () => {
  it('keeps valid steps when one source reports a non-finite count', async () => {
    const summary = await serviceReturning({
      Steps: [
        { count: 4000, startTime: START, endTime: END },
        { count: 5500, startTime: START, endTime: END },
        { count: Infinity, startTime: START, endTime: END },
      ],
    }).getDaySummary(DATE);

    // 9500 real steps must survive; the corrupt record must not zero the day.
    expect(summary.steps).toBe(9500);
  });

  it('keeps valid active energy when one record has a NaN value', async () => {
    const summary = await serviceReturning({
      ActiveCaloriesBurned: [
        { energy: { inKilocalories: 300 }, startTime: START, endTime: END },
        { energy: { inKilocalories: NaN }, startTime: START, endTime: END },
      ],
    }).getDaySummary(DATE);

    // The user burned 300 kcal; on a workout-free day this is the number that
    // becomes their "Daily activity" budget entry, so it must not collapse to 0.
    expect(summary.activeEnergyKcal).toBe(300);
  });

  it('keeps valid distance when one record has a non-finite length', async () => {
    const summary = await serviceReturning({
      Distance: [
        { distance: { inMeters: 5000 } },
        { distance: { inMeters: Infinity } },
      ],
    }).getDaySummary(DATE);

    expect(summary.distanceMeters).toBe(5000);
  });
});
