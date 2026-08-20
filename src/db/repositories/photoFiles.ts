import { Directory, File, Paths } from 'expo-file-system';

import { newId } from '@/db/client';
import type { ID } from '@/types';

const PHOTO_ROOT = 'food-entry-photos';

function logPhotoFileFailure(action: string, uri: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error ?? '');
  // eslint-disable-next-line no-console
  console.warn(`Food photo ${action} failed for ${uri}${reason ? `: ${reason}` : ''}`);
}

function accountPhotoDirectory(accountId: ID): Directory {
  const directory = new Directory(Paths.document, PHOTO_ROOT, accountId);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function hasDocumentDirectory(): boolean {
  return Boolean((Paths as { document?: Directory } | undefined)?.document);
}

function filenameFromUri(uri: string): string {
  const path = uri.split('?')[0]?.split('#')[0] ?? '';
  const name = path.split('/').pop() || `photo-${newId()}.jpg`;
  return name.replace(/[^A-Za-z0-9._-]/g, '_') || `photo-${newId()}.jpg`;
}

/**
 * Copies a food-entry photo into the signed-in account's private photo folder.
 *
 * Pass `keepSource` when the same source is about to be namespaced again — one
 * scan photo is shared by every item detected in it, and removing the source
 * after the first copy would make every later copy fail, leaving those entries
 * pointing at a file that no longer exists. The caller is then responsible for
 * removing the source once, after the last copy.
 */
export function namespaceFoodPhotoUri(
  uri: string | null,
  accountId: ID,
  options?: { keepSource?: boolean }
): string | null {
  const trimmed = uri?.trim() ?? '';
  if (!trimmed || !trimmed.startsWith('file:')) return uri ?? null;
  if (!hasDocumentDirectory()) return uri ?? null;

  try {
    const directory = accountPhotoDirectory(accountId);
    if (trimmed.startsWith(directory.uri)) return trimmed;

    const source = new File(trimmed);
    const destination = new File(directory, `${newId()}-${filenameFromUri(trimmed)}`);
    source.copy(destination);

    if (!options?.keepSource) {
      try {
        source.delete();
      } catch (error) {
        logPhotoFileFailure('source cleanup', trimmed, error);
      }
    }

    return destination.uri;
  } catch (error) {
    logPhotoFileFailure('namespace', trimmed, error);
    return uri ?? null;
  }
}

/** Best-effort file deletion; failures must never block the database delete. */
export function deleteFoodPhotoFile(uri: string | null | undefined): void {
  const trimmed = uri?.trim() ?? '';
  if (!trimmed || !trimmed.startsWith('file:')) return;

  try {
    new File(trimmed).delete();
  } catch (error) {
    logPhotoFileFailure('delete', trimmed, error);
  }
}

/**
 * URI prefix of an account's photo folder, or null when it cannot be resolved.
 *
 * Callers use this to decide whether a photo path belongs to a given account
 * without paying the folder-creation cost once per row.
 */
export function accountPhotoPrefix(accountId: ID): string | null {
  if (!accountId || !hasDocumentDirectory()) return null;

  try {
    return accountPhotoDirectory(accountId).uri;
  } catch (error) {
    logPhotoFileFailure('resolve folder', accountId, error);
    return null;
  }
}

/**
 * Removes an account's entire photo folder.
 *
 * Meal photos are the most personal data the app holds, and the privacy policy
 * promises that deleting an account removes its associated data. Deleting the
 * rows alone would leave every photo on disk indefinitely.
 */
export function deleteAccountPhotoDirectory(accountId: ID): void {
  if (!accountId || !hasDocumentDirectory()) return;

  try {
    new Directory(Paths.document, PHOTO_ROOT, accountId).delete();
  } catch (error) {
    logPhotoFileFailure('account folder delete', accountId, error);
  }
}
