/**
 * Google Gemini vision provider.
 *
 * Sends the photo as an `inline_data` part and asks for `application/json`.
 * The key travels in the `x-goog-api-key` header rather than the query string so
 * it can never leak through a URL in a log or crash report.
 */
import type { VisionInput, VisionProvider, VisionResult } from '@/types';

import { getApiKeySync } from './apiKeys';
import { parseVisionJson } from './parse';
import { promptForMode, VISION_SYSTEM_PROMPT } from './prompts';
import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_PROVIDER_ID,
  isRecord,
  redact,
  requestJson,
  VisionError,
} from './types';

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const MAX_RAW_TEXT = 8_000;

export function geminiModelId(): string {
  const configured = process.env.EXPO_PUBLIC_GEMINI_MODEL;
  const trimmed = typeof configured === 'string' ? configured.trim() : '';
  return trimmed || DEFAULT_GEMINI_MODEL;
}

export function geminiEndpoint(modelId: string): string {
  return `${GEMINI_API_BASE}/${modelId}:generateContent`;
}

function extractContent(payload: Record<string, unknown>): string {
  const candidates = payload.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return '';

  const first = candidates[0];
  if (!isRecord(first)) return '';

  const content = first.content;
  if (!isRecord(content)) return '';

  const parts = content.parts;
  if (!Array.isArray(parts)) return '';

  return parts
    .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
    .join('');
}

export const geminiProvider: VisionProvider = {
  id: GEMINI_PROVIDER_ID,

  get modelId(): string {
    return geminiModelId();
  },

  isConfigured(): boolean {
    return getApiKeySync(GEMINI_PROVIDER_ID) !== null;
  },

  async analyze(input: VisionInput): Promise<VisionResult> {
    const startedAt = Date.now();
    const modelId = geminiModelId();

    const apiKey = getApiKeySync(GEMINI_PROVIDER_ID);
    if (!apiKey) {
      throw new VisionError('not_configured', 'Add a Gemini API key in Settings to use this provider.');
    }
    if (typeof input.imageBase64 !== 'string' || !input.imageBase64) {
      throw new VisionError('bad_request', 'No photo was provided.');
    }

    const mimeType = input.mimeType || 'image/jpeg';
    const payload = await requestJson({
      url: geminiEndpoint(modelId),
      headers: { 'x-goog-api-key': apiKey },
      secret: apiKey,
      body: {
        systemInstruction: { parts: [{ text: VISION_SYSTEM_PROMPT }] },
        contents: [
          {
            role: 'user',
            parts: [
              { text: promptForMode(input.mode, input.hint) },
              { inline_data: { mime_type: mimeType, data: input.imageBase64 } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
          maxOutputTokens: 2048,
        },
      },
    });

    const content = extractContent(payload);
    if (!content.trim()) {
      throw new VisionError('parse', 'The vision model returned an empty response. Try again.');
    }

    const parsed = parseVisionJson(content, input.mode);

    return {
      mode: input.mode,
      items: parsed.items,
      provider: GEMINI_PROVIDER_ID,
      modelId,
      latencyMs: Date.now() - startedAt,
      rawText: redact(content, [apiKey]).slice(0, MAX_RAW_TEXT),
      warnings: parsed.warnings.map((warning) => redact(warning, [apiKey])),
    };
  },
};

export default geminiProvider;
