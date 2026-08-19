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

/** Copies a food-entry photo into the signed-in account's private photo folder. */
export function namespaceFoodPhotoUri(uri: string | null, accountId: ID): string | null {
  const trimmed = uri?.trim() ?? '';
  if (!trimmed || !trimmed.startsWith('file:')) return uri ?? null;
  if (!hasDocumentDirectory()) return uri ?? null;

  try {
    const directory = accountPhotoDirectory(accountId);
    if (trimmed.startsWith(directory.uri)) return trimmed;

    const source = new File(trimmed);
    const destination = new File(directory, `${newId()}-${filenameFromUri(trimmed)}`);
    source.copy(destination);

    try {
      source.delete();
    } catch (error) {
      logPhotoFileFailure('source cleanup', trimmed, error);
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
