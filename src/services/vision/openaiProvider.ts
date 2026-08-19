/**
 * OpenAI chat-completions vision provider.
 *
 * Sends the photo inline as a `data:` URL and forces a JSON object response.
 * The API key is resolved from SecureStore first, then `EXPO_PUBLIC_OPENAI_API_KEY`,
 * and is never echoed into errors, warnings or `rawText`.
 */
import type { VisionInput, VisionProvider, VisionResult } from '@/types';

import { getApiKeySync } from './apiKeys';
import { parseVisionJson } from './parse';
import { promptForMode, VISION_SYSTEM_PROMPT } from './prompts';
import {
  DEFAULT_OPENAI_MODEL,
  isRecord,
  OPENAI_PROVIDER_ID,
  redact,
  requestJson,
  VisionError,
} from './types';

export const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

const MAX_RAW_TEXT = 8_000;

export function openaiModelId(): string {
  const configured = process.env.EXPO_PUBLIC_OPENAI_MODEL;
  const trimmed = typeof configured === 'string' ? configured.trim() : '';
  return trimmed || DEFAULT_OPENAI_MODEL;
}

function extractContent(payload: Record<string, unknown>): string {
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';

  const first = choices[0];
  if (!isRecord(first)) return '';

  const message = first.message;
  if (!isRecord(message)) return '';

  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
}

export const openaiProvider: VisionProvider = {
  id: OPENAI_PROVIDER_ID,

  get modelId(): string {
    return openaiModelId();
  },

  isConfigured(): boolean {
    return getApiKeySync(OPENAI_PROVIDER_ID) !== null;
  },

  async analyze(input: VisionInput): Promise<VisionResult> {
    const startedAt = Date.now();
    const modelId = openaiModelId();

    const apiKey = getApiKeySync(OPENAI_PROVIDER_ID);
    if (!apiKey) {
      throw new VisionError('not_configured', 'Add an OpenAI API key in Settings to use this provider.');
    }
    if (typeof input.imageBase64 !== 'string' || !input.imageBase64) {
      throw new VisionError('bad_request', 'No photo was provided.');
    }

    const mimeType = input.mimeType || 'image/jpeg';
    const payload = await requestJson({
      url: OPENAI_ENDPOINT,
      headers: { Authorization: `Bearer ${apiKey}` },
      secret: apiKey,
      body: {
        model: modelId,
        messages: [
          { role: 'system', content: VISION_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: promptForMode(input.mode, input.hint) },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${input.imageBase64}`,
                  detail: 'high',
                },
              },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 1500,
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
      provider: OPENAI_PROVIDER_ID,
      modelId,
      latencyMs: Date.now() - startedAt,
      rawText: redact(content, [apiKey]).slice(0, MAX_RAW_TEXT),
      warnings: parsed.warnings,
    };
  },
};

export default openaiProvider;
