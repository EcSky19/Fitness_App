import { __setOpenFoodFactsTimeoutMs, openFoodFactsProvider } from '../openFoodFactsProvider';
import { parseOpenFoodFactsProduct } from '../parse';

const BARCODE = '4006381333931';
const fetchMock = jest.fn();

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function product(overrides: Record<string, unknown> = {}): unknown {
  return {
    status: 1,
    product: {
      product_name: 'Peanut butter',
      brands: 'Demo Brand, Other',
      serving_quantity: 32,
      image_front_url: 'https://images.openfoodfacts.org/demo.jpg',
      nutriments: {
        'energy-kcal_100g': 590,
        proteins_100g: 25,
        carbohydrates_100g: 20,
        fat_100g: 50,
        fiber_100g: 6,
        sugars_100g: 9,
        sodium_100g: 0.42,
      },
      ...overrides,
    },
  };
}

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(() => {
  fetchMock.mockReset();
  __setOpenFoodFactsTimeoutMs(10_000);
  jest.useRealTimers();
});

describe('parseOpenFoodFactsProduct hostile inputs', () => {
  it('coerces string-typed numbers, leading decimals and European decimal commas', () => {
    const parsed = parseOpenFoodFactsProduct(
      product({
        nutriments: {
          'energy-kcal_100g': '1,2e2 kcal',
          proteins_100g: '.5 g',
          carbohydrates_100g: '12,5',
          fat_100g: '-0',
        },
      }),
      BARCODE
    );

    expect(parsed?.per100g).toMatchObject({ calories: 120, protein: 0.5, carbs: 12.5, fat: 0 });
    expect(Object.is(parsed?.per100g.fat, -0)).toBe(false);
  });

  it('converts kJ-only energy to kcal', () => {
    const parsed = parseOpenFoodFactsProduct(
      product({
        nutriments: {
          energy_100g: 418.4,
          proteins_100g: 5,
          carbohydrates_100g: 10,
          fat_100g: 2,
        },
      }),
      BARCODE
    );

    expect(parsed?.per100g.calories).toBe(100);
  });

  it('converts per-serving-only products when serving grams are present', () => {
    const parsed = parseOpenFoodFactsProduct(
      product({
        serving_size: '1 bar (50 g)',
        serving_quantity: undefined,
        nutriments: {
          'energy-kcal_serving': 125,
          proteins_serving: 5,
          carbohydrates_serving: 20,
          fat_serving: 2.5,
        },
      }),
      BARCODE
    );

    expect(parsed?.servingSizeG).toBe(50);
    expect(parsed?.per100g).toMatchObject({ calories: 250, protein: 10, carbs: 40, fat: 5 });
  });

  it('survives missing nutriments and empty product names', () => {
    const parsed = parseOpenFoodFactsProduct(product({ product_name: '', nutriments: {} }), BARCODE);

    expect(parsed?.name).toBe('Unnamed product');
    expect(parsed?.per100g).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it('clamps absurd values and unsafe text without throwing', () => {
    const parsed = parseOpenFoodFactsProduct(
      product({
        product_name: 'A'.repeat(5000),
        image_front_url: 'http://not-secure.example/image.jpg',
        nutriments: {
          'energy-kcal_100g': 999999,
          proteins_100g: 999999,
          carbohydrates_100g: -5,
          fat_100g: 2,
        },
      }),
      BARCODE
    );

    expect(parsed?.name.length).toBeLessThanOrEqual(120);
    expect(parsed?.imageUrl).toBeNull();
    expect(parsed?.per100g).toMatchObject({ calories: 18, protein: 0, carbs: 0, fat: 2 });
  });

  it('returns null for Open Food Facts status 0', () => {
    expect(parseOpenFoodFactsProduct({ status: 0 }, BARCODE)).toBeNull();
  });
});

describe('openFoodFactsProvider', () => {
  it('requests only selected fields with a descriptive user agent', async () => {
    fetchMock.mockResolvedValueOnce(response(200, product()));

    const result = await openFoodFactsProvider.lookup(BARCODE);

    expect(result.ok).toBe(true);
    expect(result.data?.source).toBe('openfoodfacts');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://world.openfoodfacts.org/api/v2/product/4006381333931.json?fields=');
    expect(url).toContain('nutriments');
    expect((init.headers as Record<string, string>)['User-Agent']).toContain('MacroTrack');
    expect(init.signal).toBeDefined();
  });

  it('returns not found for HTTP 404 and provider status 0', async () => {
    fetchMock.mockResolvedValueOnce(response(404, 'missing'));
    await expect(openFoodFactsProvider.lookup(BARCODE)).resolves.toEqual({ ok: true, data: null });

    fetchMock.mockResolvedValueOnce(response(200, { status: 0 }));
    await expect(openFoodFactsProvider.lookup(BARCODE)).resolves.toEqual({ ok: true, data: null });
  });

  it('maps HTTP 500 without leaking raw response bodies', async () => {
    fetchMock.mockResolvedValueOnce(response(500, `server exploded for ${BARCODE}`));

    const result = await openFoodFactsProvider.lookup(BARCODE);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Product lookup is temporarily unavailable. Try again in a moment.');
    expect(result.error).not.toContain(BARCODE);
  });

  it('maps malformed JSON and malformed envelopes to parse failures', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
      text: async () => '<html />',
    } as unknown as Response);
    await expect(openFoodFactsProvider.lookup(BARCODE)).resolves.toEqual({
      ok: false,
      error: 'Product lookup returned a malformed response.',
    });

    fetchMock.mockResolvedValueOnce(response(200, []));
    await expect(openFoodFactsProvider.lookup(BARCODE)).resolves.toEqual({
      ok: false,
      error: 'Product lookup returned an unexpected response.',
    });
  });

  it('maps network rejection to a safe failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError(`Network failed for ${BARCODE}`));

    const result = await openFoodFactsProvider.lookup(BARCODE);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Product lookup failed. Check your connection and try again.');
  });

  it('honours a caller-supplied abort signal', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await openFoodFactsProvider.lookup(BARCODE, controller.signal);

    expect(result).toEqual({ ok: false, error: 'Product lookup timed out. Check your connection and try again.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts on timeout', async () => {
    jest.useFakeTimers();
    __setOpenFoodFactsTimeoutMs(25);
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
        })
    );

    const promise = openFoodFactsProvider.lookup(BARCODE);
    jest.advanceTimersByTime(25);
    await expect(promise).resolves.toEqual({
      ok: false,
      error: 'Product lookup timed out. Check your connection and try again.',
    });
  });
});
