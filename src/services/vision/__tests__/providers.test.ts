import type { VisionInput } from '@/types';

import { __resetApiKeyCache, setApiKey } from '../apiKeys';
import { geminiProvider } from '../geminiProvider';
import { openaiProvider } from '../openaiProvider';
import { VisionError } from '../types';

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

const API_KEY = 'sk-test-key-abcdef123456';

const ITEMS_JSON = JSON.stringify({
  items: [
    {
      name: 'Grilled chicken breast',
      brand: null,
      quantity: 1,
      unit: 'piece',
      servingLabel: '1 breast (170 g)',
      estimatedGrams: 170,
      calories: 265,
      protein: 52,
      carbs: 0,
      fat: 6,
      fiber: null,
      sugar: null,
      sodium: 320,
      confidence: 0.9,
      notes: null,
    },
  ],
  warnings: [],
});

const INPUT: VisionInput = {
  imageBase64: 'Zm9vZC1waG90by1ieXRlcw==',
  mimeType: 'image/jpeg',
  mode: 'food_photo',
};

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function openaiBody(content: string): unknown {
  return { choices: [{ message: { role: 'assistant', content } }] };
}

function geminiBody(text: string): unknown {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

const fetchMock = jest.fn();

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(async () => {
  fetchMock.mockReset();
  __resetApiKeyCache();
  delete process.env.EXPO_PUBLIC_OPENAI_MODEL;
  delete process.env.EXPO_PUBLIC_GEMINI_MODEL;
  await setApiKey('openai', API_KEY);
  await setApiKey('gemini', API_KEY);
});

describe('openaiProvider', () => {
  it('reports configuration from stored keys', async () => {
    expect(openaiProvider.isConfigured()).toBe(true);

    __resetApiKeyCache();
    await setApiKey('openai', '');
    expect(openaiProvider.isConfigured()).toBe(false);
  });

  it('posts a chat completion with an inline image and json response format', async () => {
    fetchMock.mockResolvedValueOnce(response(200, openaiBody(ITEMS_JSON)));

    const result = await openaiProvider.analyze(INPUT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.signal).toBeDefined();
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);

    const body = JSON.parse(String(init.body)) as {
      model: string;
      response_format: { type: string };
      messages: { role: string; content: unknown }[];
    };
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.response_format).toEqual({ type: 'json_object' });

    const userMessage = body.messages[body.messages.length - 1];
    const content = userMessage?.content as { type: string; image_url?: { url: string; detail: string } }[];
    expect(content[0]?.type).toBe('text');
    expect(content[1]?.image_url?.url).toBe(`data:image/jpeg;base64,${INPUT.imageBase64}`);
    expect(content[1]?.image_url?.detail).toBe('high');

    expect(result.provider).toBe('openai');
    expect(result.modelId).toBe('gpt-4o-mini');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.name).toBe('Grilled chicken breast');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.rawText).toContain('Grilled chicken breast');
  });

  it('honours EXPO_PUBLIC_OPENAI_MODEL', async () => {
    process.env.EXPO_PUBLIC_OPENAI_MODEL = 'gpt-4o';
    fetchMock.mockResolvedValueOnce(response(200, openaiBody(ITEMS_JSON)));

    const result = await openaiProvider.analyze(INPUT);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as { model: string };

    expect(body.model).toBe('gpt-4o');
    expect(result.modelId).toBe('gpt-4o');
  });

  it('maps 401 to an actionable message and never leaks the key', async () => {
    fetchMock.mockResolvedValue(response(401, { error: { message: `Incorrect API key provided: ${API_KEY}` } }));
    expect.assertions(5);

    try {
      await openaiProvider.analyze(INPUT);
    } catch (error) {
      const visionError = error as VisionError;
      expect(visionError.code).toBe('auth');
      expect(visionError.status).toBe(401);
      expect(visionError.message).toBe('Invalid API key. Add a valid key in Settings.');
      expect(visionError.message).not.toContain(API_KEY);
      expect(String(visionError.detail)).not.toContain(API_KEY);
    }
  });

  it('retries once after a 429 and then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(response(429, { error: 'slow down' }))
      .mockResolvedValueOnce(response(200, openaiBody(ITEMS_JSON)));

    const result = await openaiProvider.analyze(INPUT);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.items).toHaveLength(1);
  }, 15000);

  it('retries once after a network error and then succeeds', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(response(200, openaiBody(ITEMS_JSON)));

    const result = await openaiProvider.analyze(INPUT);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.items).toHaveLength(1);
  }, 15000);

  it('gives up after a second failure', async () => {
    fetchMock
      .mockResolvedValueOnce(response(500, 'boom'))
      .mockResolvedValueOnce(response(500, 'boom'));

    await expect(openaiProvider.analyze(INPUT)).rejects.toMatchObject({ code: 'server' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15000);

  it('surfaces a malformed JSON envelope as a parse error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
      text: async () => '<html>gateway</html>',
    } as unknown as Response);

    await expect(openaiProvider.analyze(INPUT)).rejects.toMatchObject({ code: 'parse' });
  });

  it('returns zero items with warnings when the model answers with prose', async () => {
    fetchMock.mockResolvedValueOnce(response(200, openaiBody("I'm sorry, I can't tell what this is.")));

    const result = await openaiProvider.analyze(INPUT);

    expect(result.items).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('rejects an empty completion', async () => {
    fetchMock.mockResolvedValueOnce(response(200, { choices: [] }));

    await expect(openaiProvider.analyze(INPUT)).rejects.toMatchObject({ code: 'parse' });
  });

  it('maps an aborted request to a timeout without retrying', async () => {
    const abortError = Object.assign(new Error('Aborted'), { name: 'AbortError' });
    fetchMock.mockRejectedValueOnce(abortError);

    await expect(openaiProvider.analyze(INPUT)).rejects.toMatchObject({ code: 'timeout' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses to run without a key', async () => {
    __resetApiKeyCache();
    await setApiKey('openai', '');

    await expect(openaiProvider.analyze(INPUT)).rejects.toMatchObject({ code: 'not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('geminiProvider', () => {
  it('posts inline_data with a JSON response mime type', async () => {
    fetchMock.mockResolvedValueOnce(response(200, geminiBody(ITEMS_JSON)));

    const result = await geminiProvider.analyze({ ...INPUT, mode: 'nutrition_label' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent');
    expect(url).not.toContain(API_KEY);
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(API_KEY);
    expect(init.signal).toBeDefined();

    const body = JSON.parse(String(init.body)) as {
      contents: { parts: { text?: string; inline_data?: { mime_type: string; data: string } }[] }[];
      generationConfig: { responseMimeType: string };
    };
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.contents[0]?.parts[0]?.text).toEqual(expect.any(String));
    expect(body.contents[0]?.parts[1]?.inline_data).toEqual({
      mime_type: 'image/jpeg',
      data: INPUT.imageBase64,
    });

    expect(result.provider).toBe('gemini');
    expect(result.mode).toBe('nutrition_label');
    expect(result.items).toHaveLength(1);
  });

  it('honours EXPO_PUBLIC_GEMINI_MODEL', async () => {
    process.env.EXPO_PUBLIC_GEMINI_MODEL = 'gemini-2.5-flash';
    fetchMock.mockResolvedValueOnce(response(200, geminiBody(ITEMS_JSON)));

    const result = await geminiProvider.analyze(INPUT);

    expect(String((fetchMock.mock.calls[0] as [string, RequestInit])[0])).toContain('gemini-2.5-flash');
    expect(result.modelId).toBe('gemini-2.5-flash');
  });

  it('maps 401 and 413', async () => {
    fetchMock.mockResolvedValueOnce(response(401, { error: 'unauthorized' }));
    await expect(geminiProvider.analyze(INPUT)).rejects.toMatchObject({
      message: 'Invalid API key. Add a valid key in Settings.',
    });

    fetchMock.mockResolvedValueOnce(response(413, { error: 'too big' }));
    await expect(geminiProvider.analyze(INPUT)).rejects.toMatchObject({ message: 'Image too large.' });
  });

  it('retries once after a 503 and then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(response(503, 'unavailable'))
      .mockResolvedValueOnce(response(200, geminiBody(ITEMS_JSON)));

    const result = await geminiProvider.analyze(INPUT);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.items).toHaveLength(1);
  }, 15000);

  it('handles a malformed candidate payload', async () => {
    fetchMock.mockResolvedValueOnce(response(200, { candidates: [{ content: {} }] }));

    await expect(geminiProvider.analyze(INPUT)).rejects.toMatchObject({ code: 'parse' });
  });

  it('maps an aborted request to a timeout', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('Aborted'), { name: 'AbortError' }));

    await expect(geminiProvider.analyze(INPUT)).rejects.toMatchObject({ code: 'timeout' });
  });

  it('refuses to run without a key', async () => {
    __resetApiKeyCache();
    await setApiKey('gemini', '');

    await expect(geminiProvider.analyze(INPUT)).rejects.toMatchObject({ code: 'not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
