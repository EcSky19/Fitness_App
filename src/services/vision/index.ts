/**
 * Pluggable vision service.
 *
 * Turns a photo into editable nutrition data. Two modes: `food_photo`
 * (identify each food, estimate grams and macros) and `nutrition_label`
 * (OCR a Nutrition Facts panel).
 *
 * Typical use from a screen:
 * ```ts
 * const encoded = await imageUriToBase64(photoUri);
 * const res = await analyzeImage({ ...encoded, mode: 'food_photo' });
 * if (res.ok) setItems(res.data!.items);
 * ```
 * `analyzeImage` never throws and never dead-ends: an unconfigured provider
 * silently falls back to the on-device demo provider with a warning attached.
 */

// -- entry points -------------------------------------------------------------
export {
  analyzeImage,
  analyzeImageUri,
  getVisionProvider,
  getVisionProviderLabel,
  listVisionProviders,
  resolveVisionProviderId,
  visionItemToEntryDraft,
  VISION_PROVIDER_IDS,
} from './registry';

// -- providers ----------------------------------------------------------------
export {
  mockProvider,
  hashString,
  MOCK_LATENCY_MS,
  MOCK_MODEL_ID,
  __setMockLatencyMs,
} from './mockProvider';
export { openaiProvider, openaiModelId, OPENAI_ENDPOINT } from './openaiProvider';
export { geminiProvider, geminiModelId, geminiEndpoint, GEMINI_API_BASE } from './geminiProvider';

// -- parsing ------------------------------------------------------------------
export { parseVisionJson, extractJson, normalizeConfidence, normalizeUnit, toNumber } from './parse';
export type { ParsedVision } from './parse';

// -- prompts ------------------------------------------------------------------
export {
  FOOD_PHOTO_PROMPT,
  NUTRITION_LABEL_PROMPT,
  VISION_JSON_SCHEMA,
  VISION_SYSTEM_PROMPT,
  promptForMode,
} from './prompts';

// -- image helpers ------------------------------------------------------------
export {
  imageUriToBase64,
  estimateBase64Bytes,
  assertImageSize,
  formatBytes,
  mimeTypeFromUri,
  DEFAULT_MIME_TYPE,
} from './image';
export type { EncodedImage } from './image';

// -- api keys -----------------------------------------------------------------
export {
  setApiKey,
  getApiKey,
  getStoredApiKey,
  getApiKeySync,
  clearApiKey,
  hasApiKey,
  hydrateApiKeys,
  envApiKey,
  apiKeyStorageKey,
  API_KEY_PREFIX,
} from './apiKeys';

// -- shared types and constants ----------------------------------------------
export {
  VisionError,
  MAX_IMAGE_BYTES,
  VISION_TIMEOUT_MS,
  VISION_RETRY_DELAY_MS,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_GEMINI_MODEL,
  MOCK_PROVIDER_ID,
  OPENAI_PROVIDER_ID,
  GEMINI_PROVIDER_ID,
} from './types';
export type { VisionErrorCode, VisionProviderInfo } from './types';
