import {
  HEALTHKIT_PACKAGE,
  HEALTH_CONNECT_PACKAGE,
  getMethod,
  hasAnyMethod,
  isNativeHealthModuleAvailable,
  isPromiseLike,
  isRecord,
  loadNativeHealthModule,
  nativeHealthPackageFor,
  registerNativeHealthModule,
  resetNativeHealthModule,
} from '../nativeModule';

afterEach(() => {
  registerNativeHealthModule(null);
  resetNativeHealthModule();
});

describe('loadNativeHealthModule', () => {
  it('returns null in the Jest environment without throwing', () => {
    expect(() => loadNativeHealthModule()).not.toThrow();
    expect(loadNativeHealthModule()).toBeNull();
    expect(loadNativeHealthModule('ios')).toBeNull();
    expect(loadNativeHealthModule('android')).toBeNull();
    expect(isNativeHealthModuleAvailable('ios')).toBe(false);
  });

  it('returns null on unsupported platforms', () => {
    expect(loadNativeHealthModule('web')).toBeNull();
    expect(loadNativeHealthModule('windows')).toBeNull();
  });

  it('uses a module registered by a dev build when it looks like HealthKit', () => {
    const fake = { initHealthKit: jest.fn(), getStepCount: jest.fn() };
    registerNativeHealthModule(fake);

    expect(loadNativeHealthModule('ios')).toBe(fake);
    // The Health Connect signature does not match, so Android stays on the mock.
    expect(loadNativeHealthModule('android')).toBeNull();
  });

  it('uses a module registered by a dev build when it looks like Health Connect', () => {
    const fake = { initialize: jest.fn(), readRecords: jest.fn(), requestPermission: jest.fn() };
    registerNativeHealthModule(fake);

    expect(loadNativeHealthModule('android')).toBe(fake);
    expect(loadNativeHealthModule('ios')).toBeNull();
  });

  it('ignores modules that do not expose the expected API', () => {
    registerNativeHealthModule({ somethingElse: jest.fn() });
    expect(loadNativeHealthModule('ios')).toBeNull();
  });

  it('memoises the lookup until it is reset', () => {
    const fake = { initHealthKit: jest.fn() };
    registerNativeHealthModule(fake);
    expect(loadNativeHealthModule('ios')).toBe(fake);

    registerNativeHealthModule(null);
    expect(loadNativeHealthModule('ios')).toBeNull();
  });

  it('names the package a developer must install', () => {
    expect(nativeHealthPackageFor('ios')).toBe(HEALTHKIT_PACKAGE);
    expect(nativeHealthPackageFor('android')).toBe(HEALTH_CONNECT_PACKAGE);
    expect(nativeHealthPackageFor('web')).toBeNull();
  });
});

describe('runtime helpers', () => {
  it('detects records', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });

  it('reads methods off unknown values', () => {
    const fn = jest.fn();
    expect(getMethod({ fn }, 'fn')).toBe(fn);
    expect(getMethod({ fn }, 'missing')).toBeNull();
    expect(getMethod(null, 'fn')).toBeNull();
    expect(hasAnyMethod({ fn }, ['missing', 'fn'])).toBe(true);
    expect(hasAnyMethod({ fn }, ['missing'])).toBe(false);
  });

  it('detects promises', () => {
    expect(isPromiseLike(Promise.resolve(1))).toBe(true);
    expect(isPromiseLike({ then: () => undefined })).toBe(true);
    expect(isPromiseLike({})).toBe(false);
  });
});
