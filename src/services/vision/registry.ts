/**
 * Provider registry and the public `analyzeImage` entry point.
 *
 * Resolution order for the active provider: explicit id -> app settings ->
 * `EXPO_PUBLIC_VISION_PROVIDER` -> `mock`. When the selected provider has no API
 * key, analysis silently falls back to the on-device demo provider and records a
 * warning, so the scan flow can never dead-end.
 */
import type {
  FoodEntry,
  FoodSource,
  ISODate,
  MealType,
  Result,
  VisionFoodItem,
  VisionInput,
  VisionMode,
  VisionProvider,
  VisionResult,
} from '@/types';

import { geminiProvider } from './geminiProvider';
import { estimateBase64Bytes, formatBytes, imageUriToBase64 } from './image';
import { mockProvider } from './mockProvider';
import { openaiProvider } from './openaiProvider';
import {
  GEMINI_PROVIDER_ID,
  MAX_IMAGE_BYTES,
  MOCK_PROVIDER_ID,
  OPENAI_PROVIDER_ID,
  VisionError,
  type VisionProviderInfo,
} from './types';

interface ProviderEntry {
  provider: VisionProvider;
  label: string;
  requiresApiKey: boolean;
}

const ENTRIES: ProviderEntry[] = [
  { provider: mockProvider, label: 'Demo (on-device)', requiresApiKey: false },
  { provider: openaiProvider, label: 'OpenAI', requiresApiKey: true },
  { provider: geminiProvider, label: 'Google Gemini', requiresApiKey: true },
];

const BY_ID = new Map<string, ProviderEntry>(ENTRIES.map((entry) => [entry.provider.id, entry]));

export const VISION_PROVIDER_IDS = [MOCK_PROVIDER_ID, OPENAI_PROVIDER_ID, GEMINI_PROVIDER_ID];

interface StoreShape {
  useAppStore?: {
    getState: () => { settings?: { visionProvider?: unknown } };
  };
}

/**
 * Read lazily so the vision service never hard-depends on the store (and so a
 * store/database failure can never break photo analysis).
 */
function providerIdFromSettings(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const store = require('@/store/appStore') as StoreShape;
    const selected = store.useAppStore?.getState().settings?.visionProvider;
    return typeof selected === 'string' && selected.trim() ? selected.trim() : null;
  } catch {
    return null;
  }
}

function providerIdFromEnv(): string | null {
  const configured = process.env.EXPO_PUBLIC_VISION_PROVIDER;
  const trimmed = typeof configured === 'string' ? configured.trim() : '';
  return trimmed || null;
}

/** The provider id the app is currently set to use, regardless of configuration. */
export function resolveVisionProviderId(id?: string): string {
  const explicit = typeof id === 'string' ? id.trim() : '';
  const candidate = explicit || providerIdFromSettings() || providerIdFromEnv() || MOCK_PROVIDER_ID;
  return BY_ID.has(candidate) ? candidate : MOCK_PROVIDER_ID;
}

/**
 * Returns the selected provider. It may be unconfigured — `analyzeImage`
 * performs the fallback so the UI can still show what the user picked.
 */
export function getVisionProvider(id?: string): VisionProvider {
  const entry = BY_ID.get(resolveVisionProviderId(id));
  return entry ? entry.provider : mockProvider;
}

export function getVisionProviderLabel(id: string): string {
  return BY_ID.get(id)?.label ?? id;
}

export function listVisionProviders(): VisionProviderInfo[] {
  return ENTRIES.map((entry) => ({
    id: entry.provider.id,
    label: entry.label,
    modelId: entry.provider.modelId,
    requiresApiKey: entry.requiresApiKey,
    configured: safeIsConfigured(entry.provider),
  }));
}

function safeIsConfigured(provider: VisionProvider): boolean {
  try {
    return provider.isConfigured();
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof VisionError) return error.message;
  return 'Something went wrong analyzing the photo. Try again.';
}

/**
 * Runs a photo through the active vision provider.
 *
 * Never throws: every failure is returned as `{ ok: false, error }` with a
 * message that is safe to show to the user.
 */
export async function analyzeImage(input: VisionInput, providerId?: string): Promise<Result<VisionResult>> {
  const mode: VisionMode = input?.mode === 'nutrition_label' ? 'nutrition_label' : 'food_photo';
  const warnings: string[] = [];

  try {
    if (!input || typeof input.imageBase64 !== 'string' || !input.imageBase64.trim()) {
      return { ok: false, error: 'No photo to analyze. Take or pick a photo first.' };
    }

    const bytes = estimateBase64Bytes(input.imageBase64);
    if (bytes > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        error: `Image too large (${formatBytes(bytes)}). Retake the photo at a lower resolution.`,
      };
    }

    const selectedId = resolveVisionProviderId(providerId);
    let provider = getVisionProvider(selectedId);

    if (!safeIsConfigured(provider)) {
      warnings.push(
        `${getVisionProviderLabel(selectedId)} has no API key, so this estimate came from the on-device demo. Add a key in Settings for real analysis.`
      );
      provider = mockProvider;
    }

    const startedAt = Date.now();
    const result = await provider.analyze({
      imageBase64: input.imageBase64,
      mimeType: input.mimeType || 'image/jpeg',
      mode,
      ...(input.hint ? { hint: input.hint } : {}),
    });
    const latencyMs = Date.now() - startedAt;

    const merged: VisionResult = {
      mode,
      items: Array.isArray(result?.items) ? result.items : [],
      provider: provider.id,
      modelId: result?.modelId || provider.modelId,
      latencyMs: typeof result?.latencyMs === 'number' && result.latencyMs > 0 ? result.latencyMs : latencyMs,
      rawText: typeof result?.rawText === 'string' ? result.rawText : null,
      warnings: [...warnings, ...(Array.isArray(result?.warnings) ? result.warnings : [])],
    };

    if (merged.items.length === 0 && !merged.warnings.some((w) => /no food|no nutrition label/i.test(w))) {
      merged.warnings.push(
        mode === 'nutrition_label'
          ? "Couldn't read a nutrition label in this photo. Try again with the panel filling the frame."
          : "Couldn't identify any food in this photo. Try again with better lighting."
      );
    }

    return { ok: true, data: merged };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/** Convenience wrapper for the scan screen: local photo URI in, result out. */
export async function analyzeImageUri(
  uri: string,
  mode: VisionMode,
  options?: { hint?: string; providerId?: string }
): Promise<Result<VisionResult>> {
  try {
    const encoded = await imageUriToBase64(uri);
    return await analyzeImage(
      {
        imageBase64: encoded.base64,
        mimeType: encoded.mimeType,
        mode,
        ...(options?.hint ? { hint: options.hint } : {}),
      },
      options?.providerId
    );
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/**
 * Turns a reviewed vision item into a ready-to-insert diary entry.
 *
 * `source` defaults to `'vision'`; pass the result mode (or `'label'`) for
 * nutrition-label scans.
 */
export function visionItemToEntryDraft(
  item: VisionFoodItem,
  context: { date: ISODate; mealType: MealType; photoUri: string | null },
  source: VisionMode | FoodSource = 'vision'
): Omit<FoodEntry, 'id' | 'createdAt' | 'updatedAt'> {
  const resolvedSource: FoodSource =
    source === 'nutrition_label' || source === 'label' ? 'label' : 'vision';

  return {
    date: context.date,
    mealType: context.mealType,
    foodId: null,
    name: item.name,
    brand: item.brand ?? null,
    quantity: item.quantity > 0 ? item.quantity : 1,
    unit: item.unit,
    servingLabel: item.servingLabel,
    gramsTotal: item.estimatedGrams,
    macros: { ...item.macros },
    photoUri: context.photoUri,
    source: resolvedSource,
    visionConfidence: typeof item.confidence === 'number' ? item.confidence : null,
    wasEdited: false,
    loggedAt: new Date().toISOString(),
  };
}
