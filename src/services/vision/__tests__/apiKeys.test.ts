import {
  __resetApiKeyCache,
  envApiKey,
  getApiKey,
  getApiKeySync,
  getStoredApiKey,
  setApiKey,
} from '../apiKeys';

jest.mock('expo-secure-store', () => ({
  getItem: jest.fn(() => null),
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const secureStore = jest.requireMock('expo-secure-store') as {
  getItem: jest.Mock;
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
};

const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__;

function setDev(value: boolean): void {
  Object.defineProperty(globalThis, '__DEV__', {
    configurable: true,
    value,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetApiKeyCache();
  delete process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  setDev(true);
});

afterAll(() => {
  Object.defineProperty(globalThis, '__DEV__', {
    configurable: true,
    value: originalDev,
  });
});

it('does not expose inlined env API keys outside development', async () => {
  process.env.EXPO_PUBLIC_OPENAI_API_KEY = 'sk-dev-only-openai';
  process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'AIza-dev-only-gemini';
  setDev(false);

  expect(envApiKey('openai')).toBeNull();
  expect(envApiKey('gemini')).toBeNull();
  await expect(getApiKey('openai')).resolves.toBeNull();
  expect(getApiKeySync('gemini')).toBeNull();
});

it('surfaces SecureStore write failures while keeping the session cache usable', async () => {
  const error = new Error('secure store unavailable');
  secureStore.setItemAsync.mockRejectedValueOnce(error);

  const result = await setApiKey('openai', ' sk-session-only ');

  expect(result).toEqual({ persisted: false, error });
  expect(await getStoredApiKey('openai')).toBe('sk-session-only');
  expect(getApiKeySync('openai')).toBe('sk-session-only');
});
