/**
 * Photo handling when one scan produces several entries.
 *
 * A single food photo routinely yields several detected items, and every draft
 * carries the same source URI. `namespaceFoodPhotoUri` copies the file into the
 * account's private folder and then deletes the source, so namespacing the same
 * source more than once has to be handled deliberately.
 *
 * The file-system mock here is deliberately *stateful*: it tracks which files
 * exist and throws on copying a missing source, exactly as the real API does.
 * The permissive mock used elsewhere (whose `copy()` always succeeds) cannot
 * observe this class of bug at all.
 */
const mockFiles = new Set<string>();

jest.mock('expo-file-system', () => {
  function join(parts: (string | { uri: string })[]): string {
    return parts
      .map((part) => (typeof part === 'string' ? part : part.uri))
      .join('/')
      .replace(/\/+/g, '/')
      .replace('file:/', 'file:///');
  }

  class MockDirectory {
    uri: string;

    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(parts);
      if (!this.uri.endsWith('/')) this.uri += '/';
    }

    create(): void {}

    delete(): void {
      for (const uri of [...mockFiles]) {
        if (uri.startsWith(this.uri)) mockFiles.delete(uri);
      }
    }
  }

  class MockFile {
    uri: string;

    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(parts);
    }

    copy(destination: { uri: string }): void {
      if (!mockFiles.has(this.uri)) {
        throw new Error(`ENOENT: no such file: ${this.uri}`);
      }
      mockFiles.add(destination.uri);
    }

    delete(): void {
      mockFiles.delete(this.uri);
    }
  }

  return {
    Directory: MockDirectory,
    File: MockFile,
    Paths: { document: new MockDirectory('file:///document') },
  };
});

import { addFoodEntries, deleteFoodEntry, listEntriesByDate, repeatEntries } from '@/db/repositories';
import { deleteAccount } from '@/db/repositories/accounts';
import { exportAllData } from '@/db/repositories/admin';
import { importAllData } from '@/db/repositories/importData';

import { setupTestDb, teardownTestDb, useTestAccount } from './testDb';

const ACCOUNT = 'account-photos';
const DATE = '2026-05-01';
const SOURCE = 'file:///cache/scan-plate.jpg';

const macros = { calories: 100, protein: 10, carbs: 10, fat: 2 };

function draft(name: string) {
  return {
    date: DATE,
    mealType: 'lunch' as const,
    name,
    quantity: 1,
    unit: 'serving' as const,
    gramsTotal: 100,
    macros,
    photoUri: SOURCE,
    source: 'vision' as const,
  };
}

beforeEach(async () => {
  mockFiles.clear();
  mockFiles.add(SOURCE);
  await setupTestDb();
  await useTestAccount(ACCOUNT);
});

afterEach(async () => {
  await teardownTestDb();
});

describe('one scan photo shared by several entries', () => {
  it('gives every entry a photo that actually exists on disk', async () => {
    await addFoodEntries([draft('Chicken'), draft('Rice'), draft('Broccoli')]);

    const entries = await listEntriesByDate(DATE);
    expect(entries).toHaveLength(3);

    for (const entry of entries) {
      expect(entry.photoUri).toBeTruthy();
      // The whole point of namespacing is that the file lives in the account's
      // private folder; an entry left pointing at the original cache path is
      // pointing at a file that has already been deleted.
      expect(mockFiles.has(entry.photoUri as string)).toBe(true);
    }
  });

  it('moves every photo into the account-private folder', async () => {
    await addFoodEntries([draft('Chicken'), draft('Rice')]);

    const entries = await listEntriesByDate(DATE);
    for (const entry of entries) {
      expect(entry.photoUri).toContain(`food-entry-photos/${ACCOUNT}/`);
      expect(entry.photoUri).not.toBe(SOURCE);
    }
  });

  it('does not leave the original scan file behind', async () => {
    await addFoodEntries([draft('Chicken'), draft('Rice')]);

    expect(mockFiles.has(SOURCE)).toBe(false);
  });

  it('still works for a single-item scan', async () => {
    await addFoodEntries([draft('Chicken')]);

    const [entry] = await listEntriesByDate(DATE);
    expect(entry?.photoUri).toContain(`food-entry-photos/${ACCOUNT}/`);
    expect(mockFiles.has(entry?.photoUri as string)).toBe(true);
    expect(mockFiles.has(SOURCE)).toBe(false);
  });

  it('leaves entries without a photo alone', async () => {
    await addFoodEntries([{ ...draft('Chicken'), photoUri: null }]);

    const [entry] = await listEntriesByDate(DATE);
    expect(entry?.photoUri).toBeNull();
  });
});

/**
 * Repeating a meal reuses the original entry's photo URI. That URI is already
 * inside the account folder, so namespacing short-circuits and both entries
 * genuinely share one file on disk -- deleting either one must not blank out
 * the other's image.
 */
describe('a photo shared by a repeated meal', () => {
  const LATER = '2026-05-02';

  async function logAndRepeat() {
    await addFoodEntries([draft('Chicken')]);
    const [original] = await listEntriesByDate(DATE);
    await repeatEntries({ entryIds: [original!.id], date: LATER });
    const [copy] = await listEntriesByDate(LATER);
    return { original: original!, copy: copy! };
  }

  it('reuses the same file rather than duplicating it', async () => {
    const { original, copy } = await logAndRepeat();

    expect(copy.photoUri).toBe(original.photoUri);
  });

  it('keeps the photo when only one of the two entries is deleted', async () => {
    const { original, copy } = await logAndRepeat();

    await deleteFoodEntry(original.id);

    expect(await listEntriesByDate(LATER)).toHaveLength(1);
    expect(mockFiles.has(copy.photoUri as string)).toBe(true);
  });

  it('removes the photo once the last entry using it is deleted', async () => {
    const { original, copy } = await logAndRepeat();

    await deleteFoodEntry(original.id);
    await deleteFoodEntry(copy.id);

    expect(mockFiles.has(copy.photoUri as string)).toBe(false);
  });

  it('removes the photo of an entry that does not share it', async () => {
    await addFoodEntries([draft('Chicken')]);
    const [entry] = await listEntriesByDate(DATE);

    await deleteFoodEntry(entry!.id);

    expect(mockFiles.has(entry!.photoUri as string)).toBe(false);
  });
});

/**
 * The privacy policy promises that deleting an account removes its associated
 * data. Meal photos are the most personal data the app stores, so they have to
 * go with the rows rather than lingering on disk.
 */
describe('deleting an account', () => {
  it('removes every photo belonging to that account', async () => {
    mockFiles.add('file:///cache/second.jpg');
    await addFoodEntries([draft('Chicken'), { ...draft('Toast'), photoUri: 'file:///cache/second.jpg' }]);
    const entries = await listEntriesByDate(DATE);
    expect(entries).toHaveLength(2);

    await deleteAccount(ACCOUNT);

    for (const entry of entries) {
      expect(mockFiles.has(entry.photoUri as string)).toBe(false);
    }
  });

  it('leaves another account\u2019s photos untouched', async () => {
    await addFoodEntries([draft('Chicken')]);
    const [mine] = await listEntriesByDate(DATE);

    mockFiles.add('file:///cache/other.jpg');
    await useTestAccount('account-other');
    await addFoodEntries([{ ...draft('Salad'), photoUri: 'file:///cache/other.jpg' }]);
    const [theirs] = await listEntriesByDate(DATE);

    await deleteAccount(ACCOUNT);

    expect(mockFiles.has(mine!.photoUri as string)).toBe(false);
    expect(mockFiles.has(theirs!.photoUri as string)).toBe(true);
  });
});

/**
 * A backup is a JSON file: it carries photo *paths*, never the image bytes.
 * Importing it must therefore never leave an entry pointing at a file the
 * backup did not contain -- another account''s private photo on this device, or
 * a path that simply does not exist on a fresh install.
 */
describe('importing a backup that references photos', () => {
  it('does not point the importing account at another account photos', async () => {
    await addFoodEntries([draft('Chicken')]);
    const [original] = await listEntriesByDate(DATE);
    expect(original?.photoUri).toContain(`/${ACCOUNT}/`);

    const dump = await exportAllData();

    await useTestAccount('account-importer');
    await importAllData(dump, { mode: 'replace' });

    const imported = await listEntriesByDate(DATE);
    expect(imported).toHaveLength(1);
    expect(imported[0]?.photoUri).toBeNull();
  });

  it('keeps the entry and its nutrition data when the photo is dropped', async () => {
    await addFoodEntries([draft('Chicken')]);
    const dump = await exportAllData();

    await useTestAccount('account-importer');
    await importAllData(dump, { mode: 'replace' });

    const [imported] = await listEntriesByDate(DATE);
    expect(imported?.name).toBe('Chicken');
    expect(imported?.macros.calories).toBe(100);
  });

  it('keeps a photo when the account restores its own backup', async () => {
    await addFoodEntries([draft('Chicken')]);
    const [original] = await listEntriesByDate(DATE);
    const dump = await exportAllData();

    await importAllData(dump, { mode: 'replace' });

    const [restored] = await listEntriesByDate(DATE);
    expect(restored?.photoUri).toBe(original?.photoUri);
  });
});
