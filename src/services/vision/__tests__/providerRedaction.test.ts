import type { VisionInput, VisionResult } from '@/types';

import { __resetApiKeyCache, setApiKey } from '../apiKeys';
import { geminiProvider } from '../geminiProvider';
import { openaiProvider } from '../openaiProvider';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItem: jest.fn((key: string) => store.get(key) ?? null),
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    isAvailableAsync: jest.fn(async () => true),
  };
});

const API_KEY = 'sk-live-supersecret-0987654321';

const INPUT: VisionInput = {
  imageBase64: 'Zm9vZC1waG90by1ieXRlcw==',
  mimeType: 'image/jpeg',
  mode: 'food_photo',
};

/** A model that parrots the request back to us, key and all. */
const ECHOING_JSON = JSON.stringify({
  items: [
    {
      name: 'Grilled chicken breast',
      quantity: 1,
      unit: 'piece',
      estimatedGrams: 170,
      calories: 265,
      protein: 52,
      carbs: 0,
      fat: 6,
      confidence: 0.9,
    },
  ],
  warnings: [`request was authenticated with ${API_KEY} and may be rate limited`],
});

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

const fetchMock = jest.fn();

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(async () => {
  fetchMock.mockReset();
  __resetApiKeyCache();
  await setApiKey('openai', API_KEY);
  await setApiKey('gemini', API_KEY);
});

function expectNoKey(result: VisionResult): void {
  for (const warning of result.warnings) {
    expect(warning).not.toContain(API_KEY);
  }
  expect(JSON.stringify(result)).not.toContain(API_KEY);
}

describe('provider warning redaction', () => {
  it('scrubs an echoed api key from openai warnings', async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, { choices: [{ message: { role: 'assistant', content: ECHOING_JSON } }] }),
    );

    const result = await openaiProvider.analyze(INPUT);

    expect(result.warnings.some((w) => w.includes('rate limited'))).toBe(true);
    expectNoKey(result);
  });

  it('scrubs an echoed api key from gemini warnings', async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, { candidates: [{ content: { parts: [{ text: ECHOING_JSON }] } }] }),
    );

    const result = await geminiProvider.analyze(INPUT);

    expect(result.warnings.some((w) => w.includes('rate limited'))).toBe(true);
    expectNoKey(result);
  });

  it('never puts the gemini key in the request url', async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, { candidates: [{ content: { parts: [{ text: ECHOING_JSON }] } }] }),
    );

    await geminiProvider.analyze(INPUT);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(API_KEY);
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(API_KEY);
  });
});
