/**
 * Storage-failure behaviour for `bootstrap()`.
 *
 * A device with a corrupt database file, a failed migration or a full disk will
 * throw out of `initDatabase()`. Bootstrap deliberately swallows that so the app
 * still renders — but it must RECORD the failure, otherwise the user gets a
 * normal-looking app that silently discards everything they log.
 */
import { DEFAULT_SETTINGS, useAppStore } from '@/store/appStore';

const mockInitDatabase = jest.fn<Promise<void>, []>();

jest.mock('@/db/client', () => ({
  initDatabase: (...args: []) => mockInitDatabase(...args),
  todayISO: () => '2026-01-01',
}));

// The lazy repository require must not resolve to a working data layer here;
// an empty module exercises the same path as a database that failed to open.
jest.mock('@/db/repositories', () => ({}));

function resetStore(): void {
  useAppStore.setState({
    profile: null,
    goal: null,
    settings: { ...DEFAULT_SETTINGS },
    isReady: false,
    storageAvailable: true,
    dataVersion: 0,
  });
}

describe('appStore.bootstrap storage failure', () => {
  beforeEach(() => {
    resetStore();
    mockInitDatabase.mockReset();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('flags storage as unavailable when the database cannot be opened', async () => {
    mockInitDatabase.mockRejectedValueOnce(new Error('database disk image is malformed'));

    await useAppStore.getState().bootstrap();

    expect(useAppStore.getState().storageAvailable).toBe(false);
  });

  it('still finishes bootstrap so the app renders instead of hanging on a spinner', async () => {
    mockInitDatabase.mockRejectedValueOnce(new Error('disk full'));

    await useAppStore.getState().bootstrap();

    expect(useAppStore.getState().isReady).toBe(true);
  });

  it('reports storage as available on a healthy start', async () => {
    mockInitDatabase.mockResolvedValueOnce(undefined);

    await useAppStore.getState().bootstrap();

    expect(useAppStore.getState().storageAvailable).toBe(true);
    expect(useAppStore.getState().isReady).toBe(true);
  });

  it('recovers the flag when a later bootstrap succeeds', async () => {
    mockInitDatabase.mockRejectedValueOnce(new Error('locked'));
    await useAppStore.getState().bootstrap();
    expect(useAppStore.getState().storageAvailable).toBe(false);

    mockInitDatabase.mockResolvedValueOnce(undefined);
    await useAppStore.getState().bootstrap();

    expect(useAppStore.getState().storageAvailable).toBe(true);
  });

  it('leaves the flag untouched when switching accounts', async () => {
    mockInitDatabase.mockRejectedValueOnce(new Error('corrupt'));
    await useAppStore.getState().bootstrap();

    useAppStore.getState().reset();

    expect(useAppStore.getState().storageAvailable).toBe(false);
  });
});
